// Javob uslubi va qisqa javoblar (owner 2026-10-17):
//  • #1 "AI ikki marta salomlashadi" — salom suhbat boshida allaqachon aytilgan bo'lsa (bot kutib olish
//    xabari, qo'ng'iroq kirish ovozi yoki tarixda AI javobi bor) — javob boshidagi salom/o'zini tanishtirish olib tashlanadi;
//  • #4 matnli tasdiq — "ha" / "yo'q" kabi SOF javob (boshqa so'zsiz) kutilayotgan amalni shu joyda hal qiladi.

const GREETING_RE = /^\s*(assalomu?\s*alaykum|assalom|salom(\s*alaykum)?|va\s*alaykum(\s*assalom)?|здравствуйте|привет|добрый\s*(день|вечер)|доброе\s*утро|xayrli\s*(kun|tong|kech))[\s!.,—–-]*/i;
const INTRO_RE = /^\s*(men\s+[^.!?\n]{0,60}(sun['ʻ’`]?iy\s+intellekt|ai)\s+yordamchi(si)?(man)?|я\s+[^.!?\n]{0,40}(ии|ai|искусственн)[^.!?\n]{0,40}помощник)[^.!?\n]*[.!]?\s*/i;

/** Foydalanuvchining o'zi salom berganmi (shunda bir so'zli alik joiz). */
export const isGreeting = (text: string): boolean => {
  const t = String(text || '').slice(0, 60);
  return GREETING_RE.test(t) || (hasCyrillic(t) && GREETING_RE.test(toLatinUz(t)));   // "салом", "ассалому алайкум"
};

/**
 * Takroriy salom/tanishtiruvni olib tashlaydi. Foydalanuvchi salom bergan bo'lsa — tegilmaydi.
 * Natija bo'sh qolsa — asl matn qaytadi.
 */
export function stripRepeatedGreeting(reply: string, userText: string): string {
  const src = String(reply || '');
  if (!src.trim() || isGreeting(userText)) return src;
  let out = src.replace(GREETING_RE, '');
  out = out.replace(INTRO_RE, '');
  out = out.trim();
  if (!out) return src;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// Kirill yozuvidagi o'zbekcha → lotin (owner 2026-10-22: "ҳа, тасдиқлайман" ham tushunilsin; bot/chat uz-cyrl
// foydalanuvchisining tarixidagi AI javobi ham kirillda saqlanadi — "Тасдиқлаш керак"). Rus so'zlari ham lotinga
// o'tadi, shuning uchun tekshiruvlar avval ASL matnda, keyin lotin nusxada qilinadi.
const CYR_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: "g'", д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', қ: 'q',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ў: "o'", ф: 'f', х: 'x', ҳ: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: "'", ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
export const hasCyrillic = (s: string): boolean => /[Ѐ-ӿ]/.test(s);
export function toLatinUz(input: string): string {
  const s = String(input || '');
  if (!hasCyrillic(s)) return s;
  let out = '';
  for (const ch of s) {
    const lo = ch.toLowerCase();
    const lat = CYR_LAT[lo];
    if (lat === undefined) { out += ch; continue; }
    out += ch !== lo && lat ? lat.charAt(0).toUpperCase() + lat.slice(1) : lat;
  }
  return out;
}
/** Turli apostroflar (telefon klaviaturasi ’ ‘ ʻ ʼ `) → oddiy ' . */
export const normApostrophes = (s: string): string => String(s || '').replace(/[‘’ʻʼ`´]/g, "'");

const AFFIRM_ONLY = /^(ha|xa|haa+|xaa+|ha\s*ha|albatta|mayli|roziman|tasdiq(la|layman|lang|lash|ladim)?|ok|okay|okey|xo'?p|ho'?p|bo'?pti|bo'?ladi|yaxshi|yes|да|ага|угу|ок|окей|ладно|подтверждаю|подтверди|подтвердить|конечно|хорошо|давай|давайте)$/i;
const NEGATE_ONLY = /^(yo'?q|yoq|kerak\s*emas|kerakmas|shart\s*emas|shartmas|bekor(\s*qil(ing)?)?|to'?xta(ng)?|stop|no|нет|не\s*надо|не\s*нужно|отмена|отмени(те)?|стоп)$/i;

// Owner 2026-10-22: "ha tasdiqlayman desam ham aniq tasdiqlaysizmi deyapti" — faqat BITTA so'z tan olinardi.
// Endi faqat tasdiq/rad so'zlaridan iborat qisqa ibora ham sof javob ("ha tasdiqlayman", "ha albatta qiling",
// "yo'q kerak emas"). Boshqa mazmunli so'z bo'lsa ("ha, lekin 20 ga") — sof emas (model hal qiladi).
const AFFIRM_WORDS = new Set([
  'ha', 'xa', 'haa', 'haaa', 'albatta', 'mayli', 'roziman', 'tasdiq', 'tasdiqla', 'tasdiqlayman', 'tasdiqlang', 'tasdiqlash',
  'tasdiqladim', 'ok', 'okay', 'okey', 'xop', "xo'p", 'hop', "ho'p", 'bopti', "bo'pti", 'boladi', "bo'ladi", 'yaxshi', 'qil', 'qiling',
  'qilaver', 'qilavering', 'qilaqol', 'bajar', 'bajaring', 'yubor', 'yuboring', 'yuboravering', "jo'nat", "jo'nating", "qo'y", "qo'ying",
  "to'g'ri", 'togri', 'ayni', 'shunday', 'aynan', 'davom', 'et', 'eting', 'rahmat', 'mumkin', 'da', 'davay', 'yes',
  'да', 'ага', 'угу', 'ок', 'окей', 'ладно', 'подтверждаю', 'подтверди', 'подтвердить', 'конечно', 'хорошо', 'давай', 'давайте',
  'делай', 'делайте', 'отправляй', 'отправь', 'отправьте', 'верно', 'согласен', 'согласна', 'спасибо',
]);
const NEGATE_WORDS = new Set([
  "yo'q", 'yoq', 'kerak', 'kerakmas', 'emas', 'shart', 'shartmas', 'bekor', 'qil', 'qiling', "to'xta", 'toxta', "to'xtang",
  'qilma', 'qilmang', 'yuborma', 'yubormang', 'hozir', 'keyin', 'keyinroq', 'rahmat', 'stop', 'no',
  'нет', 'не', 'надо', 'нужно', 'отмена', 'отмени', 'отмените', 'отменить', 'спасибо', 'стоп', 'потом', 'отправляй',
]);
const NEG_HEAD = /^(yo'?q|yoq|bekor|to'?xta|qilma|yuborma|kerak\s*emas|kerakmas|shart\s*emas|shartmas|stop|нет|не\s*(надо|нужно|отправляй)|отмен|стоп)/i;
const YES_EMOJI = /^(👍|👌|✅|🆗|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿)+$/u;
const NO_EMOJI = /^(👎|❌|🚫|✋)+$/u;

function classifyYesNo(t: string): boolean | null {
  if (AFFIRM_ONLY.test(t)) return true;
  if (NEGATE_ONLY.test(t)) return false;
  const words = t.split(' ');
  if (words.length > 5) return null;
  if (NEG_HEAD.test(t) && words.every((w) => NEGATE_WORDS.has(w))) return false;
  // "qil" yolg'iz tasdiq emas — kamida bitta aniq tasdiq so'zi bo'lsin (ha, albatta, tasdiqlayman...)
  if (!NEG_HEAD.test(t) && words.every((w) => AFFIRM_WORDS.has(w)) && words.some((w) => AFFIRM_ONLY.test(w))) return true;
  return null;
}

/**
 * Sof "ha" (true) / sof "yo'q" (false) / boshqa (null). Tinish belgilari e'tiborsiz; lotin, kirill (o'zbek) va rus;
 * apostrof turlari (’ ‘ ʻ) bir xil; 👍 / 👎.
 */
export function pureYesNo(text: string): boolean | null {
  const raw = String(text || '').trim();
  if (YES_EMOJI.test(raw.replace(/\s+/g, ''))) return true;
  if (NO_EMOJI.test(raw.replace(/\s+/g, ''))) return false;
  const t = normApostrophes(raw.toLowerCase()).replace(/[!.,?;:)(«»"“”…\-–—]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 40) return null;
  const r = classifyYesNo(t);
  if (r !== null || !hasCyrillic(t)) return r;
  return classifyYesNo(normApostrophes(toLatinUz(t)));
}

/** AI oldingi javobida tasdiq so'raganmi (lotin, kirill yoki rus). */
export const askedToConfirm = (lastAssistant: string): boolean => {
  const tail = String(lastAssistant || '').slice(-500);
  return /tasdiq|подтвер/i.test(tail) || /tasdiq/i.test(toLatinUz(tail));
};

// Faqat salomlashish ("salom", "assalomu alaykum, qalaysiz?", "привет, как дела") — boshqa so'rov yo'q.
const SMALLTALK_WORDS = new Set([
  'qalaysiz', 'qalesiz', 'yaxshimisiz', 'qandaysiz', 'ishlar', 'qalay', 'nima', 'gap', 'gaplar', 'yaxshi', 'mi', 'aka', 'opa', 'ai',
  'bot', 'yordamchi', 'hammasi', 'joyidami', 'tinchlikmi', 'tinchmi', 'charchamang', 'salom', 'assalomu', 'alaykum', 'brat', 'do\'stim',
  'как', 'дела', 'вы', 'ты', 'поживаете', 'всё', 'все', 'хорошо', 'нормально', 'привет', 'здравствуйте', 'бот',
]);
export function isPureGreeting(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 60 || !isGreeting(raw)) return false;
  const src = GREETING_RE.test(raw) ? raw : toLatinUz(raw);
  const rest = normApostrophes(src.replace(GREETING_RE, '').toLowerCase()).replace(/[!.,?;:)(«»"“”…\-–—]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!rest) return true;
  const words = rest.split(' ');
  return words.length <= 5 && words.every((w) => SMALLTALK_WORDS.has(w) || SMALLTALK_WORDS.has(toLatinUz(w)));
}
