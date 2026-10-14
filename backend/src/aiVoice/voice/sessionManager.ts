import type { StartVoiceSessionOpts, StartVoiceSessionResult, VoiceSessionHandle, VoiceSessionManagerApi } from './types';

// STUB (P1): yakuniy imzo. P5 VoiceSessionManager'ni shu faylda amalga oshiradi (geminiLive/cascade,
// disclosure, platforma semafori — faol sessiyalarni sanash, updatedAt har 15 s, ~500 ms chiqish navbati).
// P6 (Telegram ko'prigi) va P5 in-app socket menejerni FAQAT getVoiceSessionManager() orqali oladi;
// bootstrap SIGTERM'da drain() ni chaqiradi. Sessiyani yakunlovchi har bir yo'l sessions.finishSession()
// (yoki endActiveSessions) orqali o'tadi — shunda P3 runner onSessionsEnded orqali keyingi qadamni qo'yadi.

class DisabledVoiceSessionManager implements VoiceSessionManagerApi {
  async start(_opts: StartVoiceSessionOpts): Promise<StartVoiceSessionResult> { return { ok: false, reason: 'disabled' }; }
  get(_id: string): VoiceSessionHandle | undefined { return undefined; }
  async endAllForUser(_userId: string): Promise<number> { return 0; }
  async drain(_timeoutMs: number): Promise<void> { /* P5 */ }
}

let manager: VoiceSessionManagerApi = new DisabledVoiceSessionManager();

export function getVoiceSessionManager(): VoiceSessionManagerApi { return manager; }

/** P5 (yoki testlar soxtasini) ulaydi. */
export function setVoiceSessionManager(m: VoiceSessionManagerApi): void { manager = m; }
