import AiReminder from '../../../models/AiReminder';
import User from '../../../models/User';
import type { ToolChannel } from '../../contracts';
import { type AiToolDef, type JsonSchema, type ToolCtx, type ToolResult } from '../types';
import { getSettings } from '../../settings';
import { sha256Hex } from '../../lib/crypto';
import { zonedParts } from '../../lib/zonedTime';
import {
  cf, ALL_CHANNELS, ALL_ROLES, badArgs, denied, FREE_TEXT_KEYS, fullName, isBoss, L, notFound, ok, today,
} from './common';
import { FREQS, firstFutureOccurrence, normalizeRecurrence, type Freq } from './recurrence';

// Eslatmalar (AiReminder) — createReminder / updateReminder / cancelReminder / listReminders.
// QOIDALAR:
//  • o'zi uchun — tasdiqsiz;
//  • boshqa xodim uchun — FAQAT rahbar (direktor/o'rinbosar/egasi), FAQAT shu firma, va HAR DOIM
//    inson tasdig'i (targetUserId → executor 'when_other_user' kod chegarasi);
//  • update/cancel boshqa odamning eslatmasiga tegsa — targetUserId argumenti eslatma egasiga teng
//    bo'lishi SHART (aks holda xato), shunda executor tasdiq tugmasini majburiy qiladi;
//  • vaqt zonasi doim Asia/Tashkent; takrorlanish — tools/erp/recurrence.ts (birinchi yonish).
// Eslatmani yuborish (yonish) — P3 scheduler ishi; bu yerda faqat yozuv.

const REM_PURPOSES: ToolCtx['purpose'][] = ['assistant', 'reminder'];
const MAX_AHEAD_MS = 2 * 365 * 86_400_000;

const createdVia = (ch: ToolChannel): 'ui' | 'voice' | 'bot' | 'telegram_call' =>
  ch === 'bot' ? 'bot' : ch === 'telegram_call' ? 'telegram_call' : ch === 'inapp_call' ? 'voice' : 'ui';

/** Natija va tasdiq matnlarida sana+vaqt — telefon maskasiga tushmasligi uchun vergul bilan. */
const whenText = (d: Date) => { const p = zonedParts(d); return `${p.date}, ${p.hhmm}`; };
/** Tasdiq xulosasi uchun qisqa matn (bir qator, ≤120 belgi). */
const clip = (s: unknown, n = 120) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

const RECURRENCE_PROPS: Record<string, JsonSchema> = {
  recurrence: { type: 'string', enum: FREQS, description: "Takrorlanish: none | daily | weekdays (Du–Sha) | weekly | monthly" },
  weekdays: { type: 'array', maxItems: 7, items: { type: 'integer', minimum: 1, maximum: 7 }, description: 'weekly uchun ISO hafta kunlari: 1=Du … 7=Ya' },
  until: { type: 'string', format: 'date', description: 'Takrorlanish tugash sanasi (ixtiyoriy)' },
};

function reminderRow(r: any, names: Map<string, string>, me: string) {
  const next = r.nextFireAt ? zonedParts(new Date(r.nextFireAt)) : null;
  return {
    id: String(r._id),
    text: r.text,
    date: next?.date, time: next?.hhmm,
    recurrence: r.recurrence?.freq || 'none',
    ...(r.recurrence?.byWeekday?.length ? { weekdays: r.recurrence.byWeekday } : {}),
    status: r.status,
    forMe: String(r.targetUserId) === me,
    ...(String(r.targetUserId) !== me ? { targetName: names.get(String(r.targetUserId)) } : {}),
    ...(String(r.ownerId) !== me ? { ownerName: names.get(String(r.ownerId)) } : {}),
  };
}

async function namesFor(ctx: ToolCtx, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((id) => id && id !== ctx.userId))];
  if (!uniq.length) return new Map();
  const users: any[] = await User.find(cf(ctx, { _id: { $in: uniq } })).select('firstName lastName').lean();
  return new Map(users.map((u) => [String(u._id), fullName(u)]));
}

async function targetOk(ctx: ToolCtx, target: string): Promise<any | null> {
  return User.findOne(cf(ctx, { _id: target, isBlocked: { $ne: true }, role: { $ne: 'dasturchi' } }))
    .select('firstName lastName').lean();
}

