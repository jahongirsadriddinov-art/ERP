import fs from 'fs';
import path from 'path';
import ObjectModel from '../models/Object';
import ProjectMedia from '../models/ProjectMedia';
import Company from '../models/Company';
import { geminiAudioToJson, geminiConfigured } from './gemini';
import { alertBosses } from './companyAlerts';
import { getBackendUrl } from '../utils/backendUrl';

// ─── AI foto-nazorat (owner 2026-10-19) ─────────────────────────────────────────────────────────────────────
// Obyektga rasm yuklanganda Gemini rasmni ko'radi: ish bosqichi, taxminiy bajarilish foizi, xavfsizlik buzilishlari
// (kaskasiz ishchi, himoyasiz balandlik, ochiq elektr...) va sifat muammolari. Natija rasmga yoziladi; ishonchli
// foiz plan-faktga (Object.progressAi) tushadi; xavfli holat rahbarga ogohlantirish bo'lib boradi (qo'ng'iroqsiz,
// faqat jiddiy bo'lsa va o'qilmasa — companyAlerts). Xarajat chegarasi: obyekt 10 daqiqada 1, firma kuniga 40.

export interface PhotoAnalysis {
  stage: string;
  progressPercent: number | null;
  confidence: number;
  workVisible: string;
  safety: Array<{ issue: string; severity: 'low' | 'medium' | 'high' }>;
  quality: string[];
  at: Date;
}

const PER_OBJECT_GAP_MS = 10 * 60_000;
const PER_COMPANY_DAY = 40;
const MAX_BYTES = 8 * 1024 * 1024;
const lastByObject = new Map<string, number>();

const PROMPT = (objectName: string, smetaHint: string) => `Sen qurilish nazoratchisisan. Rasm "${objectName}" qurilish obyektidan.${smetaHint ? ` Smeta bo'yicha asosiy ishlar: ${smetaHint}.` : ''}
Rasmni diqqat bilan ko'r va FAQAT JSON qaytar (o'zbek tilida, lotin):
{"stage": "hozirgi ish bosqichi (masalan: poydevor, karkas, devor terish, tom, pardozlash)",
 "progressPercent": butun obyektning taxminiy bajarilish foizi 0-100 (rasm yetarli bo'lmasa null),
 "confidence": 0..1 (bahoga ishonch),
 "workVisible": "rasmda ko'rinayotgan ish — 1 jumla",
 "safety": [{"issue": "xavfsizlik buzilishi (kaskasiz ishchi, himoya kamarisiz balandlik, ochiq elektr, to'siqsiz chuqur...)", "severity": "low|medium|high"}],
 "quality": ["ko'rinib turgan sifat muammosi (yoriq, egri devor, namlik...)"]}
Faqat rasmda aniq ko'rinadigan narsani yoz, taxmin qilma. Buzilish bo'lmasa — bo'sh massiv.`;

async function loadImage(url: string): Promise<{ buf: Buffer; mime: string } | null> {
  try {
    // Lokal yuklama (/uploads/...) — diskdan; aks holda (Cloudinary/backend URL) — tarmoqdan
    const rel = url.startsWith('/uploads/') ? url : url.replace(getBackendUrl(), '').startsWith('/uploads/') ? url.replace(getBackendUrl(), '') : '';
    if (rel) {
      const p = path.join(process.cwd(), rel.replace(/^\//, ''));
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        return buf.length <= MAX_BYTES ? { buf, mime: mimeOf(p) } : null;
      }
    }
    const abs = url.startsWith('http') ? url : `${getBackendUrl()}${url}`;
    const r = await fetch(abs, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) return null;
    return { buf: Buffer.from(ab), mime: (r.headers.get('content-type') || mimeOf(abs)).split(';')[0] };
  } catch { return null; }
}
const mimeOf = (p: string) => /\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : /\.hei[cf]$/i.test(p) ? 'image/heic' : 'image/jpeg';

export function normalizeAnalysis(raw: any): PhotoAnalysis {
  const sev = (s: any) => (s === 'high' || s === 'medium' ? s : 'low') as 'low' | 'medium' | 'high';
  const pct = Number(raw?.progressPercent);
  return {
    stage: String(raw?.stage || '').slice(0, 120),
    progressPercent: Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round(pct) : null,
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence) || 0)),
    workVisible: String(raw?.workVisible || '').slice(0, 300),
    safety: (Array.isArray(raw?.safety) ? raw.safety : []).slice(0, 6)
      .map((x: any) => ({ issue: String(x?.issue || '').slice(0, 200), severity: sev(x?.severity) })).filter((x: any) => x.issue),
    quality: (Array.isArray(raw?.quality) ? raw.quality : []).slice(0, 6).map((x: any) => String(x || '').slice(0, 200)).filter(Boolean),
    at: new Date(),
  };
}

