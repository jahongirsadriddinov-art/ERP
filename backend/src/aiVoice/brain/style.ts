// Javob uslubi va qisqa javoblar (owner 2026-10-17):
//  • #1 "AI ikki marta salomlashadi" — salom suhbat boshida allaqachon aytilgan bo'lsa (bot kutib olish
//    xabari, qo'ng'iroq kirish ovozi yoki tarixda AI javobi bor) — javob boshidagi salom/o'zini tanishtirish olib tashlanadi;
//  • #4 matnli tasdiq — "ha" / "yo'q" kabi SOF javob (boshqa so'zsiz) kutilayotgan amalni shu joyda hal qiladi.

const GREETING_RE = /^\s*(assalomu?\s*alaykum|assalom|salom(\s*alaykum)?|va\s*alaykum(\s*assalom)?|здравствуйте|привет|добрый\s*(день|вечер)|доброе\s*утро|xayrli\s*(kun|tong|kech))[\s!.,—–-]*/i;
const INTRO_RE = /^\s*(men\s+[^.!?\n]{0,60}(sun['ʻ’`]?iy\s+intellekt|ai)\s+yordamchi(si)?(man)?|я\s+[^.!?\n]{0,40}(ии|ai|искусственн)[^.!?\n]{0,40}помощник)[^.!?\n]*[.!]?\s*/i;

/** Foydalanuvchining o'zi salom berganmi (shunda bir so'zli alik joiz). */
export const isGreeting = (text: string): boolean => GREETING_RE.test(String(text || '').slice(0, 60));

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

const AFFIRM_ONLY = /^(ha|xa|haa+|ha\s*ha|albatta|mayli|roziman|tasdiq(la|layman|lang|lash)?|ok|okey|xo['ʻ’`]?p|bo['ʻ’`]?pti|да|ага|подтверждаю|подтверди|конечно|хорошо|давай)$/i;
const NEGATE_ONLY = /^(yo['ʻ’`]?q|yoq|kerak\s*emas|bekor(\s*qil)?|to['ʻ’`]?xta|нет|не\s*надо|отмена|отмени)$/i;

/** Sof "ha" (true) / sof "yo'q" (false) / boshqa (null). Tinish belgilari e'tiborsiz. */
export function pureYesNo(text: string): boolean | null {
  const t = String(text || '').toLowerCase().replace(/[!.,?;:)(«»"“”…]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 24) return null;
  if (AFFIRM_ONLY.test(t)) return true;
  if (NEGATE_ONLY.test(t)) return false;
  return null;
}

/** AI oldingi javobida tasdiq so'raganmi. */
export const askedToConfirm = (lastAssistant: string): boolean => /tasdiq|подтвер/i.test(String(lastAssistant || '').slice(-500));
