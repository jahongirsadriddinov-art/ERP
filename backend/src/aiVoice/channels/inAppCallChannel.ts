import type { ChannelAdapter } from '../contracts';

// STUB (P1): yakuniy eksport nomi va turi. P5 shu faylni to'ldiradi — oxirgi 60 s ichida aiv:presence visible, 30 s qo'ng'iroq, bitta tabda atomik qabul; foydalanuvchi socket'i shu instansiyada bo'lmasa — unavailable + retryAt (+15 s).
// Hozircha har doim 'unavailable' qaytaradi (oqim keyingi kanalga o'tadi).
export const inAppCallChannel: ChannelAdapter = {
  name: 'inapp_call',
  async isAvailable() { return { ok: false, reason: 'not_implemented' }; },
  async attempt() { return { outcome: 'unavailable', retryable: false, errorCode: 'not_implemented' }; },
};

export default inAppCallChannel;
