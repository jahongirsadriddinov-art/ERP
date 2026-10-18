import mongoose from 'mongoose';
import AiActionAudit from '../../models/AiActionAudit';
import User from '../../models/User';
import ObjectModel from '../../models/Object';
import Transaction from '../../models/Transaction';
import AiReminder from '../../models/AiReminder';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import { runWithTenant } from '../../middleware/tenantContext';
import { aiConfig, LIMITS } from '../config';
import type { PendingActionInfo, ToolChannel, ToolCtx, ToolResult } from '../contracts';
import { checkActor, type ActorState } from '../actor';
import { mirrorWriteToLegacyAudit, writeToolAudit } from '../audit';
import { decryptJson, encryptJson, sha256Hex } from '../lib/crypto';
import { isObjectIdString, newConfirmToken } from '../lib/ids';
import { hitRate } from '../lib/mongoRateLimit';
import { redactText, redactToolOutput } from '../lib/redact';
import { isUntrusted, wrapUntrusted } from '../lib/untrusted';
import { getSettings } from '../settings';
import { budgetExceeded, recordUsage } from '../usage';
import { loadDeveloperActor, PLATFORM_SCOPE, platformSettings } from '../platform';
import { getTool } from './registry';
import { checkToolAccess } from './rbac';
import type { AiToolDef, RefModel } from './types';
import { validateArgs } from './validate';

// ToolExecutor — har bir AI tool chaqiruvi SHU yerdan o'tadi. Tartib:
//  1) aktyorni QAYTA o'qish (rol, egalik, blok, firma, firma holati, tarif; ≤10 s kesh — B2);
//  2) RBAC: sozlama ∩ kod shifti (maxRoles), kanal allow-list, maqsad (B1);
//  3) byudjet, argument validatsiyasi, argumentdagi ID'lar SHU firmaga tegishliligi;
//  4) sessiya bo'yicha chastota; boshqa odamga ta'sir qiluvchi yozuvlar soni (B4);
//  5) yozuv boshqa foydalanuvchiga ta'sir qilsa yoki confirm:'always' — inson tasdig'i (tugma);
//  6) runWithTenant ichida handler (handler ham companyId bo'yicha aniq filtrlaydi);
//  7) natijadan boshqalarning telefoni/maoshi olib tashlanadi; AiActionAudit (+ logAudit) va usage.
// Model faqat {status, message, data}ni ko'radi. Tasdiq — FAQAT UI/bot tugmasi (model chaqira
// oladigan "confirm" tool yo'q) va atomik findOneAndUpdate orqali (B3).

const HANDLER_TIMEOUT_MS = 20_000;
const SESSION_WINDOW_MS = 3 * 3600_000;

export interface ExecuteOptions {
  idempotencyKey?: string;
  /**
   * ownDecision tool'lari (approveTransaction/rejectTransaction) uchun: chaqiruvchi foydalanuvchining
   * SHU navbatdagi aniq buyrug'ini tekshirgan (brain/toolPolicy.explicitDecision). Berilmasa — bajarilmaydi
   * (masalan, Live ovozda matn yo'q: model o'zi yoki untrusted matn qaror qila olmaydi).
   */
  explicitUserDecision?: boolean;
}
export interface ExecuteOutcome { result: ToolResult; pending?: PendingActionInfo; auditId?: string }

