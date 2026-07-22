import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { RESOURCES } from './translations';
import { transliterateDict } from './transliterate';

export type SiteLang = 'uz' | 'uz-cyrl' | 'ru';

const uzCyrl = transliterateDict(RESOURCES.uz);

i18n.use(initReactI18next).init({
  resources: {
    uz: { translation: RESOURCES.uz },
    'uz-cyrl': { translation: uzCyrl },
    ru: { translation: RESOURCES.ru },
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
