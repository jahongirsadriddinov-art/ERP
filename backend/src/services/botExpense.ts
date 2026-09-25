import { geminiAudioToJson, geminiConfigured } from './gemini';

// Telegram botdagi "Chiqim qo'shish" — matn yoki OVOZLI xabar orqali chiqim
// kiritish (tasdiqlash bilan). Bu fayl faqat sof yordamchilar: matn/ovozni
// tahlil qilish va foydalanuvchiga ko'rsatiladigan matnlar.

export type ExpLang = 'uz' | 'ru';
export const expLang = (lang?: string): ExpLang => (lang === 'ru' ? 'ru' : 'uz');

export type ExpCategory = 'oylik' | 'material' | 'jihozlar' | 'transport' | 'boshqa';
export const EXP_CATEGORIES: ExpCategory[] = ['oylik', 'material', 'jihozlar', 'transport', 'boshqa'];
export interface ParsedExpense { amount: number; description: string; projectName?: string; transcript?: string; category?: ExpCategory }

// Saytdagi chiqim turlari (oylik/material/jihozlar/transport/boshqa) bilan BIR XIL bo'lishi shart —
// aks holda sayt noma'lum turni xom kalit matni ("finance.types.expense") sifatida ko'rsatadi.
const CAT_KEYWORDS: [ExpCategory, RegExp][] = [
  ['oylik', /oylik|maosh|ish haqi|avans|premiya|mukofot|зарплат|оклад|аванс|премия|зп\b/i],
  ['transport', /transport|benzin|dizel|yoqilg|solyarka|taksi|kamaz|yuk tashish|yo['’`]?l kira|mashina|avtomobil|бензин|топлив|дизел|такси|доставк|перевозк|транспорт|камаз|машин/i],
  ['jihozlar', /jihoz|asbob|uskuna|instrument|drel|kompressor|nasos|perforator|generator|arenda|ijara|оборудован|инструмент|аренд|дрель|компрессор|насос|перфоратор/i],
  ['material', /material|sement|g['’`]?isht|qum|shag['’`]?al|armatura|beton|taxta|bo['’`]?yoq|shifer|profil|gips|penoplast|izolyats|kabel|quvur|цемент|кирпич|песок|щебень|арматур|бетон|доск|краск|гипс|кабел|труб|материал/i],
];
export function guessExpenseCategory(description: string): ExpCategory {
  for (const [cat, re] of CAT_KEYWORDS) if (re.test(description)) return cat;
  return 'boshqa';
}
const asCategory = (v: any): ExpCategory | undefined => (EXP_CATEGORIES as string[]).includes(String(v)) ? (String(v) as ExpCategory) : undefined;

const MAX_AMOUNT = 1e13;

function parseAmount(raw: string): number | null {
  const digits = raw.replace(/[\s,.'’]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return n > 0 && n < MAX_AMOUNT ? n : null;
}

// Qo'lda kiritish: "Summa; Tavsif; Obyekt(ixtiyoriy)" — yoki erkin matn
// ("150000 sement uchun" — birinchi son summa, qolgani tavsif).
export function parseExpenseText(text: string): ParsedExpense | null {
  const t = text.trim();
  if (t.includes(';')) {
    const [a, b, c] = t.split(';').map(x => x.trim());
    const amount = parseAmount(a || '');
    if (amount && b) return { amount, description: b.slice(0, 300), projectName: c || undefined, category: guessExpenseCategory(b) };
    return null;
  }
  const m = t.match(/(\d[\d\s.,]*\d|\d)/);
  if (!m) return null;
  const amount = parseAmount(m[1]);
  if (!amount) return null;
  const description = (t.slice(0, m.index) + ' ' + t.slice((m.index || 0) + m[1].length)).replace(/\s+/g, ' ').replace(/^[\s,.:-]+|[\s,.:-]+$/g, '').replace(/^(so'?m|сум|sum)\s+/i, '');
  if (!description) return null;
  return { amount, description: description.slice(0, 300), category: guessExpenseCategory(description) };
}

const VOICE_PROMPT = `Bu qurilish firmasi xodimining XARAJAT (chiqim) haqidagi OVOZLI xabari. Til o'zbekcha yoki ruscha bo'lishi mumkin.
1) Ovozni AYNAN eshitilganidek yozib ol ("transcript"). Eshitilmagan/tushunarsiz narsani o'zing o'ylab topma.
2) Maydonlarni ajrat:
   - "amount": summa, FAQAT butun son so'mda (yuz ellik ming = 150000, ikki million = 2000000, 1.5 mln = 1500000, "полторы тысячи" = 1500). Aniqlab bo'lmasa 0.
   - "description": xarajat sababi/tavsifi, qisqa va aniq.
   - "projectName": agar obyekt/loyiha nomi aytilgan bo'lsa shu nom, aks holda "".
   - "category": FAQAT shulardan biri: "oylik" (ish haqi/avans), "material" (qurilish materiallari), "jihozlar" (asbob-uskuna, ijara), "transport" (yoqilg'i, yuk/yo'l xarajati), "boshqa" (qolgan hammasi).
Javob FAQAT JSON: {"transcript":"","amount":0,"description":"","projectName":"","category":"boshqa"}`;

export async function voiceToExpense(audio: Buffer, mimeType: string): Promise<ParsedExpense | null> {
  if (!geminiConfigured()) throw new Error('NO_GEMINI');
  const r = await geminiAudioToJson(audio, mimeType || 'audio/ogg', VOICE_PROMPT);
  const amount = Math.round(Number(r?.amount) || 0);
  const description = String(r?.description || '').trim();
  if (!(amount > 0 && amount < MAX_AMOUNT) || !description) return null;
  return {
    amount, description: description.slice(0, 300),
    projectName: String(r?.projectName || '').trim() || undefined,
    category: asCategory(r?.category) ?? guessExpenseCategory(description),
    transcript: String(r?.transcript || '').trim() || undefined,
  };
}

const fmtSum = (n: number) => n.toLocaleString('ru-RU');

export const EXP_T = {
  uz: {
    prompt: "💸 *Chiqim qo'shish*\n\nMatn bilan shu tartibda yozing:\n`Summa; Tavsif; Obyekt (ixtiyoriy)`\n\nMasalan: `150000; Sement uchun; Yunusobod`\nYoki oddiy: `150000 sement uchun`\n\n🎙 Yoki *ovozli xabar* yuboring — men uni matnga aylantirib, tekshirish uchun ko'rsataman.",
    cancelBtn: '❌ Bekor qilish', okBtn: '✅ Tasdiqlash', retryBtn: '🔄 Qayta yuborish',
    cancelled: "❌ Bekor qilindi.",
    processing: "🎙 Ovoz matnga aylantirilmoqda...",
    voiceFail: "⚠️ Ovozli xabardan summa va tavsifni aniq ajrata olmadim. Iltimos, qayta ayting (masalan: «yuz ellik ming so'm sement uchun») yoki matn bilan yozing.",
    noGemini: "⚠️ Ovozni matnga aylantirish hozir sozlanmagan. Iltimos, matn bilan yozing:\n`Summa; Tavsif; Obyekt`",
    parseHint: "⚠️ Tushunmadim. Shu tartibda yozing:\n`Summa; Tavsif; Obyekt (ixtiyoriy)`\nMasalan: `150000; Sement uchun`",
    expired: "Bu so'rov eskirgan. Qaytadan boshlang.",
    confirmTitle: "💸 Chiqimni tekshiring:",
    heard: (s: string) => `🎙 Eshitildi: «${s}»`,
    amountLine: (n: number) => `💰 Summa: ${fmtSum(n)} so'm`,
    descLine: (s: string) => `📝 Tavsif: ${s}`,
    projLine: (s?: string) => `🏗 Obyekt: ${s || '—'}`,
    approverLine: (s: string) => `👤 Tasdiqlovchi: ${s}`,
    catLine: (s: string) => `🏷 Turi: ${s}`,
    catBtn: '🏷 Turini o\'zgartirish',
    cats: { oylik: 'Oylik', material: 'Material', jihozlar: 'Jihozlar', transport: 'Transport', boshqa: 'Boshqa' } as Record<string, string>,
    ask: "To'g'rimi?",
    savedAdmin: (n: number) => `✅ Chiqim saqlandi: ${fmtSum(n)} so'm`,
    savedPending: (n: number, who: string) => `✅ Chiqim yuborildi: ${fmtSum(n)} so'm\n⏳ ${who} tasdiqlashini kuting.`,
    noApprover: "⚠️ Kompaniyada tasdiqlovchi (direktor/o'rinbosar) topilmadi — chiqim yaratilmadi.",
    error: "⚠️ Xatolik yuz berdi, keyinroq urinib ko'ring.",
  },
  ru: {
    prompt: "💸 *Добавить расход*\n\nНапишите текстом в таком порядке:\n`Сумма; Описание; Объект (необязательно)`\n\nНапример: `150000; Цемент; Юнусабад`\nИли просто: `150000 цемент`\n\n🎙 Или отправьте *голосовое сообщение* — я переведу его в текст и покажу для проверки.",
    cancelBtn: '❌ Отмена', okBtn: '✅ Подтвердить', retryBtn: '🔄 Отправить заново',
    cancelled: "❌ Отменено.",
    processing: "🎙 Распознаю голос...",
    voiceFail: "⚠️ Не удалось точно определить сумму и описание из голосового. Повторите (например: «сто пятьдесят тысяч сум на цемент») или напишите текстом.",
    noGemini: "⚠️ Распознавание голоса сейчас не настроено. Напишите текстом:\n`Сумма; Описание; Объект`",
    parseHint: "⚠️ Не понял. Напишите так:\n`Сумма; Описание; Объект (необязательно)`\nНапример: `150000; Цемент`",
    expired: "Запрос устарел. Начните заново.",
    confirmTitle: "💸 Проверьте расход:",
    heard: (s: string) => `🎙 Распознано: «${s}»`,
    amountLine: (n: number) => `💰 Сумма: ${fmtSum(n)} сум`,
    descLine: (s: string) => `📝 Описание: ${s}`,
    projLine: (s?: string) => `🏗 Объект: ${s || '—'}`,
    approverLine: (s: string) => `👤 Утверждающий: ${s}`,
    catLine: (s: string) => `🏷 Тип: ${s}`,
    catBtn: '🏷 Сменить тип',
    cats: { oylik: 'Зарплата', material: 'Материал', jihozlar: 'Оборудование', transport: 'Транспорт', boshqa: 'Прочее' } as Record<string, string>,
    ask: "Всё верно?",
    savedAdmin: (n: number) => `✅ Расход сохранён: ${fmtSum(n)} сум`,
    savedPending: (n: number, who: string) => `✅ Расход отправлен: ${fmtSum(n)} сум\n⏳ Ожидайте подтверждения: ${who}.`,
    noApprover: "⚠️ В компании не найден утверждающий (директор/заместитель) — расход не создан.",
    error: "⚠️ Произошла ошибка, попробуйте позже.",
  },
};
