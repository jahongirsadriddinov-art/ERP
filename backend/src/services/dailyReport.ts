import { geminiAudioToJson, geminiTextToJson, geminiConfigured } from './gemini';
import DailyReport from '../models/DailyReport';
import { alertBosses } from './companyAlerts';

// ─── Kunlik hisobot (owner 2026-10-19: "ovozli hisobot") ───────────────────────────────────────────────────
// Ovoz yoki matn → Gemini → tartibli hisobot (qilingan ishlar, ishlatilgan material, ishchilar soni, muammolar).

export interface ParsedReport {
  objectName?: string;
  summary: string;
  workDone: string[];
  materialsUsed: Array<{ name: string; qty: number; unit: string }>;
  workersCount?: number;
  issues: Array<{ text: string; severity: 'low' | 'medium' | 'high' }>;
  transcript?: string;
}

const PROMPT = (objects: string[]) => `Sen qurilish firmasining yordamchisisan. Prorab/ishchi kunlik ish hisobotini aytdi (o'zbekcha, sheva yoki rus so'zlari aralash bo'lishi mumkin).${objects.length ? ` Firma obyektlari: ${objects.slice(0, 30).join('; ')}.` : ''}
FAQAT JSON qaytar (o'zbek tilida, lotin):
{"transcript": "aytilgan gapning to'liq matni",
 "objectName": "qaysi obyekt haqida (ro'yxatdagi nomga mos; aytilmagan bo'lsa bo'sh)",
 "summary": "1-2 jumlali qisqa xulosa",
 "workDone": ["bajarilgan ish (masalan: 2-qavat devori terildi)"],
 "materialsUsed": [{"name": "material nomi", "qty": son, "unit": "qop|tonna|m3|dona|..."}],
 "workersCount": ishchilar soni yoki null,
 "issues": [{"text": "muammo (texnika buzildi, material tugadi, baxtsiz hodisa...)", "severity": "low|medium|high"}]}
Faqat aytilgan narsani yoz, o'ylab topma. Baxtsiz hodisa/jarohat — severity "high".`;

export function normalizeReport(raw: any): ParsedReport | null {
  const summary = String(raw?.summary || '').trim();
  const workDone = (Array.isArray(raw?.workDone) ? raw.workDone : []).map((x: any) => String(x || '').trim().slice(0, 200)).filter(Boolean).slice(0, 15);
  if (!summary && !workDone.length) return null;
  const sev = (s: any) => (s === 'high' || s === 'medium' ? s : 'low') as 'low' | 'medium' | 'high';
  const wc = Number(raw?.workersCount);
  return {
    objectName: String(raw?.objectName || '').trim().slice(0, 200) || undefined,
    summary: (summary || workDone.join('; ')).slice(0, 1000),
    workDone,
    materialsUsed: (Array.isArray(raw?.materialsUsed) ? raw.materialsUsed : [])
      .map((m: any) => ({ name: String(m?.name || '').trim().slice(0, 120), qty: Number(m?.qty), unit: String(m?.unit || '').trim().slice(0, 20) }))
      .filter((m: any) => m.name && Number.isFinite(m.qty) && m.qty > 0).slice(0, 20),
    workersCount: Number.isFinite(wc) && wc >= 0 && wc < 10000 ? Math.round(wc) : undefined,
    issues: (Array.isArray(raw?.issues) ? raw.issues : []).map((i: any) => ({ text: String(i?.text || '').trim().slice(0, 300), severity: sev(i?.severity) })).filter((i: any) => i.text).slice(0, 10),
    transcript: String(raw?.transcript || '').slice(0, 4000) || undefined,
  };
}

export async function parseReportAudio(audio: Buffer, mime: string, objects: string[]): Promise<ParsedReport | null> {
  if (!geminiConfigured()) return null;
  return normalizeReport(await geminiAudioToJson(audio, mime, PROMPT(objects)));
}
export async function parseReportText(text: string, objects: string[]): Promise<ParsedReport | null> {
  if (!geminiConfigured()) return null;
  return normalizeReport(await geminiTextToJson(`${PROMPT(objects)}\n\nHisobot matni:\n${text.slice(0, 4000)}`));
}

export function formatReport(r: ParsedReport, lang: 'uz' | 'ru' = 'uz'): string {
  const L = (uz: string, ru: string) => (lang === 'ru' ? ru : uz);
  const lines = [`📋 ${L('Kunlik hisobot', 'Ежедневный отчёт')}${r.objectName ? ` — ${r.objectName}` : ''}`, '', r.summary];
  if (r.workDone.length) lines.push('', `🔨 ${L('Bajarildi', 'Сделано')}:`, ...r.workDone.map((w) => `• ${w}`));
  if (r.materialsUsed.length) lines.push('', `📦 ${L('Material ishlatildi', 'Израсходовано')}:`, ...r.materialsUsed.map((m) => `• ${m.name} — ${m.qty} ${m.unit}`));
  if (r.workersCount !== undefined) lines.push('', `👷 ${L('Ishchilar', 'Рабочих')}: ${r.workersCount}`);
  if (r.issues.length) lines.push('', `⚠️ ${L('Muammolar', 'Проблемы')}:`, ...r.issues.map((i) => `• ${i.text}`));
  return lines.join('\n');
}

/** Tasdiqlangan hisobotni saqlaydi; jiddiy muammo bo'lsa rahbarga ogohlantirish (qo'ng'iroqsiz, baxtsiz hodisa — critical). */
export async function saveReport(p: { companyId: string; userId: string; userName: string; date: string; objectId?: string; objectName?: string; source: 'bot' | 'app'; report: ParsedReport }) {
  const doc = await DailyReport.create({
    companyId: p.companyId, objectId: p.objectId, objectName: p.objectName || p.report.objectName,
    userId: p.userId, userName: p.userName, date: p.date, source: p.source,
    summary: p.report.summary, workDone: p.report.workDone, materialsUsed: p.report.materialsUsed,
    workersCount: p.report.workersCount, issues: p.report.issues, transcript: p.report.transcript,
  });
  const serious = p.report.issues.filter((i) => i.severity !== 'low');
  if (serious.length) {
    await alertBosses({
      companyId: p.companyId, key: `report:${doc._id}`,
      title: `Hisobotda muammo: ${p.objectName || p.report.objectName || p.userName}`,
      body: `${p.userName}: ${serious.map((i) => i.text).join('; ')}`,
      severity: serious.some((i) => i.severity === 'high') ? 'critical' : 'warning',
      entity: 'report', entityId: String(doc._id), dedupeHours: 1,
    }).catch(() => undefined);
  }
  return doc;
}
