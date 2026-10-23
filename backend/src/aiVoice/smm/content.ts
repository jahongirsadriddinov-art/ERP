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

/** SMM uchun JSON format talabi (runContent prompt oxiriga). */
export function smmFormatSpec(lang: 'uz' | 'ru' | 'both' = 'uz'): string {
  const l = lang === 'ru' ? 'rus tilida' : lang === 'both' ? "o'zbek (lotin) tilida, oxirida qisqa ruscha xulosa" : "o'zbek tilida (lotin yozuvi)";
  return `Natijani FAQAT JSON qaytar: {"summary": "1-2 jumla", "items": [{
 "title": "qisqa ilgak sarlavha (≤70 belgi)",
 "text": "tayyor post matni ${l}: ilgak, foyda, chaqiriq (CTA); 400–1100 belgi; emoji me'yorida",
 "hashtags": ["#qurilish", "..."] (6–12 ta),
 "format": "post|carousel|reel|story",
 "category": "feature|tip|case|problem|news",
 "topic": "mavzu (3–8 so'z)",
 "imagePrompt": "ENGLISH description of the visual (no text in image): scene, people, objects, mood",
 "scenes": [{"title": "slayd sarlavhasi ≤40 belgi", "text": "≤110 belgi"}] (carousel/reel/story uchun 3–6 ta; post uchun 2–3 ta)
}]}.
Faqat QurilishERP'da haqiqatda bor imkoniyatlarni ayt. Hech narsani avtomatik e'lon qilma.`;
}

export interface SmmItem {
  title: string; text: string; hashtags?: string[]; format?: string; category?: string; topic?: string; imagePrompt?: string;
  scenes?: { title: string; text: string }[]; lang?: string;
}
/** Gemini javobidagi item → xavfsiz SMM item. */
export function asSmmItem(i: any, lang?: string): SmmItem | null {
  const text = clean(i?.text, 4000);
  if (!text) return null;
  const tags = (Array.isArray(i?.hashtags) ? i.hashtags : []).filter((h: unknown) => typeof h === 'string')
    .map((h: string) => h.trim().replace(/^([^#])/, '#$1').replace(/\s+/g, '')).filter((h: string) => h.length > 1).slice(0, 15).map((h: string) => h.slice(0, 60));
  const scenes = (Array.isArray(i?.scenes) ? i.scenes : []).slice(0, 8)
    .map((s: any) => ({ title: clean(s?.title, 120), text: clean(s?.text, 400) })).filter((s: { title: string; text: string }) => s.title || s.text);
  const format = ['post', 'carousel', 'reel', 'story'].includes(i?.format) ? i.format : 'post';
  const category = (SMM_CATEGORIES as readonly string[]).includes(i?.category) ? i.category : undefined;
  return {
    title: clean(i?.title, 200), text, ...(tags.length ? { hashtags: tags } : {}), format,
    ...(category ? { category } : {}), ...(clean(i?.topic, 300) ? { topic: clean(i?.topic, 300) } : {}),
    ...(clean(i?.imagePrompt, 1500) ? { imagePrompt: clean(i?.imagePrompt, 1500) } : {}),
    ...(scenes.length ? { scenes } : {}), ...(lang ? { lang } : {}),
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
