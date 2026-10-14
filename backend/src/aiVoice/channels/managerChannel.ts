import type { ChannelAdapter } from '../contracts';

// STUB (P1): yakuniy eksport nomi va turi. P3 shu faylni to'ldiradi — lib/managers.resolveManagers orqali faqat SHU firma rahbarlariga.
// Hozircha har doim 'unavailable' qaytaradi (oqim keyingi kanalga o'tadi).
export const managerChannel: ChannelAdapter = {
  name: 'notify_manager',
  async isAvailable() { return { ok: false, reason: 'not_implemented' }; },
  async attempt() { return { outcome: 'unavailable', retryable: false, errorCode: 'not_implemented' }; },
};

export default managerChannel;