const MSG = {
  denied: { uz: "Bu amalga ruxsat yo'q.", ru: 'Нет доступа к этому действию.' },
  notFound: { uz: 'Topilmadi.', ru: 'Не найдено.' },
  error: { uz: "Ichki xato yuz berdi. Keyinroq urinib ko'ring.", ru: 'Внутренняя ошибка. Попробуйте позже.' },
  rate: { uz: "Juda ko'p so'rov — keyinroq urinib ko'ring.", ru: 'Слишком много запросов — попробуйте позже.' },
  budget: { uz: 'AI limiti tugagan.', ru: 'Лимит AI исчерпан.' },
  disabled: { uz: "AI yordamchi o'chirilgan.", ru: 'AI-помощник отключён.' },
  confirm: { uz: 'Tasdiqlash kutilmoqda — foydalanuvchi tugmani bosishi kerak. Hali BAJARILMADI.', ru: 'Ожидает подтверждения кнопкой. Ещё НЕ выполнено.' },
  gone: { uz: "Amal topilmadi, muddati o'tgan yoki allaqachon ko'rib chiqilgan.", ru: 'Действие не найдено, истекло или уже обработано.' },
  cancelled: { uz: 'Bekor qilindi.', ru: 'Отменено.' },
  explicit: {
    uz: "Bu qaror uchun foydalanuvchining aniq buyrug'i kerak — chatda yoki botda \"tasdiqla\" / \"rad et\" deb yozsin. Bajarilmadi.",
    ru: 'Для этого решения нужна явная команда пользователя — пусть напишет в чате или боте «утверди» / «отклони». Не выполнено.',
  },
  timeout: { uz: "Amal juda uzoq davom etdi — natija noma'lum, qayta urinmang.", ru: 'Действие заняло слишком долго — результат неизвестен.' },
};
const t = (k: keyof typeof MSG, lang: 'uz' | 'ru') => MSG[k][lang] || MSG[k].uz;

/**
 * "Tasdiq kutilmoqda" — modelga KANALGA MOS ko'rsatma (owner 2026-10-17 #4: tasdiq SHU joyda so'ralsin,
 * "botga borib tugmani bosing" emas). Ovozda — og'zaki "Tasdiqlaysizmi?" + answerPendingAction.
 */
export function confirmMessage(ch: ToolChannel, lang: 'uz' | 'ru', summary?: string): string {
  const what = summary ? (lang === 'ru' ? ` Действие: «${summary.slice(0, 200)}».` : ` Amal: «${summary.slice(0, 200)}».`) : '';
  if (ch === 'inapp_call' || ch === 'telegram_call') {
    return lang === 'ru'
      ? `Ещё НЕ выполнено.${what} Кратко назовите действие и спросите «Подтверждаете?». Ответ «да» → answerPendingAction(accept=true), «нет» → accept=false.`
      : `Hali BAJARILMADI.${what} Amalni bir jumlada aytib "Tasdiqlaysizmi?" deb so'rang. "Ha" desa → answerPendingAction(accept=true), "yo'q" desa → accept=false.`;
  }
  return lang === 'ru'
    ? `Ещё НЕ выполнено.${what} Кнопки подтверждения появились в ЭТОМ чате — попросите нажать «Подтвердить» или написать «да».`
    : `Hali BAJARILMADI.${what} Tasdiq tugmalari SHU chatda chiqdi — "Tasdiqlash" ni bosishini yoki "ha" deb yozishini so'rang.`;
}

/** Sozlama: firma — DB'dan; firmasiz (dasturchi) — platforma chegaralari. */
const settingsFor = (companyId: string) => (isObjectIdString(companyId) ? getSettings(companyId) : Promise.resolve(platformSettings()));

const deny = (lang: 'uz' | 'ru', key: keyof typeof MSG = 'denied'): ToolResult => ({ status: 'denied', message: t(key, lang), retryable: false });

const REF_MODELS: Record<RefModel, mongoose.Model<any>> = {
  User, Object: ObjectModel, Transaction, AiReminder, AiAttendanceConfirmation,
};

/** Argumentdagi barcha ID'lar ctx.companyId firmasiga tegishlimi (bo'lmasa — not_found, mavjudligini oshkor qilmasdan). */
async function refsBelongToCompany(def: AiToolDef, args: Record<string, unknown>, companyId: string): Promise<boolean> {
  for (const [arg, model] of Object.entries(def.refs || {})) {
    const v = args[arg];
    if (v === undefined) continue;
    const ids = Array.isArray(v) ? v : [v];
    if (!ids.every(isObjectIdString)) return false;
    const uniq = [...new Set(ids as string[])];
    const n = await REF_MODELS[model].countDocuments({ _id: { $in: uniq }, companyId });
    if (n !== uniq.length) return false;
  }
  return true;
}