/** Tahrirlash/bekor qilish ruxsati: o'ziniki — erkin; boshqa odamniki — faqat rahbar va targetUserId mos. */
async function loadEditable(ctx: ToolCtx, reminderId: string, argTarget: string | undefined): Promise<{ rem: any } | { err: ToolResult }> {
  const rem: any = await AiReminder.findOne(cf(ctx, { _id: reminderId })).lean();
  if (!rem) return { err: notFound(ctx) };
  const self = String(rem.targetUserId) === ctx.userId;
  if (!self && !isBoss(ctx)) return { err: denied(ctx, L(ctx, "Boshqa xodimning eslatmasini o'zgartirishga ruxsat yo'q.", 'Нельзя менять чужие напоминания.')) };
  if (!self && argTarget !== String(rem.targetUserId)) {
    return { err: badArgs(ctx,
      `Bu eslatma boshqa xodimniki: targetUserId="${rem.targetUserId}" bilan qayta chaqiring (foydalanuvchi tasdiqlaydi).`,
      `Это напоминание другого сотрудника: вызовите снова с targetUserId="${rem.targetUserId}" (нужно подтверждение).`) };
  }
  if (self && argTarget && argTarget !== ctx.userId) return { err: badArgs(ctx, 'targetUserId mos emas.', 'targetUserId не совпадает.') };
  if (rem.status !== 'active') return { err: badArgs(ctx, `Eslatma faol emas (${rem.status}).`, `Напоминание не активно (${rem.status}).`) };
  return { rem };
}

// ───────────────────────── createReminder ─────────────────────────
interface CreateArgs { text: string; date: string; time: string; recurrence?: Freq; weekdays?: number[]; until?: string; targetUserId?: string }

export const createReminder: AiToolDef<CreateArgs> = {
  name: 'createReminder',
  description: {
    uz: "Eslatma yaratish (Toshkent vaqti). O'zi uchun — darhol; boshqa xodim uchun (faqat rahbar) — foydalanuvchi tugma bilan tasdiqlagandan keyin.",
    ru: 'Создать напоминание (время Ташкента). Себе — сразу; другому сотруднику (только руководитель) — после подтверждения кнопкой.',
  },
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 500, description: 'Eslatma matni' },
      date: { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
      time: { type: 'string', format: 'time', description: 'HH:mm (24 soat)' },
      ...RECURRENCE_PROPS,
      targetUserId: { type: 'string', format: 'objectId', description: "Boshqa xodim ID'si (faqat rahbar; ixtiyoriy)" },
    },
    required: ['text', 'date', 'time'],
  },
  refs: { targetUserId: 'User' },
  targetUserArg: 'targetUserId',
  kind: 'write',
  confirm: 'when_other_user',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: REM_PURPOSES,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: FREE_TEXT_KEYS,
  auditEntity: 'ai_reminder',
  auditAction: 'create',
  // Tasdiq tugmasi oldida foydalanuvchi NIMA yaratilishini ko'rsin (matn qisqartirilgan)
  summarize: (a, lng) => (lng === 'ru'
    ? `Напоминание «${clip(a.text)}» на ${a.date}, ${a.time}${a.targetUserId ? ' (для другого сотрудника)' : ''}`
    : `Eslatma «${clip(a.text)}»: ${a.date}, ${a.time}${a.targetUserId ? ' (boshqa xodim uchun)' : ''}`),
  handler: async (ctx, args) => {
    const target = args.targetUserId || ctx.userId;
    if (target !== ctx.userId && !isBoss(ctx)) {
      return denied(ctx, L(ctx, "Boshqa xodimga eslatmani faqat rahbar qo'ya oladi.", 'Ставить напоминания другим может только руководитель.'));
    }
    const tUser = await targetOk(ctx, target);
    if (!tUser) return notFound(ctx);
    const rec = normalizeRecurrence(args.recurrence, args.weekdays, args.date, args.until);
    const now = new Date();
    const due = firstFutureOccurrence(args.date, args.time, rec, now);
    if (!due) return badArgs(ctx, "Bu vaqt allaqachon o'tgan.", 'Это время уже прошло.');
    if (due.getTime() - now.getTime() > MAX_AHEAD_MS) return badArgs(ctx, "Ikki yildan uzoq muddatga bo'lmaydi.", 'Не дальше двух лет.');

    const settings = await getSettings(ctx.companyId);
    const active = await AiReminder.countDocuments(cf(ctx, { targetUserId: target, status: 'active' }));
    if (active >= settings.reminders.maxActivePerUser) {
      return badArgs(ctx, `Faol eslatmalar chegarasi (${settings.reminders.maxActivePerUser}) to'lgan.`, `Достигнут лимит активных напоминаний (${settings.reminders.maxActivePerUser}).`);
    }
    // Model bir xil chaqiruvni takrorlasa — ikkinchi yozuv yaratilmaydi (sessiya doirasida)
    const idempotencyKey = sha256Hex([ctx.sessionId || ctx.correlationId, target, args.text, due.toISOString(), rec.freq].join('|')).slice(0, 40);
    let doc: any;
    let already = false;
    try {
      doc = await AiReminder.create({
        companyId: ctx.companyId, ownerId: ctx.userId, targetUserId: target, text: args.text,
        timezone: 'Asia/Tashkent', dueAt: due, nextFireAt: due, recurrence: rec, status: 'active',
        channels: settings.reminders.defaultChannels, createdVia: createdVia(ctx.channel),
        idempotencyKey, sourceSessionId: ctx.sessionId, correlationId: ctx.correlationId,
      });
    } catch (e: any) {
      if (e?.code !== 11000) throw e;
      doc = await AiReminder.findOne(cf(ctx, { ownerId: ctx.userId, idempotencyKey })).lean();
      already = true;
    }
    const names = await namesFor(ctx, [target]);
    return ok(
      already
        ? L(ctx, `Bu eslatma avvalroq yaratilgan: ${whenText(due)}.`, `Это напоминание уже создано: ${whenText(due)}.`)
        : L(ctx, `Eslatma yaratildi: ${whenText(due)}.`, `Напоминание создано: ${whenText(due)}.`),
      { reminder: reminderRow(doc, names, ctx.userId) },
    );
  },
};

