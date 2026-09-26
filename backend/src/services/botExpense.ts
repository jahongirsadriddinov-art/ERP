import { geminiAudioToJson, geminiConfigured } from './gemini';

// Telegram botdagi "Chiqim qo'shish" — matn yoki OVOZLI xabar orqali chiqim
// kiritish (tasdiqlash bilan). Bu fayl faqat sof yordamchilar: matn/ovozni
// tahlil qilish va foydalanuvchiga ko'rsatiladigan matnlar.

export type ExpLang = 'uz' | 'ru';
export const expLang = (lang?: string): ExpLang => (lang === 'ru' ? 'ru' : 'uz');

export type ExpCategory = 'oylik' | 'material' | 'jihozlar' | 'transport' | 'boshqa';
export const EXP_CATEGORIES: ExpCategory[] = ['oylik', 'material', 'jihozlar', 'transport', 'boshqa'];
export type ExpCurrency = 'UZS' | 'USD' | 'EUR';
// amount — AYTILGAN valyutada (currency). So'mga o'girish bot.ts'da firma kursi bilan qilinadi.
export interface ParsedExpense {
  amount: number; description: string; projectName?: string; recipientName?: string; transcript?: string;
  category?: ExpCategory; currency?: ExpCurrency; date?: string; cleanText?: string;
}