function targetUserOf(def: AiToolDef, args: Record<string, unknown>): string | undefined {
  if (!def.targetUserArg) return undefined;
  const v = args[def.targetUserArg];
  return typeof v === 'string' && v ? v : undefined;
}

function confirmChannelFor(ch: ToolChannel): { channel: string; via: 'ui' | 'bot' } {
  // Telegram qo'ng'irog'ida UI yo'q — tasdiq bot ai:x tugmasi orqali (B3)
  if (ch === 'telegram_call' || ch === 'bot') return { channel: 'bot', via: 'bot' };
  return { channel: ch, via: 'ui' };
}

const pendingAad = (companyId: string, actorUserId: string, tool: string) => `aiv-pending:${companyId}:${actorUserId}:${tool}`;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error('TOOL_TIMEOUT')), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * B4: e'lon qilingan erkin matn kalitlarini istalgan chuqurlikda {"untrusted_text"} ga o'raydi;
 * handler o'zi o'ragan qiymatlar ham ≤200 belgiga qisqartiriladi.
 */
export function wrapUntrustedFields(value: unknown, keys: Set<string>, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object' || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => wrapUntrustedFields(v, keys, depth + 1));
  if (isUntrusted(value)) return wrapUntrusted(value.untrusted_text);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(k) && (typeof v === 'string' || typeof v === 'number')) out[k] = wrapUntrusted(v);
    else out[k] = wrapUntrustedFields(v, keys, depth + 1);
  }
  return out;
}

function cleanResult(r: ToolResult, callerUserId: string, def?: AiToolDef): ToolResult {
  const status = (['ok', 'denied', 'not_found', 'error'] as const).includes(r?.status as any) ? r.status : 'error';
  const out: ToolResult = {
    status,
    message: redactText(String(r?.message ?? '')).slice(0, 500),
    retryable: !!r?.retryable,
  };
  if (r?.data !== undefined && r.data !== null) {
    const wrapped = wrapUntrustedFields(r.data, new Set(def?.untrustedKeys || []));
    const d = redactToolOutput(wrapped, callerUserId);
    const empty = d === undefined || (typeof d === 'object' && d !== null && !Array.isArray(d) && Object.keys(d).length === 0);
    if (!empty) out.data = d;
  }
  return out;
}

interface Prepared { def: AiToolDef; actor: ActorState; args: Record<string, unknown>; ctx: ToolCtx }
type PrepareResult = { ok: true; p: Prepared } | { ok: false; result: ToolResult; code: string; kind: 'read' | 'write'; actorRole: string };

/** 1–3 qadamlar: aktyor, RBAC, byudjet, argumentlar, ID'lar. Tasdiqlangan qayta bajarishda ham ishlaydi. */
async function prepare(ctx: ToolCtx, name: string, rawArgs: unknown): Promise<PrepareResult> {
  const lang = ctx.lang === 'ru' ? 'ru' : 'uz';
  const def = getTool(name);
  const kind = def?.kind || 'read';
  // ERP tool'lari firma ichida ishlaydi: firmasiz (dasturchi/platforma) kontekstda faqat UMUMIY tool'lar
  if (!isObjectIdString(ctx?.companyId)) {
    if (!def?.general) return { ok: false, result: deny(lang), code: 'no_company', kind, actorRole: ctx?.role || 'unknown' };
    return prepareDeveloper(ctx, def, rawArgs, lang);
  }
  if (!def) return { ok: false, result: deny(lang), code: 'unknown_tool', kind, actorRole: ctx.role };

  const ac = await checkActor(ctx.userId, ctx.companyId);
  if (!ac.ok) return { ok: false, result: deny(lang), code: `actor_${ac.code}`, kind, actorRole: ctx.role };
  const actor = ac.actor;

  const settings = await getSettings(ctx.companyId);
  if (!aiConfig.enabled || !settings.enabled) return { ok: false, result: deny(lang, 'disabled'), code: 'disabled', kind, actorRole: actor.role };

  const access = checkToolAccess(name, { role: actor.role, isOwner: actor.isOwner }, ctx, settings);
  if (!access.ok) return { ok: false, result: deny(lang), code: access.code, kind, actorRole: actor.role };

  if (await budgetExceeded(ctx.companyId)) return { ok: false, result: deny(lang, 'budget'), code: 'budget', kind, actorRole: actor.role };

  const v = validateArgs<Record<string, unknown>>(def.parameters, rawArgs);
  if (!v.ok) return { ok: false, result: { status: 'error', message: v.error, retryable: false }, code: 'bad_args', kind, actorRole: actor.role };

  if (!(await refsBelongToCompany(def, v.value, ctx.companyId))) {
    return { ok: false, result: { status: 'not_found', message: t('notFound', lang), retryable: false }, code: 'ref_not_in_company', kind, actorRole: actor.role };
  }
  // Kontekst rol/egalikni sessiya boshidagidan emas, YANGI o'qilgan qiymatdan oladi
  const fresh: ToolCtx = { ...ctx, role: (actor.isOwner ? 'direktor' : actor.role) as ToolCtx['role'], isOwner: actor.isOwner, tz: 'Asia/Tashkent' };
  return { ok: true, p: { def, actor, args: v.value, ctx: fresh } };
}