// ───────────────────────── updateReminder ─────────────────────────
interface UpdateArgs { reminderId: string; text?: string; date?: string; time?: string; recurrence?: Freq; weekdays?: number[]; until?: string; targetUserId?: string }

export const updateReminder: AiToolDef<UpdateArgs> = {
  name: 'updateReminder',
  description: {
    uz: "Eslatmani o'zgartirish (matn, sana, vaqt, takrorlanish). Boshqa xodimning eslatmasi uchun targetUserId shart va tugma bilan tasdiq kerak.",
    ru: 'Изменить напоминание (текст, дата, время, повтор). Для чужого напоминания нужен targetUserId и подтверждение кнопкой.',
  },
  parameters: {
    type: 'object',
    properties: {
      reminderId: { type: 'string', format: 'objectId', description: 'Eslatma ID' },
      text: { type: 'string', minLength: 1, maxLength: 500 },
      date: { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
      time: { type: 'string', format: 'time', description: 'HH:mm' },
      ...RECURRENCE_PROPS,
      targetUserId: { type: 'string', format: 'objectId', description: "Eslatma kimga tegishli (boshqa xodimniki bo'lsa majburiy)" },
    },
    required: ['reminderId'],
  },
  refs: { reminderId: 'AiReminder', targetUserId: 'User' },
  targetUserArg: 'targetUserId',
  kind: 'write',
  confirm: 'when_other_user',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: REM_PURPOSES,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: FREE_TEXT_KEYS,
  auditEntity: 'ai_reminder',
  auditAction: 'update',
  summarize: (a, lng) => (lng === 'ru'
    ? `Изменить напоминание${a.date || a.time ? ` → ${[a.date, a.time].filter(Boolean).join(', ')}` : ''}${a.text ? ` «${clip(a.text)}»` : ''}${a.targetUserId ? ' (другого сотрудника)' : ''}`
    : `Eslatmani o'zgartirish${a.date || a.time ? ` → ${[a.date, a.time].filter(Boolean).join(', ')}` : ''}${a.text ? ` «${clip(a.text)}»` : ''}${a.targetUserId ? ' (boshqa xodimniki)' : ''}`),
  handler: async (ctx, args) => {
    const r = await loadEditable(ctx, args.reminderId, args.targetUserId);
    if ('err' in r) return r.err;
    const rem = r.rem;
    const cur = zonedParts(new Date(rem.nextFireAt || rem.dueAt));
    const $set: Record<string, unknown> = {};
    if (args.text !== undefined) $set.text = args.text;
    const timeChanged = args.date !== undefined || args.time !== undefined;
    const recChanged = args.recurrence !== undefined || args.weekdays !== undefined || args.until !== undefined;
    if (timeChanged || recChanged) {
      const date = args.date || cur.date;
      const time = args.time || cur.hhmm;
      const rec = recChanged
        ? normalizeRecurrence(args.recurrence ?? rem.recurrence?.freq, args.weekdays ?? rem.recurrence?.byWeekday, date, args.until)
        : { freq: rem.recurrence?.freq || 'none', interval: rem.recurrence?.interval || 1, byWeekday: rem.recurrence?.byWeekday || [], ...(rem.recurrence?.until ? { until: rem.recurrence.until } : {}) };
      const due = firstFutureOccurrence(date, time, rec as any, new Date());
      if (!due) return badArgs(ctx, "Bu vaqt allaqachon o'tgan.", 'Это время уже прошло.');
      if (due.getTime() - Date.now() > MAX_AHEAD_MS) return badArgs(ctx, "Ikki yildan uzoq muddatga bo'lmaydi.", 'Не дальше двух лет.');
      $set.dueAt = due; $set.nextFireAt = due; $set.recurrence = rec;
    }
    if (!Object.keys($set).length) return badArgs(ctx, "O'zgartirish uchun hech narsa berilmadi.", 'Нечего менять.');
    const updated: any = await AiReminder.findOneAndUpdate(
      cf(ctx, { _id: rem._id, status: 'active' }), { $set }, { returnDocument: 'after' },
    ).lean();
    if (!updated) return notFound(ctx);
    const names = await namesFor(ctx, [String(updated.targetUserId), String(updated.ownerId)]);
    return ok(L(ctx, "Eslatma o'zgartirildi.", 'Напоминание изменено.'), { reminder: reminderRow(updated, names, ctx.userId) });
  },
};

// ───────────────────────── cancelReminder ─────────────────────────
export const cancelReminder: AiToolDef<{ reminderId: string; targetUserId?: string }> = {
  name: 'cancelReminder',
  description: {
    uz: "Eslatmani bekor qilish. Boshqa xodimning eslatmasi uchun targetUserId shart va tugma bilan tasdiq kerak.",
    ru: 'Отменить напоминание. Для чужого напоминания нужен targetUserId и подтверждение кнопкой.',
  },
  parameters: {
    type: 'object',
    properties: {
      reminderId: { type: 'string', format: 'objectId', description: 'Eslatma ID' },
      targetUserId: { type: 'string', format: 'objectId', description: "Eslatma kimga tegishli (boshqa xodimniki bo'lsa majburiy)" },
    },
    required: ['reminderId'],
  },
  refs: { reminderId: 'AiReminder', targetUserId: 'User' },
  targetUserArg: 'targetUserId',
  kind: 'write',
  confirm: 'when_other_user',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: REM_PURPOSES,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: FREE_TEXT_KEYS,
  auditEntity: 'ai_reminder',
  auditAction: 'delete',
  summarize: (a, lng) => (lng === 'ru'
    ? `Отменить напоминание${a.targetUserId ? ' другого сотрудника' : ''}`
    : `Eslatmani bekor qilish${a.targetUserId ? ' (boshqa xodimniki)' : ''}`),
  handler: async (ctx, args) => {
    const r = await loadEditable(ctx, args.reminderId, args.targetUserId);
    if ('err' in r) return r.err;
    const res = await AiReminder.updateOne(
      cf(ctx, { _id: r.rem._id, status: 'active' }), { $set: { status: 'cancelled', nextFireAt: null } },
    );
    if (!res.modifiedCount) return notFound(ctx);
    return ok(L(ctx, 'Eslatma bekor qilindi.', 'Напоминание отменено.'), { reminderId: String(r.rem._id), status: 'cancelled' });
  },
};

// ───────────────────────── listReminders ─────────────────────────
export const listReminders: AiToolDef<{ scope?: 'mine' | 'created_by_me' | 'company'; targetUserId?: string; includeInactive?: boolean }> = {
  name: 'listReminders',
  description: {
    uz: "Eslatmalar ro'yxati. scope: mine (menga), created_by_me (men qo'yganlar), company (faqat rahbar). Rahbar targetUserId bilan bitta xodimnikini ko'rishi mumkin.",
    ru: 'Список напоминаний. scope: mine (мне), created_by_me (поставленные мной), company (только руководитель). Руководитель может указать targetUserId.',
  },
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['mine', 'created_by_me', 'company'] },
      targetUserId: { type: 'string', format: 'objectId' },
      includeInactive: { type: 'boolean', description: 'Bajarilgan/bekor qilinganlarni ham ko\'rsatish' },
    },
  },
  refs: { targetUserId: 'User' },
  kind: 'read',
  confirm: 'never',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: REM_PURPOSES,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: FREE_TEXT_KEYS,
  handler: async (ctx, args) => {
    const boss = isBoss(ctx);
    const filter: Record<string, unknown> = {};
    const scope = args.scope || 'mine';
    if (args.targetUserId && args.targetUserId !== ctx.userId) {
      if (!boss) return denied(ctx);
      filter.targetUserId = args.targetUserId;
    } else if (scope === 'company') {
      if (!boss) return denied(ctx);
    } else if (scope === 'created_by_me') {
      filter.ownerId = ctx.userId;
    } else {
      filter.targetUserId = ctx.userId;
    }
    if (!args.includeInactive) filter.status = 'active';
    const rows: any[] = await AiReminder.find(cf(ctx, filter))
      .select('text targetUserId ownerId nextFireAt dueAt recurrence status').sort({ nextFireAt: 1, dueAt: 1 }).limit(30).lean();
    const names = await namesFor(ctx, rows.flatMap((r) => [String(r.targetUserId), String(r.ownerId)]));
    return ok(L(ctx, `${rows.length} ta eslatma (bugun ${today()}).`, `Напоминаний: ${rows.length} (сегодня ${today()}).`), {
      reminders: rows.map((r) => reminderRow(r, names, ctx.userId)),
    });
  },
};

export const REMINDER_TOOLS = [createReminder, updateReminder, cancelReminder, listReminders];
