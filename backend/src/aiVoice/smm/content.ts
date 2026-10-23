import Announcement from '../../models/Announcement';
import AppRelease from '../../models/AppRelease';

// SMM agenti matnlari (owner 2026-10-23): har post — sarlavha, matn, heshteglar, format (post/karusel/reels/story),
// rasm tavsifi (inglizcha, matnsiz — Gemini rasm uchun), slaydlar (karusel/video/story sahnalari), mavzu va turkum.

export const SMM_KEYS = ['smm', 'marketing'];
export const SMM_CATEGORIES = ['feature', 'tip', 'case', 'problem', 'news'] as const;
export type SmmCategory = typeof SMM_CATEGORIES[number];

/** Mahsulot imkoniyatlari (yangiliklar bo'lmasa — shundan). Faqat haqiqatda bor funksiyalar. */
export const ERP_FEATURES = [
  "Obyektlar: har bir qurilish obyekti bo'yicha byudjet, materiallar, smeta va plan-fakt",
  "Kirim-chiqim: kassalar, ko'p valyuta (so'm/dollar), tasdiqlash oqimi, Excel/PDF hisobotlar",
  "Ovozli chiqim: prorab Telegram botga ovoz bilan aytadi — summa, obyekt va tavsif o'zi yoziladi (qog'oz cheklar yo'qolmaydi)",
  "GPS davomat va xarita: ishchilar qayerda, «Ishga keldim» geozona bilan, davomat hisobotlari",
  "AI ovozli yordamchi: ertalab ishchilarga qo'ng'iroq qilib davomatni so'raydi, eslatmalar, rahbarga xulosa",
  "Ichki chat va guruhlar: rasm/video/ovozli xabarlar, e'lonlar taxtasi",
  "Telegram ERP bot: chiqim/kirim qo'shish, kunlik hisobot, bildirishnomalar",
  "Smeta: Excel/PDF smetani yuklash va avtomatik tahlil",
  "Ish jarayoni rasmlari, hujjatlar va imzolar, texnika hisobi, xavfsizlik hodisalari",
  "Rollar: direktor, o'rinbosar, prorab, brigadir, ishchi — har biri o'z huquqlari bilan",
  "Android ilova, Windows ilova va sayt — hammasi bitta hisobda; o'zbek (lotin/kirill) va rus tillari",
];

export const CATEGORY_HINT: Record<SmmCategory, string> = {
  feature: "mahsulot funksiyasi — qanday muammoni yechadi, 2–3 aniq foyda",
  tip: "qurilish firmalari uchun amaliy maslahat (moliya, ishchilar, materiallar, xavfsizlik) — sotuvchi emas, maslahatchi ohangda, oxirida QurilishERP qanday yordam berishi",
  case: "hikoya ko'rinishidagi post: firma (nomi o'ylab topilgan, haqiqiy deb ko'rsatma) qanday muammoga duch keldi va ERP bilan nima o'zgardi; raqamlar taxminiy ekanini yashirma",
  problem: "«muammo → yechim»: qurilishdagi og'riqli holat (yo'qolgan cheklar, ishchilar qayerdaligi noma'lum, smeta oshib ketishi) va QurilishERP yechimi",
  news: "yangilik / yangilanish e'loni (quyidagi yangiliklardan)",
};

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');

/** SMM uchun JSON format talabi (runContent prompt oxiriga). Faqat title/body/hashtags e'lon qilinadi; editorNotes — panelda. */
export function smmFormatSpec(lang: 'uz' | 'ru' | 'both' = 'uz'): string {
  const l = lang === 'ru' ? 'rus tilida' : lang === 'both' ? "o'zbek (lotin) tilida, oxirida qisqa ruscha xulosa" : "o'zbek tilida (lotin yozuvi)";
  return `Natijani FAQAT JSON qaytar: {"summary": "1-2 jumla", "items": [{
 "title": "qisqa ilgak sarlavha (≤70 belgi), yorliqsiz",
 "body": "FAQAT e'lon qilinadigan post matni ${l}: ilgak, foyda, chaqiriq (CTA); 400–1100 belgi; paragraflar bo'sh qator bilan; emoji me'yorida",
 "hashtags": ["#qurilish", "..."] (6–12 ta),
 "editorNotes": "muharrir uchun izoh/maslahat (e'lon qilinmaydi), bo'lmasa bo'sh satr",
 "format": "post|carousel|reel|story",
 "category": "feature|tip|case|problem|news",
 "topic": "mavzu (3–8 so'z)",
 "imagePrompt": "ENGLISH description of the visual (no text in image): scene, people, objects, mood",
 "scenes": [{"title": "slayd sarlavhasi ≤40 belgi", "text": "≤110 belgi"}] (carousel/reel/story uchun 3–6 ta; post uchun 2–3 ta)
}]}.
QOIDALAR: "body" ichida hech qanday yorliq ("Telegram post:", "Instagram Reels / Karusel:", "Caption:", "Sarlavha:"), format izohlari, sahna/kadr
ko'rsatmalari, "[Rasm: …]" kabi izohlar, markdown (**, ##), to'ldiriladigan joylar ([kompaniya nomi], {link}) va muharrirga maslahat BO'LMASIN —
ularning hammasi faqat "editorNotes" yoki "scenes"/"imagePrompt"ga. Heshteglar faqat "hashtags"da.
Faqat QurilishERP'da haqiqatda bor imkoniyatlarni ayt. Hech narsani avtomatik e'lon qilma.`;
}