/** Firmasiz (dasturchi) — faqat general tool, faqat faol dasturchi; kanal/maqsad/argumentlar tekshiriladi. */
async function prepareDeveloper(ctx: ToolCtx, def: AiToolDef, rawArgs: unknown, lang: 'uz' | 'ru'): Promise<PrepareResult> {
  const kind = def.kind;
  const dev = await loadDeveloperActor(ctx.userId);
  if (!dev) return { ok: false, result: deny(lang), code: 'no_company', kind, actorRole: ctx?.role || 'unknown' };
  if (!aiConfig.enabled) return { ok: false, result: deny(lang, 'disabled'), code: 'disabled', kind, actorRole: dev.role };
  if (!def.channels.includes(ctx.channel)) return { ok: false, result: deny(lang), code: 'channel', kind, actorRole: dev.role };
  if (!def.purposes.includes(ctx.purpose)) return { ok: false, result: deny(lang), code: 'purpose', kind, actorRole: dev.role };
  const v = validateArgs<Record<string, unknown>>(def.parameters, rawArgs);
  if (!v.ok) return { ok: false, result: { status: 'error', message: v.error, retryable: false }, code: 'bad_args', kind, actorRole: dev.role };
  const fresh: ToolCtx = { ...ctx, companyId: PLATFORM_SCOPE, role: dev.role as ToolCtx['role'], isOwner: false, tz: 'Asia/Tashkent' };
  return { ok: true, p: { def, actor: dev, args: v.value, ctx: fresh } };
}

async function runHandler(p: Prepared): Promise<ToolResult> {
  const lang = p.ctx.lang === 'ru' ? 'ru' : 'uz';
  const platform = !isObjectIdString(p.ctx.companyId);
  try {
    const r = await withTimeout(
      platform
        ? p.def.handler(p.ctx, p.args)                   // general tool — firma konteksti yo'q
        : runWithTenant({ userId: p.ctx.userId, role: p.actor.role, companyId: p.ctx.companyId, isOwner: p.actor.isOwner, isDeveloper: false },
          () => p.def.handler(p.ctx, p.args)),
      HANDLER_TIMEOUT_MS,
    );
    return cleanResult(r, p.ctx.userId, p.def);
  } catch (e) {
    const timeout = (e as Error)?.message === 'TOOL_TIMEOUT';
    console.error(`[aiVoice] tool ${p.def.name} xatosi:`, (e as Error)?.message);
    return { status: 'error', message: t(timeout ? 'timeout' : 'error', lang), retryable: false };
  }
}

