import { sanitizeForPrompt } from '../../lib/untrusted';
import type { AiToolDef } from '../types';
import { ALL_CHANNELS, L, ok } from '../erp/common';

// Tarjimon rejimi (owner 2026-10-18): FAQAT direktor va o'rinbosar (firma egasi — direktor roli orqali).
// "Sen tarjimonsan, o'zbekcha va inglizcha" → AI ikki tomon gapini bir-biriga tarjima qiladi: A tilida
// eshitsa — B tiliga, B tilida eshitsa — A tiliga. O'zidan hech narsa qo'shmaydi. "Tarjimonni o'chir" → oddiy rejim.
// Holat suhbat tarixida (tool natijasi) turadi — alohida saqlash kerak emas; Live sessiyada model shu
// natijaga amal qiladi.

const LANG_NAMES: Record<string, { uz: string; ru: string; en: string }> = {
  uz: { uz: "o'zbek", ru: 'узбекский', en: 'Uzbek' }, ru: { uz: 'rus', ru: 'русский', en: 'Russian' },
  en: { uz: 'ingliz', ru: 'английский', en: 'English' }, tr: { uz: 'turk', ru: 'турецкий', en: 'Turkish' },
  zh: { uz: 'xitoy', ru: 'китайский', en: 'Chinese' }, ar: { uz: 'arab', ru: 'арабский', en: 'Arabic' },
  kk: { uz: 'qozoq', ru: 'казахский', en: 'Kazakh' }, ky: { uz: "qirg'iz", ru: 'киргизский', en: 'Kyrgyz' },
  tg: { uz: 'tojik', ru: 'таджикский', en: 'Tajik' }, ko: { uz: 'koreys', ru: 'корейский', en: 'Korean' },
  de: { uz: 'nemis', ru: 'немецкий', en: 'German' }, fr: { uz: 'fransuz', ru: 'французский', en: 'French' },
  fa: { uz: 'fors', ru: 'персидский', en: 'Persian' }, hi: { uz: 'hind', ru: 'хинди', en: 'Hindi' },
  ja: { uz: 'yapon', ru: 'японский', en: 'Japanese' }, es: { uz: 'ispan', ru: 'испанский', en: 'Spanish' },
};
const LANG_CODES = Object.keys(LANG_NAMES);

/** Model ba'zan nom beradi ("inglizcha", "english") — kodga keltiramiz; noma'lum bo'lsa tozalangan nom. */
export function langLabel(v: unknown, ui: 'uz' | 'ru'): string {
  const s = String(v || '').trim().toLowerCase();
  if (LANG_NAMES[s]) return LANG_NAMES[s][ui];
  for (const [code, n] of Object.entries(LANG_NAMES)) {
    if (s.startsWith(n.uz.slice(0, 4)) || s.startsWith(n.en.toLowerCase().slice(0, 4)) || s.startsWith(n.ru.slice(0, 4))) return LANG_NAMES[code][ui];
  }
  return sanitizeForPrompt(s, 20) || (ui === 'ru' ? 'другой' : 'boshqa');
}

export const setTranslatorMode: AiToolDef<{ on: boolean; langA?: string; langB?: string }> = {
  name: 'setTranslatorMode',
  description: {
    uz: "Tarjimon rejimi (faqat rahbar): on=true — ikki til orasida jonli tarjima (langA ↔ langB, masalan uz va en); on=false — oddiy rejimga qaytish.",
    ru: 'Режим переводчика (только руководитель): on=true — синхронный перевод между двумя языками (langA ↔ langB, напр. uz и en); on=false — обычный режим.',
  },
  parameters: {
    type: 'object',
    properties: {
      on: { type: 'boolean' },
      langA: { type: 'string', maxLength: 20, description: `Til kodi (${LANG_CODES.join(', ')}) yoki nomi; standart uz` },
      langB: { type: 'string', maxLength: 20, description: "Ikkinchi til (masalan en, ru, tr, zh)" },
    },
    required: ['on'],
  },
  kind: 'read',
  confirm: 'never',
  general: true,
  maxRoles: ['direktor', 'orinbosar'],
  defaultRoles: ['direktor', 'orinbosar'],
  purposes: ['assistant'],
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  handler: async (ctx, args) => {
    const ui = ctx.lang === 'ru' ? 'ru' : 'uz';
    if (!args.on) {
      return ok(L(ctx, 'Tarjimon rejimi o\'chirildi — endi oddiy yordamchiman.', 'Режим переводчика выключен.'), {
        mode: 'assistant',
        instruction: 'TARJIMON REJIMI TUGADI. Oddiy AI yordamchi sifatida davom eting.',
      });
    }
    const a = langLabel(args.langA || 'uz', ui);
    const b = langLabel(args.langB || (String(args.langA || '').toLowerCase().startsWith('uz') ? 'en' : 'ru'), ui);
    const rule = `TARJIMON REJIMI YOQILDI (${a} ↔ ${b}). Endi siz FAQAT tarjimonsiz: ${a} tilidagi har bir gapni ${b} tiliga, `
      + `${b} tilidagi gapni ${a} tiliga to'liq va aniq tarjima qilib ayting. O'zingizdan izoh, savol, salom QO'SHMANG, `
      + `"tarjima:" demang — faqat tarjimaning o'zi. Ma'noni saqlang, so'zma-so'z emas; raqam, ism, narxni aynan o'tkazing. `
      + `Faqat "tarjimonni o'chir", "tarjima bas", "выключи переводчик" deyilsa — setTranslatorMode(on=false).`;
    return ok(L(ctx, `Tarjimon rejimi: ${a} ↔ ${b}. Gapiravering.`, `Режим переводчика: ${a} ↔ ${b}. Говорите.`), { mode: 'translator', langA: a, langB: b, instruction: rule });
  },
};
