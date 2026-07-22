import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { RESOURCES } from './translations';
import { transliterateDict } from './transliterate';
import * as nsReports from './ns/reports';
import * as nsCall from './ns/call';
import * as nsAi from './ns/ai';
import * as nsDevPanel from './ns/devPanel';

export type SiteLang = 'uz' | 'uz-cyrl' | 'ru';

// Alohida sahifalar uchun tarjima agentlari tomonidan yaratilgan mustaqil
// nom-fazolar (namespace) — har biri o'z faylida, faqat shu yerda markaziy
// resurslarga qo'shiladi (fayllarning o'zi bir-biriga bog'liq emas, mos
// kelmaslik xavfisiz parallel ishlab chiqilgan).
const uzMerged = {
  ...RESOURCES.uz,
  ...nsReports.uz,
  ...nsCall.uz,
  ...nsDevPanel.uz,
  ai: nsAi.uz,
};
const ruMerged = {
  ...RESOURCES.ru,
  ...nsReports.ru,
  ...nsCall.ru,
  ...nsDevPanel.ru,
  ai: nsAi.ru,
};

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

export function setSiteLanguage(lang: SiteLang) {
  localStorage.setItem('siteLang', lang);
  i18n.changeLanguage(lang);
}

export function langLabel(lang: SiteLang): string {
  return lang === 'ru' ? 'Русский' : lang === 'uz-cyrl' ? 'Ўзбек (кирилл)' : "O'zbek";
}

export default i18n;