async function finishAudit(p: Prepared, result: ToolResult, startedAt: number, extra: { auditId?: string; idempotencyKey?: string; targetUserId?: string }) {
  const latencyMs = Date.now() - startedAt;
  let auditId = extra.auditId;
  if (auditId) {
    await AiActionAudit.updateOne({ _id: auditId }, { $set: { status: result.status, resultSummary: result.message.slice(0, 500), latencyMs } });
  } else {
    auditId = await writeToolAudit({
      companyId: p.ctx.companyId, actorUserId: p.ctx.userId, actorRole: p.actor.role, actorName: p.actor.name,
      targetUserId: extra.targetUserId, channel: p.ctx.channel, purpose: p.ctx.purpose, sessionId: p.ctx.sessionId,
      correlationId: p.ctx.correlationId, tool: p.def.name, kind: p.def.kind, args: p.args,
      status: result.status as any, resultSummary: result.message, idempotencyKey: extra.idempotencyKey, latencyMs,
    });
  }
  // Umumiy/ovozli tasdiq tool'lari firma audit jurnaliga yozilmaydi (tasdiqlangan amalning o'zi yoziladi)
  if (p.def.kind === 'write' && result.status === 'ok' && !p.def.general && !p.def.spokenConfirm && isObjectIdString(p.ctx.companyId)) {
    await mirrorWriteToLegacyAudit({
      companyId: p.ctx.companyId, actorUserId: p.ctx.userId, actorName: p.actor.name, actorRole: p.actor.role,
      tool: p.def.name, channel: p.ctx.channel, entity: p.def.auditEntity, entityId: extra.targetUserId,
      action: p.def.auditAction, summary: result.message, args: p.args,
    });
  }
  await recordUsage({ companyId: p.ctx.companyId, userId: p.ctx.userId, provider: 'tools', model: '-' }, { toolCalls: 1 });
  return auditId;
}