/** Plan-faktga yoziladigan foiz: rasm obyektning faqat bir qismini ko'rsatishi mumkin — keskin tushib ketmasin. */
export function mergeProgress(prev: number | undefined, est: number): number {
  if (typeof prev !== 'number') return est;
  if (est >= prev) return est;
  return Math.max(est, prev - 5);
}

export async function analyzeMedia(mediaId: string, opts: { force?: boolean } = {}): Promise<PhotoAnalysis | null> {
  if (!geminiConfigured()) return null;
  const media: any = await ProjectMedia.findById(mediaId).lean();
  if (!media || media.type !== 'image') return null;
  const objectId = String(media.objectId);
  const now = Date.now();
  if (!opts.force && now - (lastByObject.get(objectId) || 0) < PER_OBJECT_GAP_MS) return null;
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const usedToday = await ProjectMedia.countDocuments({ companyId: media.companyId, 'aiAnalysis.at': { $gte: dayStart } });
  if (usedToday >= PER_COMPANY_DAY) return null;
  lastByObject.set(objectId, now);

  const obj: any = await ObjectModel.findById(objectId).select('name smeta.resources progressAi progressManual companyId').lean();
  if (!obj) return null;
  const co: any = await Company.findById(String(media.companyId)).select('features').lean().catch(() => null);
  if (co?.features?.photoAi === false) return null;   // firma AI foto-nazoratni o'chirgan
  const img = await loadImage(String(media.url));
  if (!img) return null;
  const hint = Array.isArray(obj.smeta?.resources)
    ? [...new Set(obj.smeta.resources.filter((r: any) => r.group === 'material').slice(0, 30).map((r: any) => String(r.shortName || r.rawName || '').split(' ')[0]))].slice(0, 10).join(', ')
    : '';
  let raw: any;
  try { raw = await geminiAudioToJson(img.buf, img.mime, PROMPT(String(obj.name || ''), hint)); }
  catch (e) { console.warn('[photoAnalysis] Gemini:', String((e as Error)?.message || e).slice(0, 120)); return null; }
  const a = normalizeAnalysis(raw);
  await ProjectMedia.updateOne({ _id: media._id }, { $set: { aiAnalysis: a } });

  if (a.progressPercent !== null && a.confidence >= 0.5) {
    const percent = mergeProgress(obj.progressAi?.percent, a.progressPercent);
    await ObjectModel.updateOne({ _id: objectId }, { $set: { progressAi: { percent, at: a.at, note: [a.stage, a.workVisible].filter(Boolean).join(' — ').slice(0, 300), mediaId: String(media._id) } } });
  }
  const serious = a.safety.filter((s) => s.severity !== 'low');
  if (serious.length) {
    const high = serious.some((s) => s.severity === 'high');
    await alertBosses({
      companyId: String(media.companyId), key: `safety:${objectId}:${new Date().toISOString().slice(0, 10)}`,
      title: `Xavfsizlik: ${obj.name}`,
      body: `Obyekt rasmida: ${serious.map((s) => s.issue).join('; ')}. Rasmni yuklagan: ${media.uploadedBy?.name || '—'}.`,
      severity: high ? 'critical' : 'warning', entity: 'object', entityId: objectId, dedupeHours: 8,
    }).catch(() => undefined);
  }
  return a;
}
