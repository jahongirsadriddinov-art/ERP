import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { RESOURCES } from './translations';
import { transliterateDict } from './transliterate';
import * as nsReports from './ns/reports';
import * as nsCall from './ns/call';
import * as nsAi from './ns/ai';
import * as nsDevPanel from './ns/devPanel';
import * as nsChat from './ns/chat';
import * as nsAiVoice from './ns/aiVoice';
import * as nsAiVoiceCall from './ns/aiVoiceCall';
import * as nsExtra from './ns/extra';
import * as nsChatUi from './ns/chatUi';

// Chuqur birlashtirish — qo'shimcha kalitlar mavjud bo'limlarga qo'shiladi, ularni almashtirmaydi
const deepMerge = (base: any, add: any): any => {
  const out: any = { ...base };
  for (const k of Object.keys(add)) out[k] = add[k] && typeof add[k] === 'object' && !Array.isArray(add[k]) && base?.[k] && typeof base[k] === 'object' ? deepMerge(base[k], add[k]) : (base?.[k] ?? add[k]);
  return out;
};

export type SiteLang = 'uz' | 'uz-cyrl' | 'ru';

// Alohida sahifalar uchun tarjima agentlari tomonidan yaratilgan mustaqil
// nom-fazolar (namespace) — har biri o'z faylida, faqat shu yerda markaziy
// resurslarga qo'shiladi (fayllarning o'zi bir-biriga bog'liq emas, mos
// kelmaslik xavfisiz parallel ishlab chiqilgan).
const uzMerged = deepMerge({
  ...RESOURCES.uz,
  ...nsReports.uz,
  ...nsCall.uz,
  ...nsDevPanel.uz,
  ai: nsAi.uz,
  chat: nsChat.uz,
  aiVoice: nsAiVoice.uz,
  aiVoiceCall: nsAiVoiceCall.uz,
  chatUi: nsChatUi.uz,
}, nsExtra.uz);
const ruMerged = deepMerge({
  ...RESOURCES.ru,
  ...nsReports.ru,
  ...nsCall.ru,
  ...nsDevPanel.ru,
  ai: nsAi.ru,
  chat: nsChat.ru,
  aiVoice: nsAiVoice.ru,
  aiVoiceCall: nsAiVoiceCall.ru,
  chatUi: nsChatUi.ru,
}, nsExtra.ru);

const uzCyrl = transliterateDict(uzMerged);

i18n.use(initReactI18next).init({
  resources: {
    uz: { translation: uzMerged },
    'uz-cyrl': { translation: uzCyrl },
    ru: { translation: ruMerged },
  },
  lng: (localStorage.getItem('siteLang') as SiteLang) || 'uz',
  fallbackLng: 'uz',
  // MUHIM: i18next hyphenated kodlarni (masalan "uz-cyrl") Intl.getCanonicalLocales
  // orqali "uz-Cyrl" (katta C) ga aylantirib ICHKI holatda shu bilan ishlaydi —
  // agar bu yoqilmasa, resurslar 'uz-cyrl' (kichik) kaliti bilan hech qachon
  // topilmaydi va sekinlashib fallbackLng='uz'ga tushib qoladi (kirill hech
  // qachon ko'rinmaydi). lowerCaseLng bularni bir xil pastki registrga tushiradi.
  lowerCaseLng: true,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

// <html lang="..."> atributini aktiv tilga mos ravishda yangilaymiz.
// Bu brauzerning "Language detection is not supported for this page" xabarini
// bartaraf etadi (Chrome o'zi tarjima qilmoqchi bo'lganda bu atributga qaraydi).
// uz-cyrl uchun standart BCP 47 kod "uz" (kirill lotin farqi skript teglarda).
function syncHtmlLang(lng: string) {
  const bcp47 = lng === 'ru' ? 'ru' : 'uz';
  document.documentElement.setAttribute('lang', bcp47);
}
syncHtmlLang(i18n.language);
i18n.on('languageChanged', syncHtmlLang);

export function setSiteLanguage(lang: SiteLang) {
  localStorage.setItem('siteLang', lang);
  i18n.changeLanguage(lang);
}

export function langLabel(lang: SiteLang): string {
  return lang === 'ru' ? 'Русский' : lang === 'uz-cyrl' ? 'Ўзбек (кирилл)' : "O'zbek";
}

export default i18n;