/** Asosiy kirish nuqtasi (voice sessiya, TextAgent, bot). */
export async function executeTool(ctx: ToolCtx, name: string, rawArgs: unknown, opts: ExecuteOptions = {}): Promise<ExecuteOutcome> {
  const startedAt = Date.now();
  const lang = ctx.lang === 'ru' ? 'ru' : 'uz';
  const safeName = typeof name === 'string' ? name.slice(0, 64) : 'unknown';

  const prep = await prepare(ctx, safeName, rawArgs);
  if (!prep.ok) {
    const auditId = await writeToolAudit({
      // Firmasiz rad etish ham iz qoldiradi (platforma kaliti ostida)
      companyId: isObjectIdString(ctx.companyId) ? ctx.companyId : PLATFORM_SCOPE, actorUserId: ctx.userId, actorRole: prep.actorRole, channel: ctx.channel, purpose: ctx.purpose,
      sessionId: ctx.sessionId, correlationId: ctx.correlationId, tool: safeName, kind: prep.kind, args: rawArgs,
      status: prep.result.status as any, resultSummary: prep.result.message, errorCode: prep.code, latencyMs: Date.now() - startedAt,
    }).catch(() => undefined);
    return { result: prep.result, auditId };
  }
  const p = prep.p;
  const target = targetUserOf(p.def, p.args);
  const otherUser = !!target && target !== p.ctx.userId;

  // Idempotentlik: shu kalit bilan avval bajarilgan bo'lsa — qayta bajarmaymiz
  if (opts.idempotencyKey) {
    const prev: any = await AiActionAudit.findOne({ companyId: p.ctx.companyId, idempotencyKey: opts.idempotencyKey })
      .select('status resultSummary actorUserId tool').lean();
    if (prev && prev.actorUserId === p.ctx.userId && prev.tool === p.def.name) {
      if (prev.status === 'needs_confirmation') {
        return { result: { status: 'needs_confirmation', message: confirmMessage(p.ctx.channel, lang), retryable: false, pendingActionId: String(prev._id) }, auditId: String(prev._id) };
      }
      return { result: { status: prev.status === 'ok' || prev.status === 'confirmed' ? 'ok' : 'error', message: prev.resultSummary || '', retryable: false }, auditId: String(prev._id) };
    }
  }

  const sessKey = p.ctx.sessionId || p.ctx.correlationId;
  const settings = await settingsFor(p.ctx.companyId);
  const rate = await hitRate(`aiv:tools:${sessKey}`, settings.limits.toolCallsPerSession, SESSION_WINDOW_MS);
  if (!rate.allowed) {
    const result = deny(lang, 'rate');
    const auditId = await finishAudit(p, result, startedAt, { idempotencyKey: opts.idempotencyKey, targetUserId: target });
    return { result, auditId };
  }
  if (p.def.kind === 'write' && otherUser) {
    const r2 = await hitRate(`aiv:otherw:${sessKey}`, LIMITS.otherUserWritesPerSession, SESSION_WINDOW_MS);
    if (!r2.allowed) {
      const result = deny(lang, 'rate');
      const auditId = await finishAudit(p, result, startedAt, { idempotencyKey: opts.idempotencyKey, targetUserId: target });
      return { result, auditId };
    }
  }

  // O'z qarori (ownDecision) — faqat chaqiruvchi aniq buyruqni tasdiqlagan bo'lsa (kod chegarasi, B3)
  if (p.def.ownDecision && !opts.explicitUserDecision) {
    const result: ToolResult = { status: 'error', message: t('explicit', lang), retryable: false };
    const auditId = await finishAudit(p, result, startedAt, { idempotencyKey: opts.idempotencyKey, targetUserId: target });
    return { result, auditId };
  }

  // Boshqa foydalanuvchiga ta'sir qiluvchi HAR QANDAY yozuv — inson tasdig'i (kod chegarasi, B4)
  const needsConfirm = p.def.kind === 'write' && (p.def.confirm === 'always' || otherUser);
  if (needsConfirm) {
    const { channel, via } = confirmChannelFor(p.ctx.channel);
    const token = via === 'bot' ? newConfirmToken() : undefined;
    const expiresAt = new Date(Date.now() + LIMITS.pendingActionTtlMs);
    let summary = p.def.summarize?.(p.args as any, lang) || p.def.name;
    if (otherUser) {
      // Tasdiqlovchi KIMGA ta'sir qilishini ko'rsin (ID emas, ism; faqat shu firma ichidan)
      const tu: any = await User.findOne({ _id: target, companyId: p.ctx.companyId }).select('firstName lastName').lean().catch(() => null);
      const tn = [tu?.firstName, tu?.lastName].filter(Boolean).join(' ').trim().slice(0, 60);
      if (tn) summary = `${summary} → ${tn}`;
    }
    summary = summary.slice(0, 300);
    const auditId = await writeToolAudit({
      companyId: p.ctx.companyId, actorUserId: p.ctx.userId, actorRole: p.actor.role, actorName: p.actor.name,
      targetUserId: target, channel: p.ctx.channel, purpose: p.ctx.purpose, sessionId: p.ctx.sessionId,
      correlationId: p.ctx.correlationId, tool: p.def.name, kind: p.def.kind, args: p.args, status: 'needs_confirmation',
      resultSummary: summary, idempotencyKey: opts.idempotencyKey, latencyMs: Date.now() - startedAt,
      pending: {
        token: token ? sha256Hex(token) : undefined, expiresAt, channel, confirmVia: via, summary,
        args: encryptJson(p.args, pendingAad(p.ctx.companyId, p.ctx.userId, p.def.name)),
      },
    });
    return {
      result: { status: 'needs_confirmation', message: confirmMessage(p.ctx.channel, lang, summary), retryable: false, pendingActionId: auditId },
      pending: { pendingActionId: auditId, token, summary, expiresAt: expiresAt.toISOString(), confirmVia: via, tool: p.def.name },
      auditId,
    };
  }

  const result = await runHandler(p);
  const auditId = await finishAudit(p, result, startedAt, { idempotencyKey: opts.idempotencyKey, targetUserId: target });
  return { result, auditId };
}

export interface ConfirmInput {
  /** UI/socket yo'li: pendingActionId; bot yo'li: token (ai:x:<token>). Kamida bittasi. */
  pendingActionId?: string;
  token?: string;
  actorUserId: string;
  companyId: string;
  /** Tasdiq qaysi kanaldan keldi — pending.channel bilan mos bo'lishi shart. */
  channel: ToolChannel;
  accept: boolean;
  lang?: 'uz' | 'ru';
  /** Ovozli tasdiq: faqat SHU sessiyada yaratilgan amal. */
  sessionId?: string;
}

