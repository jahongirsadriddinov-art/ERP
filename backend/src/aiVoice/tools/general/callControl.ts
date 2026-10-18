import AiActionAudit from '../../../models/AiActionAudit';
import type { Purpose, ToolChannel } from '../../contracts';
import type { AiToolDef, ToolCtx } from '../types';
import { ALL_ROLES, L, ok } from '../erp/common';

// Ovozli qo'ng'iroqni boshqarish (owner 2026-10-17 #3, #4):
//  • endCall — "telefonni o'chir", "qo'yib qo'y": AI xayrlashadi va qo'ng'iroq bir necha soniyadan keyin tugaydi
//    (faqat SHU sessiya va SHU foydalanuvchi; sessiya menejeri shu jarayonda).
//  • answerPendingAction — ovozli tasdiq: AI "Tasdiqlaysizmi?" deb so'raydi, foydalanuvchi "ha"/"yo'q" deydi.
//    Model ID bermaydi — SHU sessiyada yaratilgan eng oxirgi kutilayotgan amal olinadi (boshqa kanal/sessiya
//    amallarini tasdiqlay olmaydi). Matnli kaskadda agent foydalanuvchi so'zini ham tekshiradi (toolPolicy).

const VOICE: ToolChannel[] = ['inapp_call', 'telegram_call'];
const ALL_PURPOSES: Purpose[] = ['assistant', 'attendance', 'reminder', 'test'];
/** Xayrlashuv jumlasi eshitilishi uchun kutish. */
export const END_CALL_DELAY_MS = 3_500;

export type EndCallHook = (sessionId: string, userId: string, delayMs: number) => Promise<boolean>;

const defaultEndHook: EndCallHook = async (sessionId, userId, delayMs) => {
  // Dinamik: sessiya menejeri executor'ni import qiladi (aylanma import bo'lmasin)
  const { getVoiceSessionManager } = await import('../../voice/sessionManager');
  const h = getVoiceSessionManager().get(sessionId);
  if (!h || (h.employeeId && h.employeeId !== userId) || h.state === 'ending' || h.state === 'ended') return false;
  const t = setTimeout(() => { void h.end('completed').catch(() => undefined); }, delayMs);
  t.unref?.();
  return true;
};
let endHook: EndCallHook = defaultEndHook;
/** Testlar uchun. */
export function setEndCallHook(h: EndCallHook | null): void { endHook = h || defaultEndHook; }

export const endCall: AiToolDef<Record<string, never>> = {
  name: 'endCall',
  description: {
    uz: "Joriy ovozli qo'ng'iroqni tugatish (foydalanuvchi \"telefonni o'chir\", \"qo'yib qo'y\", \"xayr\" desa). Avval bir qisqa xayrlashuv jumlasi.",
    ru: 'Завершить текущий голосовой звонок (пользователь просит положить трубку). Сначала одна короткая фраза прощания.',
  },
  parameters: { type: 'object', properties: {} },
  kind: 'write',
  confirm: 'never',
  general: true,
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ALL_PURPOSES,
  channels: VOICE,
  behavior: 'BLOCKING',
  auditEntity: 'ai_call',
  handler: async (ctx) => {
    if (!ctx.sessionId) return { status: 'error', message: L(ctx, "Faol qo'ng'iroq yo'q.", 'Нет активного звонка.'), retryable: false };
    const done = await endHook(ctx.sessionId, ctx.userId, END_CALL_DELAY_MS).catch(() => false);
    if (!done) return { status: 'not_found', message: L(ctx, "Faol qo'ng'iroq topilmadi.", 'Активный звонок не найден.'), retryable: false };
    return ok(L(ctx, "Qo'ng'iroq bir necha soniyada tugaydi. Faqat bitta qisqa xayrlashuv jumlasini ayting.",
      'Звонок завершится через несколько секунд. Скажите только одну короткую фразу прощания.'));
  },
};

async function latestPendingInSession(ctx: ToolCtx): Promise<string | null> {
  const row: any = await AiActionAudit.findOne({
    companyId: String(ctx.companyId), actorUserId: String(ctx.userId), sessionId: ctx.sessionId,
    status: 'needs_confirmation', 'pending.expiresAt': { $gt: new Date() },
  }).sort({ createdAt: -1 }).select('_id').lean();
  return row ? String(row._id) : null;
}

export const answerPendingAction: AiToolDef<{ accept: boolean }> = {
  name: 'answerPendingAction',
  description: {
    uz: "Ovozli tasdiq: siz \"Tasdiqlaysizmi?\" deb so'ragan amalga foydalanuvchining javobi. \"ha/tasdiqlayman\" → accept=true, \"yo'q/bekor\" → accept=false. Faqat foydalanuvchi aniq javob bergandan keyin.",
    ru: 'Голосовое подтверждение: ответ пользователя на ваш вопрос «Подтверждаете?». «да» → accept=true, «нет» → accept=false. Только после явного ответа.',
  },
  parameters: {
    type: 'object',
    properties: { accept: { type: 'boolean', description: 'true — tasdiqlash, false — bekor qilish' } },
    required: ['accept'],
  },
  kind: 'write',
  confirm: 'never',
  spokenConfirm: true,
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ALL_PURPOSES,
  channels: VOICE,
  behavior: 'BLOCKING',
  handler: async (ctx, args) => {
    if (!ctx.sessionId) return { status: 'not_found', message: L(ctx, "Tasdiq kutayotgan amal yo'q.", 'Нет действия, ожидающего подтверждения.'), retryable: false };
    const id = await latestPendingInSession(ctx);
    if (!id) return { status: 'not_found', message: L(ctx, "Tasdiq kutayotgan amal yo'q.", 'Нет действия, ожидающего подтверждения.'), retryable: false };
    const { confirmPendingAction } = await import('../executor');
    const out = await confirmPendingAction({
      pendingActionId: id, actorUserId: ctx.userId, companyId: ctx.companyId, channel: ctx.channel,
      accept: args.accept === true, lang: ctx.lang === 'ru' ? 'ru' : 'uz', sessionId: ctx.sessionId,
    });
    const r = out.result;
    if (r.status !== 'ok') return { status: r.status === 'needs_confirmation' ? 'error' : r.status, message: r.message, retryable: false };
    return ok(args.accept === true ? r.message : L(ctx, 'Bekor qilindi.', 'Отменено.'), { accepted: args.accept === true });
  },
};

export const GENERAL_CALL_TOOLS: AiToolDef[] = [endCall, answerPendingAction];