// Toshkent vaqti bo'yicha YYYY-MM-DD, `days` kun oldin
export function isoDaysAgo(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
const MONTHS: [RegExp, number][] = [
  [/^(yanv|январ)/, 1], [/^(fev|феврал)/, 2], [/^(mart|март)/, 3], [/^(apr|апрел)/, 4], [/^(may|май|мая)/, 5],
  [/^(iyun|июн)/, 6], [/^(iyul|июл)/, 7], [/^(avg|август)/, 8], [/^(sen|сентябр)/, 9], [/^(okt|октябр)/, 10],
  [/^(noy|ноябр)/, 11], [/^(dek|декабр)/, 12],
];
const MONTH_WORD = /^(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sent[y]?abr|okt[y]?abr|noyabr|dekabr|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)(ь|я|е|а|da|dagi|ning|i)?$/;
function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
// Matndagi sanani topadi ("kecha", "o'tgan kuni", "15-iyul", "15.07", "15.07.2026"), topilgan qismni
// matndan olib tashlaydi (aks holda "15" summa deb o'qilardi). Kelajakdagi sana — o'tgan yilniki.
export function extractDate(text: string, today: string): { date?: string; rest: string } {
  let t = text;
  const [ty] = today.split('-').map(Number);
  const rel: [RegExp, number][] = [
    [/(?<!\p{L})(o['’`ʻ]?tgan\s+kun[iy]?|oldingi\s+kun[iy]?|позавчера)(?!\p{L})/iu, 2],
    [/(?<!\p{L})(kecha|вчера)(?!\p{L})/iu, 1],
    [/(?<!\p{L})(bugun|сегодня)(?!\p{L})/iu, 0],
  ];
  for (const [re, n] of rel) if (re.test(t)) return { date: isoDaysAgo(today, n), rest: t.replace(re, ' ') };
  const future = (iso: string) => iso > today;
  const m1 = t.match(/(?<!\d)(\d{1,2})\s*[-.\s]?\s*(\p{L}{3,})/u);
  if (m1) {
    // Faqat butun so'z oy nomi bo'lsa ("3 marta" = "3 marta takror" — sana EMAS)
    const mon = MONTHS.find(([re]) => re.test(m1[2].toLowerCase()) && MONTH_WORD.test(m1[2].toLowerCase()));
    if (mon) {
      let iso = validDate(ty, mon[1], Number(m1[1]));
      if (iso && future(iso)) iso = validDate(ty - 1, mon[1], Number(m1[1]));
      if (iso) return { date: iso, rest: t.replace(m1[0], ' ') };
    }
  }
  const m2 = t.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (m2) {
    let y = m2[3] ? Number(m2[3].length === 2 ? `20${m2[3]}` : m2[3]) : ty;
    let iso = validDate(y, Number(m2[2]), Number(m2[1]));
    if (iso && !m2[3] && future(iso)) iso = validDate(y - 1, Number(m2[2]), Number(m2[1]));
    if (iso) return { date: iso, rest: t.replace(m2[0], ' ') };
  }
  return { rest: t };
}
export function detectCurrency(text: string): ExpCurrency {
  if (/\$|(?<!\p{L})(usd|dollar|доллар)/iu.test(text)) return 'USD';
  if (/€|(?<!\p{L})(eur|evro|yevro|euro|евро)/iu.test(text)) return 'EUR';
  return 'UZS';
}
const stripCurrencyWords = (x: string) => x.replace(/\$|€|(?<!\p{L})(usd|dollar\p{L}*|доллар\p{L}*|eur|evro|yevro|euro|евро|so['’`ʻ]?m|сум\p{L}*|sum)(?!\p{L})/giu, ' ');

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
export function parseExpenseText(text: string, today?: string): ParsedExpense | null {
  const { date, rest } = today ? extractDate(text, today) : { date: undefined, rest: text };
  const currency = detectCurrency(rest);
  const t = stripCurrencyWords(rest).replace(/\s+/g, ' ').trim();
  const base = { currency, ...(date ? { date } : {}) };
  if (t.includes(';')) {
    const [a, b, c, d] = t.split(';').map(x => x.trim());
    const amount = parseAmount(a || '');
    if (amount && b) return { amount, description: b.slice(0, 300), projectName: c || undefined, recipientName: d || undefined, category: guessExpenseCategory(b), ...base };
    return null;
  }
  const m = t.match(/(\d[\d\s.,]*\d|\d)/);
  if (!m) return null;
  const amount = parseAmount(m[1]);
  if (!amount) return null;
  const description = (t.slice(0, m.index) + ' ' + t.slice((m.index || 0) + m[1].length)).replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');
  if (!description) return null;
  return { amount, description: description.slice(0, 300), category: guessExpenseCategory(description), ...base };
}

const voicePrompt = (today: string) => `Bu qurilish firmasi xodimining XARAJAT (chiqim) haqidagi OVOZLI xabari. Til o'zbekcha yoki ruscha bo'lishi mumkin. Bugungi sana: ${today}.
1) Ovozni AYNAN eshitilganidek yozib ol ("transcript"). Eshitilmagan/tushunarsiz narsani o'zing o'ylab topma.
2) "cleanText": aytilgan BUTUN gapni to'liq, imlo va grammatik jihatdan tuzatilgan, o'qishga qulay ko'rinishda yoz (ma'nosini o'zgartirma, hech narsa qo'shma va qisqartirma).
3) Maydonlarni ajrat:
   - "amount": summa AYTILGAN VALYUTADA, son bilan (yuz ellik ming = 150000, ikki million = 2000000, 1.5 mln = 1500000, "полторы тысячи" = 1500, "yuz dollar" = 100). Aniqlab bo'lmasa 0.
   - "currency": "UZS" (so'm, yoki valyuta aytilmagan bo'lsa), "USD" (dollar), "EUR" (yevro).
   - "date": xarajat SANASI YYYY-MM-DD: "kecha" = bugundan 1 kun oldin, "o'tgan kuni"/"oldingi kuni"/"позавчера" = 2 kun oldin, "15-iyulda" = shu yilning 15-iyuli (agar bu kelajakda bo'lsa — o'tgan yilniki). Sana aytilmagan bo'lsa "".
   - "description": xarajat sababi/tavsifi, qisqa va aniq.
   - "projectName": obyekt/loyiha/bino nomi (masalan "12-maktab", "Yunusobod turar joy") aytilgan bo'lsa AYNAN shu nom, aks holda "".
   - "recipientName": pul/material KIMGA berilgani (odam ismi yoki tashkilot, masalan "Aziz aka", "prorab Botir") aytilgan bo'lsa shu nom, aks holda "".
   - "category": FAQAT shulardan biri: "oylik" (ish haqi/avans), "material" (qurilish materiallari), "jihozlar" (asbob-uskuna, ijara), "transport" (yoqilg'i, yuk/yo'l xarajati), "boshqa" (qolgan hammasi).
Javob FAQAT JSON: {"transcript":"","cleanText":"","amount":0,"currency":"UZS","date":"","description":"","projectName":"","recipientName":"","category":"boshqa"}`;

export async function voiceToExpense(audio: Buffer, mimeType: string, today: string): Promise<ParsedExpense | null> {
  if (!geminiConfigured()) throw new Error('NO_GEMINI');
  const r = await geminiAudioToJson(audio, mimeType || 'audio/ogg', voicePrompt(today));
  const amount = Math.round((Number(r?.amount) || 0) * 100) / 100;
  const description = String(r?.description || '').trim();
  if (!(amount > 0 && amount < MAX_AMOUNT) || !description) return null;
  const currency: ExpCurrency = ['USD', 'EUR'].includes(String(r?.currency).toUpperCase()) ? String(r.currency).toUpperCase() as ExpCurrency : 'UZS';
  const dRaw = String(r?.date || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dRaw) && dRaw <= today ? dRaw : undefined;
  return {
    amount, description: description.slice(0, 300), currency, date,
    projectName: String(r?.projectName || '').trim() || undefined,
    recipientName: String(r?.recipientName || '').trim().slice(0, 120) || undefined,
    category: asCategory(r?.category) ?? guessExpenseCategory(description),
    transcript: String(r?.transcript || '').trim() || undefined,
    cleanText: String(r?.cleanText || '').trim().slice(0, 1500) || undefined,
  };
}

const fmtSum = (n: number) => n.toLocaleString('ru-RU');
export const fmtMoney = (n: number, cur: string = 'UZS') => cur === 'USD' ? `${n.toLocaleString('ru-RU')} $` : cur === 'EUR' ? `${n.toLocaleString('ru-RU')} €` : `${n.toLocaleString('ru-RU')} so'm`;

export const EXP_T = {
  uz: {
    prompt: "💸 *Chiqim qo'shish*\n\nMatn bilan shu tartibda yozing:\n`Summa; Tavsif; Obyekt; Kimga` (oxirgi ikkisi ixtiyoriy)\n\nMasalan: `150000; Sement uchun; 12-maktab; Aziz aka`\nYoki oddiy: `150000 sement uchun`\n\n🎙 Yoki *ovozli xabar* yuboring — men uni matnga aylantirib, tekshirish uchun ko'rsataman.",
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
    recipientLine: (s: string) => `👤 Kimga: ${s}`,
    moneyLine: (orig: string, uzs?: string) => `💰 Summa: ${orig}${uzs ? ` (≈ ${uzs} so'm)` : ''}`,
    dateLine: (d: string) => `📅 Sana: ${d}`,
    fullTextLine: (s: string) => `🗣 To'liq matn: ${s}`,
    historyTitle: "🧾 Oxirgi chiqimlaringiz:",
    historyEmpty: "Hali chiqim yo'q.",
    statusLabels: { pending: '⏳ kutilmoqda', confirmed: '✅ tasdiqlangan', rejected: '❌ rad etilgan' } as Record<string, string>,
    catBtn: '🏷 Turini o\'zgartirish',
    cats: { oylik: 'Oylik', material: 'Material', jihozlar: 'Jihozlar', transport: 'Transport', boshqa: 'Boshqa' } as Record<string, string>,
    ask: "To'g'rimi?",
    savedAdmin: (n: number) => `✅ Chiqim saqlandi: ${fmtSum(n)} so'm`,
    savedPending: (n: number, who: string) => `✅ Chiqim yuborildi: ${fmtSum(n)} so'm\n⏳ ${who} tasdiqlashini kuting.`,
    noApprover: "⚠️ Kompaniyada tasdiqlovchi (direktor/o'rinbosar) topilmadi — chiqim yaratilmadi.",
    error: "⚠️ Xatolik yuz berdi, keyinroq urinib ko'ring.",
  },
  ru: {
    prompt: "💸 *Добавить расход*\n\nНапишите текстом в таком порядке:\n`Сумма; Описание; Объект; Кому` (последние два необязательны)\n\nНапример: `150000; Цемент; Школа 12; Азиз`\nИли просто: `150000 цемент`\n\n🎙 Или отправьте *голосовое сообщение* — я переведу его в текст и покажу для проверки.",
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
    recipientLine: (s: string) => `👤 Кому: ${s}`,
    moneyLine: (orig: string, uzs?: string) => `💰 Сумма: ${orig}${uzs ? ` (≈ ${uzs} сум)` : ''}`,
    dateLine: (d: string) => `📅 Дата: ${d}`,
    fullTextLine: (s: string) => `🗣 Полный текст: ${s}`,
    historyTitle: "🧾 Ваши последние расходы:",
    historyEmpty: "Расходов пока нет.",
    statusLabels: { pending: '⏳ ожидает', confirmed: '✅ подтверждён', rejected: '❌ отклонён' } as Record<string, string>,
    catBtn: '🏷 Сменить тип',
    cats: { oylik: 'Зарплата', material: 'Материал', jihozlar: 'Оборудование', transport: 'Транспорт', boshqa: 'Прочее' } as Record<string, string>,
    ask: "Всё верно?",
    savedAdmin: (n: number) => `✅ Расход сохранён: ${fmtSum(n)} сум`,
    savedPending: (n: number, who: string) => `✅ Расход отправлен: ${fmtSum(n)} сум\n⏳ Ожидайте подтверждения: ${who}.`,
    noApprover: "⚠️ В компании не найден утверждающий (директор/заместитель) — расход не создан.",
    error: "⚠️ Произошла ошибка, попробуйте позже.",
  },
};
