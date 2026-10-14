// AI ovozli yordamchi — ilova ichidagi kichik "shina" (bus). Hech qanday React/DOM'ga bog'liq emas:
// App.tsx (WebRTC call:offer), AIAssistant/ChatPage (header tugmasi) va AiVoiceRoot shu orqali
// gaplashadi — bir-birini import qilmasdan (lazy chunk'lar alohida qoladi).

export type AiVoiceBusEvent =
  | { type: 'open'; source?: string }          // foydalanuvchi "AI bilan gaplashish"ni bosdi
  | { type: 'active'; active: boolean };        // AI qo'ng'iroq holati o'zgardi

type Listener = (e: AiVoiceBusEvent) => void;

const listeners = new Set<Listener>();
let aiCallActive = false;

function emit(e: AiVoiceBusEvent) {
  for (const l of Array.from(listeners)) {
    try { l(e); } catch { /* bitta tinglovchi xatosi boshqalarni to'xtatmasin */ }
  }
}

/** Tinglash; qaytgan funksiya obunani bekor qiladi. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * AI ovozli suhbatni ochish so'rovi. AiVoiceRoot montaj qilinmagan bo'lsa (tinglovchi yo'q) — false,
 * chaqiruvchi o'zi xabar berishi mumkin.
 */
export function openAiVoiceCall(source?: string): boolean {
  if (listeners.size === 0) return false;
  emit({ type: 'open', source });
  return true;
}

/** Hozir AI qo'ng'iroq (jiringlash yoki suhbat) faolmi — WebRTC call:offer'ni "band" deb rad etish uchun. */
export function isAiCallActive(): boolean {
  return aiCallActive;
}

/** Faqat AiVoiceRoot / useAiVoiceSession chaqiradi. */
export function setAiCallActive(active: boolean): void {
  if (aiCallActive === active) return;
  aiCallActive = active;
  emit({ type: 'active', active });
}

// ───────────── Qaror funksiyalari (sof, test qilinadi) ─────────────

export type CallOfferDecision = 'ignore' | 'busy' | 'ring';

/**
 * Kiruvchi WebRTC `call:offer` bilan nima qilish kerak (App.tsx onCallOffer):
 * - o'zimizdan kelgan yoki allaqachon WebRTC qo'ng'iroqdamiz → 'ignore' (CallOverlay mesh'ni o'zi boshqaradi);
 * - AI qo'ng'iroq faol → 'busy' (call:reject {reason:'busy'} yuboriladi, AI suhbat uzilmaydi);
 * - aks holda → 'ring'.
 */
export function decideCallOffer(o: { from?: unknown; selfId: string; webrtcActive: boolean; aiActive: boolean }): CallOfferDecision {
  if (!o.from || String(o.from) === o.selfId) return 'ignore';
  if (o.webrtcActive) return 'ignore';
  if (o.aiActive) return 'busy';
  return 'ring';
}

export type AiIncomingDecision = 'busy' | 'unsupported' | 'ring';

/**
 * Kiruvchi `aiv:incoming` bilan nima qilish kerak (AiVoiceRoot):
 * - WebRTC qo'ng'iroq faol (busy prop) → 'busy' — odamlar orasidagi qo'ng'iroq hech qachon uzilmaydi;
 * - mijoz audio qo'llamaydi (yoki P7 hali yo'q) → 'unsupported' — server darhol keyingi kanalga o'tadi;
 * - aks holda → 'ring'.
 */
export function decideAiIncoming(o: { busy: boolean; supported: boolean }): AiIncomingDecision {
  if (o.busy) return 'busy';
  if (!o.supported) return 'unsupported';
  return 'ring';
}

/** Faqat testlar uchun: holatni tozalash. */
export function __resetAiVoiceBus(): void {
  listeners.clear();
  aiCallActive = false;
}
