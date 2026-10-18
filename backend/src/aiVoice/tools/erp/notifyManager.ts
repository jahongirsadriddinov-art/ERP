import { type AiToolDef } from '../types';
import User from '../../../models/User';
import { notifyManagersInApp } from '../../lib/managers';
import { sendToUser } from '../../channels/botChannel';
import { truncateText } from '../../lib/untrusted';
import { cf, ALL_CHANNELS, ALL_ROLES, ASSIST, fullName, L, notFound, ok } from './common';

// notifyManager — xodimning rahbariga xabar (lib/managers.ts: avval obyekt prorabi, bo'lmasa SHU
// firma direktori/o'rinbosari; notifyAdmins EMAS). Ilova bildirishnomasi (createNotification push'ni
// o'zi yuboradi). confirm:'always' — har doim inson tugmasi bilan tasdiqlanadi (ERP ma'lumotidagi
// injeksiya xabar yuborib yubora olmasin, B4).

export const notifyManager: AiToolDef<{ message: string; urgency?: 'normal' | 'high' }> = {
  name: 'notifyManager',
  description: {
    uz: "Rahbarimga (obyekt prorabi yoki firma rahbari) xabar yuborish. Yuborishdan oldin foydalanuvchi tugma bilan tasdiqlaydi.",
    ru: 'Отправить сообщение моему руководителю (прорабу объекта или руководству фирмы). Перед отправкой пользователь подтверждает кнопкой.',
  },
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', minLength: 1, maxLength: 300, description: 'Xabar matni' },
      urgency: { type: 'string', enum: ['normal', 'high'] },
    },
    required: ['message'],
  },
  kind: 'write',
  confirm: 'always',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: ['name'],
  auditEntity: 'ai_manager_message',
  auditAction: 'send_push',
  // Foydalanuvchi tasdiqlashdan oldin AYNAN qaysi matn ketishini ko'radi (model yozgan matn)
  summarize: (a, lng) => (lng === 'ru'
    ? `Отправить руководителю${a.urgency === 'high' ? ' (срочно)' : ''}: «${truncateText(a.message, 200)}»`
    : `Rahbarga xabar${a.urgency === 'high' ? ' (shoshilinch)' : ''}: «${truncateText(a.message, 200)}»`),
  handler: async (ctx, args) => {
    const me: any = await User.findOne(cf(ctx, { _id: ctx.userId })).select('firstName lastName').lean();
    if (!me) return notFound(ctx);
    const urgent = args.urgency === 'high';
    const managers = await notifyManagersInApp(ctx.companyId, ctx.userId, {
      title: `${urgent ? '⚠️ ' : ''}AI: ${truncateText(fullName(me), 60)}`,
      body: truncateText(args.message, 300),
      entity: 'ai_message',
    });
    if (!managers.length) {
      return notFound(ctx, L(ctx, "Sizning ustingizda rahbar yo'q — aniq odamga yuborish uchun uning ismini ayting (messageEmployee).", 'Над вами нет руководителя — назовите конкретного человека.'));
    }
    // Owner 2026-10-18: faqat ilova bildirishnomasi ko'rinmay qolardi — Telegram'ga ham
    const tgText = `${urgent ? '⚠️ ' : '✉️ '}${truncateText(fullName(me), 60)}:\n${truncateText(args.message, 300)}`;
    await Promise.all(managers.map((m) => sendToUser(m.userId, tgText, { companyId: ctx.companyId }).catch(() => undefined)));
    return ok(L(ctx, `Xabar ${managers.length} ta rahbarga yuborildi.`, `Сообщение отправлено руководителям: ${managers.length}.`), {
      delivered: managers.map((m) => ({ name: m.name, role: m.role, via: m.via })),
    });
  },
};
