import type { ChannelAdapter } from '../contracts';

// STUB (P1): yakuniy eksport nomi va turi. P6 shu faylni to'ldiradi — faqat worker ulangan instansiyada; worker vaqtincha uzilsa — fallback emas, qayta navbat (retryAt).
// Hozircha har doim 'unavailable' qaytaradi (oqim keyingi kanalga o'tadi).
export const telegramCallChannel: ChannelAdapter = {
  name: 'telegram_call',
  async isAvailable() { return { ok: false, reason: 'not_implemented' }; },
  async attempt() { return { outcome: 'unavailable', retryable: false, errorCode: 'not_implemented' }; },
};

export default telegramCallChannel;