/**
 * Tasdiqlash/rad etish — ATOMIK: faqat bitta chaqiruv 'needs_confirmation' → 'confirmed' o'tishini
 * yutadi va faqat u bajaradi (ikki marta bosish, ikki tab, takroriy callback — bir marta bajariladi).
 * Bajarishdan oldin aktyor, RBAC, argumentlar va ID'lar QAYTA tekshiriladi.
 */
export async function confirmPendingAction(input: ConfirmInput): Promise<ExecuteOutcome> {
  const lang = input.lang === 'ru' ? 'ru' : 'uz';
  const gone: ExecuteOutcome = { result: { status: 'error', message: t('gone', lang), retryable: false } };
  if (!input.pendingActionId && !input.token) return gone;
  if (input.pendingActionId && !isObjectIdString(input.pendingActionId)) return gone;
  if (input.token !== undefined && (typeof input.token !== 'string' || !/^[A-Za-z0-9]{10,64}$/.test(input.token))) return gone;

  const now = new Date();
  const filter: Record<string, unknown> = {
    status: 'needs_confirmation',
    actorUserId: String(input.actorUserId),
    companyId: String(input.companyId),
    'pending.channel': input.channel === 'telegram_call' ? 'bot' : input.channel,
    'pending.expiresAt': { $gt: now },
  };
  if (input.pendingActionId) filter._id = input.pendingActionId;
  if (input.token) filter['pending.token'] = sha256Hex(input.token);
  if (input.sessionId !== undefined) {
    if (typeof input.sessionId !== 'string' || !input.sessionId) return gone;
    filter.sessionId = input.sessionId;
  }

  const won: any = await AiActionAudit.findOneAndUpdate(
    filter,
    { $set: { status: input.accept ? 'confirmed' : 'cancelled', confirmedAt: now }, $unset: { 'pending.token': 1 } },
    { returnDocument: 'before' },
  ).select('+pending.args').lean();
  if (!won) return gone;
  const auditId = String(won._id);
  if (!input.accept) {
    await AiActionAudit.updateOne({ _id: auditId }, { $unset: { 'pending.args': 1 } });
    return { result: { status: 'ok', message: t('cancelled', lang), retryable: false }, auditId };
  }

  let args: unknown;
  try {
    args = decryptJson(won.pending.args, pendingAad(won.companyId, won.actorUserId, won.tool));
  } catch {
    await AiActionAudit.updateOne({ _id: auditId }, { $set: { status: 'error', errorCode: 'pending_decrypt' }, $unset: { 'pending.args': 1 } });
    return { result: { status: 'error', message: t('error', lang), retryable: false }, auditId };
  }
  await AiActionAudit.updateOne({ _id: auditId }, { $unset: { 'pending.args': 1 } });

  const ctx: ToolCtx = {
    companyId: won.companyId, userId: won.actorUserId, role: won.actorRole, isOwner: false, lang,
    tz: 'Asia/Tashkent', channel: won.channel, purpose: won.purpose || 'assistant',
    sessionId: won.sessionId, correlationId: won.correlationId,
  };
  const startedAt = Date.now();
  const prep = await prepare(ctx, won.tool, args);
  if (!prep.ok) {
    await AiActionAudit.updateOne({ _id: auditId }, { $set: { status: prep.result.status, errorCode: prep.code, resultSummary: prep.result.message } });
    return { result: prep.result, auditId };
  }
  const result = await runHandler(prep.p);
  await finishAudit(prep.p, result, startedAt, { auditId, targetUserId: won.targetUserId });
  return { result, auditId };
}

/** Muddati o'tgan tasdiqlarni 'expired' qiladi (retention/sweep ishi chaqiradi). */
export async function expirePendingActions(now: Date = new Date()): Promise<number> {
  const r = await AiActionAudit.updateMany(
    { status: 'needs_confirmation', 'pending.expiresAt': { $lte: now } },
    { $set: { status: 'expired' }, $unset: { 'pending.token': 1, 'pending.args': 1 } },
  );
  return r.modifiedCount;
}

