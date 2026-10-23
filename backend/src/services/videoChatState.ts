// Guruh video chat holati uchun sof yordamchilar (services/socket.ts). Bazada "yarim" activeVideoChat
// (startedAt/mode'siz) uchrashi mumkin edi — shu sabab hisob-kitob hech qachon NaN bermaydi.

/** Yaroqli sana yoki null. */
export function safeDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as any);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Davomiylik (soniya) — startedAt yo'q/yaroqsiz yoki kelajakda bo'lsa 0; hech qachon NaN emas. */
export function videoChatDurationSec(startedAt: unknown, endedAt: Date = new Date()): number {
  const s = safeDate(startedAt);
  const e = safeDate(endedAt);
  if (!s || !e) return 0;
  const sec = Math.round((e.getTime() - s.getTime()) / 1000);
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

/** Schema'dagi required maydonlarning hammasi bor — saqlash validatsiyadan o'tadi. */
export function isValidActiveVideoChat(avc: any): boolean {
  if (!avc) return false;
  return !!avc.startedBy && !!avc.startedByName && !!safeDate(avc.startedAt) && (avc.mode === 'voice' || avc.mode === 'video');
}
