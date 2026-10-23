// AI ovozli yordamchi sozlamalari tarjimalari (`aiVoice.*`, ~90 KB) faqat shu sozlamalar
// sahifalarida kerak — asosiy bundle'dan chiqarilgan: ularni ishlatadigan har bir (lazy) modul
// shu faylni import qiladi va kalitlar komponent chizilishidan OLDIN qo'shiladi.
// './index' emas, i18next'ning o'zi import qilinadi (o'sha yagona nusxa) — index.ts brauzer
// muhitini (localStorage) talab qiladi, sof unit-testlarda bu modul yuklanishi kerak.
import i18n from 'i18next';
import { uz, ru } from './ns/aiVoice';
import { transliterateDict } from './transliterate';

function addAiVoiceNs() {
  i18n.addResourceBundle('uz', 'translation', { aiVoice: uz }, true, true);
  i18n.addResourceBundle('ru', 'translation', { aiVoice: ru }, true, true);
  i18n.addResourceBundle('uz-cyrl', 'translation', transliterateDict({ aiVoice: uz }), true, true);
}
if (i18n.store) addAiVoiceNs(); else i18n.on('initialized', addAiVoiceNs);