// ───────────── Sanitizer: faqat e'lon qilinadigan matn qoladi ─────────────
const LABEL_WORDS = 'telegram|instagram|tg|ig|facebook|reels?|karusel|carousel|story|stories|storis|post|posti|caption|sarlavha|matn|matni|title|text|body|heshteglar|hashtags?|cta|kanal|kanalga|uchun|variant|versiya|tayyor|qisqa|uzun';
const LABEL_RE = new RegExp(`^\\s*(?:[📌📝✍️🔹▶️]\\s*)?(?:${LABEL_WORDS})\\s*\\d{0,2}(?:[\\s/|+,&-]+(?:${LABEL_WORDS})\\s*\\d{0,2})*\\s*[:：]\\s*`, 'iu');
const DIRECTION_RE = /^\s*(?:[-*•]\s*)?(?:sahna|kadr|slayd|slide|scene|shot|ovoz|voiceover|musiqa|music|vizual|visual|rasm|surat|image|video)\s*\d*\s*[:.)\]—-]/iu;
const NOTE_RE = /^\s*(?:[-*•]\s*)?(?:format|izoh|eslatma|note|notes|muharrir(?:\s+uchun)?|editor(?:'s)?\s*notes?|tavsiya|maslahat\s*\(muharrir\)|qo'shimcha|nashr\s+vaqti|e'lon\s+vaqti|posting\s+time)\s*[:：]/iu;
const BRACKET_NOTE_RE = /[[(](?:rasm|surat|foto|image|video|kadr|sahna|scene|shot|slayd|slide|izoh|note|muharrir|editor|vizual|visual)\b[^\])]*[\])]/giu;
const PLACEHOLDER_RE = /[[{<]\s*[^\]}>]{0,40}?\b(?:nomi|name|link|havola|raqam|telefon|phone|url|sana|date|manzil|address|kompaniya|company|ism)\b[^\]}>]{0,40}[\]}>]/giu;
const HASHTAG_LINE_RE = /^\s*(?:#[\p{L}\p{N}_]+[\s,]*)+$/u;

function stripMarkdown(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')            // ## Sarlavha
    .replace(/^\s*>\s?/, '')                       // > iqtibos
    .replace(/^\s*[-*]\s+/, '• ')                  // - band / * band
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*/g, '');
}

export interface CleanPost { title: string; text: string; hashtags: string[]; notes: string[] }
/** Agent javobidan FAQAT e'lon qilinadigan matnni ajratadi: yorliqlar ("Telegram post:"), sahna/kadr ko'rsatmalari, "[Rasm: …]",
 *  markdown, to'ldiriladigan joylar olib tashlanadi; muharrir izohlari notes'ga; matndagi heshteg qatorlari hashtags'ga. */
