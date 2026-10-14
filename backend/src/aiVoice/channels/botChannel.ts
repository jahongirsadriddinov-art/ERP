import type { ChannelAdapter } from '../contracts';

// STUB (P1): yakuniy eksport nomi va turi. P4 shu faylni to'ldiradi — sendToUser messageId qaytaradi, 403 → kontakt bloklangan, 429 retry_after → retryAt; bot.ts modul darajasida import qilinmaydi (bot/botHooks.getBotInstance).
// Hozircha har doim 'unavailable' qaytaradi (oqim keyingi kanalga o'tadi).
export const botChannel: ChannelAdapter = {
  name: 'bot_message',
  async isAvailable() { return { ok: false, reason: 'not_implemented' }; },
  async attempt() { return { outcome: 'unavailable', retryable: false, errorCode: 'not_implemented' }; },
};

export default botChannel;
