import type { ChannelAdapter } from '../contracts';

// STUB (P1): yakuniy eksport nomi va turi. P3 shu faylni to'ldiradi — faqat createNotification (u o'zi sendPushToUser'ni chaqiradi — ikki marta push bo'lmasin).
// Hozircha har doim 'unavailable' qaytaradi (oqim keyingi kanalga o'tadi).
export const pushChannel: ChannelAdapter = {
  name: 'push',
  async isAvailable() { return { ok: false, reason: 'not_implemented' }; },
  async attempt() { return { outcome: 'unavailable', retryable: false, errorCode: 'not_implemented' }; },
};

export default pushChannel;