export function sanitizePost(it: { title?: string; text?: string; hashtags?: string[] }): CleanPost {
  const notes: string[] = [];
  const tags: string[] = [];
  const addTag = (h: string) => { const t = h.trim().replace(/[,.;]+$/, ''); if (/^#[\p{L}\p{N}_]+$/u.test(t) && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t); };
  (it.hashtags || []).forEach((h) => { const t = String(h).trim(); if (t && !/\s/.test(t)) addTag(t.startsWith('#') ? t : `#${t}`); });
  const out: string[] = [];
  for (const raw of String(it.text || '').replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw.replace(/\s+$/, '');
    if (!line.trim()) { out.push(''); continue; }
    if (/^\s*(?:-{3,}|_{3,}|\*{3,}|={3,})\s*$/.test(line)) continue;
    if (NOTE_RE.test(line)) { notes.push(line.replace(NOTE_RE, '').trim() || line.trim()); continue; }
    if (DIRECTION_RE.test(line)) { notes.push(line.trim()); continue; }
    line = stripMarkdown(line);
    for (let i = 0; i < 2 && LABEL_RE.test(line); i++) line = line.replace(LABEL_RE, '');
    const before = line;
    line = line.replace(BRACKET_NOTE_RE, (m) => { notes.push(m); return ''; }).replace(PLACEHOLDER_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
    if (!line) { if (before.trim()) continue; out.push(''); continue; }
    if (HASHTAG_LINE_RE.test(line)) { line.split(/[\s,]+/).forEach(addTag); continue; }
    out.push(line);
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  let title = stripMarkdown(String(it.title || '').trim());
  for (let i = 0; i < 2 && LABEL_RE.test(title); i++) title = title.replace(LABEL_RE, '');
  title = title.replace(BRACKET_NOTE_RE, '').replace(PLACEHOLDER_RE, '').replace(/^["«“']+|["»”']+$/g, '').replace(/\s{2,}/g, ' ').trim();
  return { title, text, hashtags: tags.slice(0, 30), notes };
}

export interface SmmItem {
  title: string; text: string; hashtags?: string[]; format?: string; category?: string; topic?: string; imagePrompt?: string;
  scenes?: { title: string; text: string }[]; lang?: string; editorNotes?: string;
}
/** Gemini javobidagi item → xavfsiz SMM item (body/text tozalanadi; meta — editorNotes). */
export function asSmmItem(i: any, lang?: string): SmmItem | null {
  const raw = clean(i?.body, 4000) || clean(i?.text, 4000);
  if (!raw) return null;
  const rawTags = (Array.isArray(i?.hashtags) ? i.hashtags : typeof i?.hashtags === 'string' ? i.hashtags.split(/[\s,]+/) : []).filter((h: unknown) => typeof h === 'string');
  const c = sanitizePost({ title: clean(i?.title, 200), text: raw, hashtags: rawTags });
  if (!c.text) return null;
  const scenes = (Array.isArray(i?.scenes) ? i.scenes : []).slice(0, 8)
    .map((s: any) => ({ title: clean(s?.title, 120), text: clean(s?.text, 400) })).filter((s: { title: string; text: string }) => s.title || s.text);
  const format = ['post', 'carousel', 'reel', 'story'].includes(i?.format) ? i.format : 'post';
  const category = (SMM_CATEGORIES as readonly string[]).includes(i?.category) ? i.category : undefined;
  const notes = [clean(i?.editorNotes, 1500), ...c.notes].filter(Boolean).join('\n').slice(0, 1500);
  return {
    title: c.title.slice(0, 200), text: c.text, ...(c.hashtags.length ? { hashtags: c.hashtags.slice(0, 15).map((h) => h.slice(0, 60)) } : {}), format,
    ...(category ? { category } : {}), ...(clean(i?.topic, 300) ? { topic: clean(i?.topic, 300) } : {}),
    ...(clean(i?.imagePrompt, 1500) ? { imagePrompt: clean(i?.imagePrompt, 1500) } : {}),
    ...(scenes.length ? { scenes } : {}), ...(lang ? { lang } : {}), ...(notes ? { editorNotes: notes } : {}),
  };
}

/** Yangiliklar manbai: global e'lonlar (dasturchi barcha firmalarga yuborgan) va oxirgi ilova relizi. */
export async function newsContext(now = Date.now()): Promise<string> {
  const since = new Date(now - 45 * 86_400_000);
  const [ann, rel]: [any[], any] = await Promise.all([
    Announcement.find({ isGlobal: true, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(6).select('title body createdAt').lean().catch(() => []),
    AppRelease.findOne({ key: 'latest' }).select('version notes updatedAt').lean().catch(() => null),
  ]);
  const lines: string[] = [];
  for (const a of ann) lines.push(`- ${new Date(a.createdAt).toISOString().slice(0, 10)}: ${clean(a.title, 120)} — ${clean(a.body, 300)}`);
  if (rel?.notes) lines.push(`- Ilova ${clean(rel.version, 20)} (${new Date(rel.updatedAt).toISOString().slice(0, 10)}): ${clean(rel.notes, 400)}`);
  return lines.length ? `Platforma yangiliklari:\n${lines.join('\n')}` : '';
}

export function featuresContext(): string {
  return `QurilishERP imkoniyatlari (faqat shulardan foydalan):\n${ERP_FEATURES.map((f) => `- ${f}`).join('\n')}`;
}
