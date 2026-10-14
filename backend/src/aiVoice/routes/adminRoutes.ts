import { Router, type Request, type Response, type NextFunction } from 'express';
import AiActionAudit from '../../models/AiActionAudit';
import AiChannelConnection from '../../models/AiChannelConnection';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import AiUsageMetrics from '../../models/AiUsageMetrics';
import User from '../../models/User';
import { logAudit } from '../../services/audit';
import { getBotInstance } from '../bot/botHooks';
import { aiConfig } from '../config';
import {
  CHANNEL_NAMES, type AiEmployeeRowDto, type AiSchedulePatch, type AiSettingsData, type AiSettingsViewDto, type ChannelName,
} from '../contracts';
import { geminiConfigured } from '../lib/geminiKeys';
import { isObjectIdString } from '../lib/ids';
import { hitRate } from '../lib/mongoRateLimit';
import { addDays, isHHmm, isIsoDate, localDate } from '../lib/zonedTime';
import { runAttendancePlanNow } from '../scheduler/api';
import {
  canEditSchedule, getCompanyAiState, getSettingsFresh, isAiActive, saveSettings, updateSchedule, validateSettingsUpdate,
} from '../settings';
import { toolCatalog } from '../tools/registry';
import { registerErpTools } from '../tools/erp';
import { budgetExceeded, monthCostMicros, recordUsage } from '../usage';

// Firma admini: /api/ai-voice/admin (index.ts: requireAuth + blockDeveloper).
// Kirish: firma egasi, direktor yoki o'rinbosar (requireAuth rolni har so'rovda DB'dan qayta o'qiydi) +
// tarifda ai_assistant (fail-closed: firma/obuna topilmasa — 403). Sozlamalar optimistik versiya bilan (409),
// tools matritsasi kod chegarasi bilan (400), PATCH /employees rozilik/opt-out'ni RAD etadi (B9),
// run-now qo'lda dedupe kaliti bilan (scheduler/api), timezone faqat o'qish. Kalit qiymatlari HECH QACHON qaytmaydi.

const router = Router();

interface Admin { userId: string; role: string; isOwner: boolean; companyId: string; name: string }
const ADMIN_ROLES = new Set(['direktor', 'orinbosar']);

const adminOf = (res: Response): Admin => res.locals.aiAdmin as Admin;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fullName = (u: any) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
const isTopBoss = (a: Pick<Admin, 'role' | 'isOwner'>) => a.isOwner || a.role === 'direktor';

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ───────────── Kirish nazorati ─────────────
async function requireAiAdmin(req: Request, res: Response, next: NextFunction) {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  const companyId = u.companyId ? String(u.companyId) : '';
  if (!companyId || u.isDeveloper || u.role === 'dasturchi') return res.status(403).json({ error: 'forbidden' });
  if (!u.isOwner && !ADMIN_ROLES.has(String(u.role))) {
    return res.status(403).json({ error: 'forbidden', message: "Faqat firma egasi, direktor yoki o'rinbosar" });
  }
  try {
    const st = await getCompanyAiState(companyId);
    // Fail-closed: firma yo'q yoki tarifda AI yo'q — sozlamalar ham ochilmaydi
    if (!st.exists || !st.hasFeature) return res.status(403).json({ error: 'feature', featureRequired: 'ai_assistant' });
    const me: any = await User.findById(u.userId).select('firstName lastName').lean();
    res.locals.aiAdmin = { userId: String(u.userId), role: String(u.role), isOwner: !!u.isOwner, companyId, name: fullName(me) } as Admin;
    return next();
  } catch (e) {
    return next(e);
  }
}
router.use(requireAiAdmin);

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

// ───────────── Sozlamalar ─────────────
async function buildView(a: Admin, settings?: AiSettingsData): Promise<AiSettingsViewDto> {
  const s = settings || await getSettingsFresh(a.companyId);
  const st = await getCompanyAiState(a.companyId);
  return {
    settings: s,
    editor: { canEditSchedule: canEditSchedule(a, s), canEditBossRows: isTopBoss(a) },
    // Faqat "sozlanganmi" — kalit qiymatlari emas
    providers: { gemini: geminiConfigured(), openrouter: aiConfig.brain.openRouterConfigured, claude: aiConfig.brain.claudeConfigured },
    status: { aiVoiceEnabled: aiConfig.enabled, planHasFeature: st.hasFeature, companyActive: st.exists && st.active },
  };
}

router.get('/settings', wrap(async (_req, res) => {
  res.json(await buildView(adminOf(res)));
}));

router.put('/settings', wrap(async (req, res) => {
  const a = adminOf(res);
  const body = req.body;
  if (!isObj(body) || typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 0 || !isObj(body.patch)) {
    return res.status(400).json({ error: 'invalid', errors: ['{version:number, patch:object} kerak'] });
  }
  registerErpTools(); // tools matritsasini tekshirish uchun reestr to'la bo'lsin (idempotent)
  const current = await getSettingsFresh(a.companyId);
  if (body.version !== current.version) return res.status(409).json({ error: 'version_conflict', current: await buildView(a, current) });
  const v = validateSettingsUpdate(body.patch, current, a);
  if (!v.ok) return res.status(400).json({ error: 'invalid', errors: v.errors });
  const saved = await saveSettings(a.companyId, v.value, current.version, a.userId);
  if (!saved.ok) return res.status(409).json({ error: 'version_conflict', current: await buildView(a, saved.current) });
  logAudit({
    userId: a.userId, userName: a.name || 'Admin', userRole: a.role, action: 'update', entity: 'ai_settings',
    entityId: a.companyId, description: `AI sozlamalari o'zgartirildi: ${Object.keys(body.patch).join(', ').slice(0, 200)}`,
    companyId: a.companyId, req,
  }).catch(() => {});
  res.json(await buildView(a, saved.value));
}));

// ───────────── Ish jadvali (tor yangilash — bot menyusi bilan bir xil yo'l) ─────────────
const SCHEDULE_KEYS = new Set(['workStart', 'callLeadMin', 'workdays', 'addSkipDates', 'removeSkipDates', 'addExtraWorkDates', 'removeExtraWorkDates']);
const isIntIn = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

function checkSchedulePatch(p: unknown): string[] {
  if (!isObj(p)) return ["patch object bo'lishi kerak"];
  const errors: string[] = [];
  for (const k of Object.keys(p)) if (!SCHEDULE_KEYS.has(k)) errors.push(`${k}: noma'lum maydon`);
  if (p.workStart !== undefined && !isHHmm(p.workStart)) errors.push('workStart: HH:mm');
  if (p.callLeadMin !== undefined && !isIntIn(p.callLeadMin, 0, 180)) errors.push('callLeadMin: 0..180');
  if (p.workdays !== undefined && !(Array.isArray(p.workdays) && p.workdays.every((d: unknown) => isIntIn(d, 1, 7)))) {
    errors.push('workdays: 1..7 (ISO)');
  }
  for (const k of ['addSkipDates', 'removeSkipDates', 'addExtraWorkDates', 'removeExtraWorkDates']) {
    if (p[k] !== undefined && !(Array.isArray(p[k]) && p[k].length <= 60 && p[k].every(isIsoDate))) errors.push(`${k}: YYYY-MM-DD`);
  }
  return errors;
}

router.patch('/schedule', wrap(async (req, res) => {
  const a = adminOf(res);
  const { shiftId, patch } = isObj(req.body) ? req.body : ({} as Record<string, any>);
  if (typeof shiftId !== 'string' || !shiftId) return res.status(400).json({ error: 'invalid', errors: ['shiftId kerak'] });
  const errs = checkSchedulePatch(patch);
  if (errs.length) return res.status(400).json({ error: 'invalid', errors: errs });
  const r = await updateSchedule(a.companyId, shiftId, patch as AiSchedulePatch, a);
  if (r.ok) return res.json(await buildView(a, r.value));
  const status = { forbidden: 403, not_found: 404, invalid: 400, conflict: 409 }[r.code];
  return res.status(status).json({ error: r.code, errors: r.errors });
}));

// ───────────── Tool katalogi (rollar matritsasi uchun) ─────────────
router.get('/tools', wrap(async (_req, res) => {
  registerErpTools();
  res.json({ tools: toolCatalog().sort((x, y) => x.name.localeCompare(y.name)) });
}));

// ───────────── Kanallar holati (faqat o'qish, maskalangan) ─────────────
let botMeCache: { at: number; username?: string } | null = null;
async function botUsername(): Promise<string | undefined> {
  if (botMeCache && Date.now() - botMeCache.at < 10 * 60_000) return botMeCache.username;
  const bot = getBotInstance();
  let username: string | undefined;
  if (bot?.getMe) {
    let t: NodeJS.Timeout | undefined;
    try {
      const me: any = await Promise.race([bot.getMe(), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), 3000); })]);
      username = typeof me?.username === 'string' ? me.username : undefined;
    } catch { /* bot javob bermadi — username ko'rsatilmaydi */ } finally { if (t) clearTimeout(t); }
  }
  botMeCache = { at: Date.now(), username };
  return username;
}

router.get('/channels/status', wrap(async (_req, res) => {
  const tokenSet = !!(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const conn: any = await AiChannelConnection.findOne({ scope: 'platform', companyId: null, type: 'telegram_user' })
    .select('status username lastHealthAt dailyCallCount dailyCallDay').lean();
  const fresh = !!conn?.lastHealthAt && Date.now() - new Date(conn.lastHealthAt).getTime() < 90_000;
  res.json({
    // webhook secret bot tokenidan hosil qilinadi — token bo'lsa, secret ham bor
    bot: { configured: tokenSet && !!getBotInstance(), username: tokenSet ? await botUsername() : undefined, webhookSecretConfigured: tokenSet },
    telegramAccount: {
      status: conn?.status || 'disconnected',
      username: conn?.username || undefined,
      workerConnected: fresh,
      dailyCallCount: conn?.dailyCallDay === localDate() ? Number(conn?.dailyCallCount || 0) : 0,
      dailyCap: aiConfig.tgDailyCap,
    },
  });
}));

// ───────────── Xodimlar ─────────────
const CONTACT_FIELDS = 'employeeId telegram.tgUserId telegram.resolveStatus telegram.callConsent optOut channelPrefs';

function rowOf(u: any, c: any): AiEmployeeRowDto {
  return {
    userId: String(u._id),
    name: fullName(u) || '—',
    role: String(u.role),
    telegramLinked: !!(u.telegramChatId || c?.telegram?.tgUserId),
    resolveStatus: String(c?.telegram?.resolveStatus || 'unknown'),
    callConsent: String(c?.telegram?.callConsent || 'none'),
    optOut: { calls: !!c?.optOut?.calls, reminders: !!c?.optOut?.reminders, all: !!c?.optOut?.all },
    ...(Array.isArray(c?.channelPrefs?.order) ? { channelOrder: c.channelPrefs.order } : {}),
    disabledChannels: Array.isArray(c?.channelPrefs?.disabled) ? c.channelPrefs.disabled : [],
  };
}

router.get('/employees', wrap(async (req, res) => {
  const a = adminOf(res);
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const filter: Record<string, unknown> = { companyId: a.companyId, role: { $ne: 'dasturchi' }, isBlocked: { $ne: true } };
  if (q) filter.$or = [{ firstName: new RegExp(esc(q), 'i') }, { lastName: new RegExp(esc(q), 'i') }];
  // Telefon raqamlari tanlanmaydi (shaxsiy ma'lumot)
  const users: any[] = await User.find(filter).select('firstName lastName role telegramChatId isOwner').sort({ firstName: 1 }).limit(500).lean();
  const contacts: any[] = await AiEmployeeContact.find({ companyId: a.companyId, employeeId: { $in: users.map((u) => String(u._id)) } })
    .select(CONTACT_FIELDS).lean();
  const byId = new Map(contacts.map((c) => [String(c.employeeId), c]));
  res.json({ employees: users.map((u) => rowOf(u, byId.get(String(u._id)))) });
}));

const EMPLOYEE_PATCH_KEYS = new Set(['channelOrder', 'disabledChannels']);
const knownChannels = (v: unknown): v is ChannelName[] =>
  Array.isArray(v) && v.every((x) => (CHANNEL_NAMES as unknown[]).includes(x)) && new Set(v).size === v.length;

router.patch('/employees/:userId', wrap(async (req, res) => {
  const a = adminOf(res);
  const body = req.body;
  if (!isObj(body)) return res.status(400).json({ error: 'invalid' });
  // B9: rozilik va opt-out'ni FAQAT xodimning o'zi o'zgartiradi — boshqa har qanday maydon rad etiladi
  const bad = Object.keys(body).filter((k) => !EMPLOYEE_PATCH_KEYS.has(k));
  if (bad.length) return res.status(400).json({ error: 'forbidden_fields', fields: bad });
  if (body.channelOrder !== undefined && body.channelOrder !== null && !(knownChannels(body.channelOrder) && body.channelOrder.length)) {
    return res.status(400).json({ error: 'invalid', errors: ["channelOrder: takrorsiz, ma'lum kanallar"] });
  }
  if (body.disabledChannels !== undefined && !knownChannels(body.disabledChannels)) {
    return res.status(400).json({ error: 'invalid', errors: ["disabledChannels: takrorsiz, ma'lum kanallar"] });
  }
  const userId = String(req.params.userId);
  if (!isObjectIdString(userId)) return res.status(404).json({ error: 'not_found' });
  const target: any = await User.findOne({ _id: userId, companyId: a.companyId, role: { $ne: 'dasturchi' } })
    .select('firstName lastName role telegramChatId isOwner').lean();
  if (!target) return res.status(404).json({ error: 'not_found' });
  // O'rinbosar firma egasi/direktorning sozlamasini o'zgartira olmaydi
  if (!isTopBoss(a) && (target.isOwner || target.role === 'direktor')) return res.status(403).json({ error: 'forbidden' });
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};
  if (body.channelOrder === null) $unset['channelPrefs.order'] = '';
  else if (body.channelOrder !== undefined) $set['channelPrefs.order'] = body.channelOrder;
  if (body.disabledChannels !== undefined) $set['channelPrefs.disabled'] = body.disabledChannels;
  if (Object.keys($set).length || Object.keys($unset).length) {
    await AiEmployeeContact.updateOne(
      { companyId: a.companyId, employeeId: userId },
      {
        ...(Object.keys($set).length ? { $set } : {}),
        ...(Object.keys($unset).length ? { $unset } : {}),
        $setOnInsert: { companyId: a.companyId, employeeId: userId },
      },
      { upsert: true },
    );
  }
  const c: any = await AiEmployeeContact.findOne({ companyId: a.companyId, employeeId: userId }).select(CONTACT_FIELDS).lean();
  res.json({ employee: rowOf(target, c) });
}));

// ───────────── Davomatni hozir rejalashtirish ─────────────
router.post('/attendance/run-now', wrap(async (req, res) => {
  const a = adminOf(res);
  const shiftId = isObj(req.body) && typeof req.body.shiftId === 'string' ? req.body.shiftId : '';
  if (!shiftId) return res.status(400).json({ error: 'invalid', errors: ['shiftId kerak'] });
  const s = await getSettingsFresh(a.companyId);
  if (!s.attendance.shifts.some((sh) => sh.id === shiftId)) return res.status(404).json({ error: 'not_found' });
  // AI o'chiq bo'lsa (env yoki firma sozlamasi) — hech narsa rejalashtirilmaydi
  if (!(await isAiActive(a.companyId))) return res.status(409).json({ error: 'ai_disabled' });
  const rl = await hitRate(`aiv:runnow:${a.companyId}`, 10, 3600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited', retryAfterSec: rl.retryAfterSec });
  // Dedupe kaliti (att:plan:…:manual:<minute>) scheduler/api ichida — avtomatik reja uni band qilmaydi (C5)
  const r = await runAttendancePlanNow({ companyId: a.companyId, shiftId, requestedBy: a.userId });
  if (r.ok) return res.json({ ok: true, jobId: r.jobId, duplicate: r.duplicate });
  const status = { not_found: 404, disabled: 409, queue_unavailable: 503, not_implemented: 501 }[r.code];
  return res.status(status).json({ error: r.code });
}));

// ───────────── Audit jurnali (sahifalangan) ─────────────
const AUDIT_STATUSES = new Set(['ok', 'denied', 'not_found', 'error', 'needs_confirmation', 'confirmed', 'cancelled', 'expired']);
const dateParam = (v: unknown) => (typeof v === 'string' && isIsoDate(v) ? v : undefined);
/** Toshkent kunining boshlanishi (UTC+5, DST yo'q — C7). */
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:00`);

router.get('/audit', wrap(async (req, res) => {
  const a = adminOf(res);
  const page = Math.max(1, Math.min(1000, Number.parseInt(String(req.query.page || '1'), 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
  const filter: Record<string, any> = { companyId: a.companyId };
  const from = dateParam(req.query.from);
  const to = dateParam(req.query.to);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = dayStart(from);
    if (to) filter.createdAt.$lt = dayStart(addDays(to, 1));
  }
  if (typeof req.query.tool === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(req.query.tool)) filter.tool = req.query.tool;
  if (typeof req.query.status === 'string' && AUDIT_STATUSES.has(req.query.status)) filter.status = req.query.status;
  const [total, rows] = await Promise.all([
    AiActionAudit.countDocuments(filter),
    // pending (token xeshi, shifrlangan argumentlar) va argumentlar tanlanmaydi
    AiActionAudit.find(filter).select('createdAt actorUserId actorRole targetUserId channel tool kind status resultSummary errorCode latencyMs')
      .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const ids = [...new Set(rows.flatMap((r: any) => [r.actorUserId, r.targetUserId]).filter(isObjectIdString))];
  const users: any[] = ids.length ? await User.find({ _id: { $in: ids }, companyId: a.companyId }).select('firstName lastName').lean() : [];
  const names = new Map(users.map((u) => [String(u._id), fullName(u)]));
  res.json({
    page, limit, total,
    items: rows.map((r: any) => ({
      id: String(r._id), at: r.createdAt, actorUserId: r.actorUserId, actorName: names.get(String(r.actorUserId)) || '',
      actorRole: r.actorRole, targetUserId: r.targetUserId, targetName: r.targetUserId ? names.get(String(r.targetUserId)) || '' : undefined,
      channel: r.channel, tool: r.tool, kind: r.kind, status: r.status, resultSummary: r.resultSummary, errorCode: r.errorCode, latencyMs: r.latencyMs,
    })),
  });
}));

// ───────────── Sarf va xarajat ─────────────
router.get('/usage', wrap(async (req, res) => {
  const a = adminOf(res);
  let to = dateParam(req.query.to) || localDate();
  let from = dateParam(req.query.from) || addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (from < addDays(to, -366)) from = addDays(to, -366);
  const rows: any[] = await AiUsageMetrics.aggregate([
    { $match: { companyId: a.companyId, userId: null, day: { $gte: from, $lte: to } } },
    { $group: {
      _id: { day: '$day', provider: '$provider' },
      costUsdMicros: { $sum: '$costUsdMicros' }, tokensIn: { $sum: '$tokensIn' }, tokensOut: { $sum: '$tokensOut' },
      sessions: { $sum: '$sessions' }, audioInSec: { $sum: '$audioInSec' }, audioOutSec: { $sum: '$audioOutSec' },
      toolCalls: { $sum: '$toolCalls' }, telegramCalls: { $sum: '$telegramCalls' }, botMessages: { $sum: '$botMessages' },
    } },
    { $sort: { '_id.day': 1, '_id.provider': 1 } },
  ]);
  const days = new Map<string, { day: string; costUsdMicros: number; tokens: number; sessions: number }>();
  const totals = { costUsdMicros: 0, tokensIn: 0, tokensOut: 0, sessions: 0, audioSec: 0, toolCalls: 0, telegramCalls: 0, botMessages: 0 };
  const byProvider: Record<string, number> = {};
  for (const r of rows) {
    const d = days.get(r._id.day) || { day: r._id.day, costUsdMicros: 0, tokens: 0, sessions: 0 };
    d.costUsdMicros += r.costUsdMicros; d.tokens += r.tokensIn + r.tokensOut; d.sessions += r.sessions;
    days.set(r._id.day, d);
    totals.costUsdMicros += r.costUsdMicros; totals.tokensIn += r.tokensIn; totals.tokensOut += r.tokensOut;
    totals.sessions += r.sessions; totals.audioSec += r.audioInSec + r.audioOutSec; totals.toolCalls += r.toolCalls;
    totals.telegramCalls += r.telegramCalls; totals.botMessages += r.botMessages;
    byProvider[r._id.provider] = (byProvider[r._id.provider] || 0) + r.costUsdMicros;
  }
  const s = await getSettingsFresh(a.companyId);
  res.json({
    from, to, days: [...days.values()], totals, byProvider,
    month: {
      costUsdMicros: await monthCostMicros(a.companyId), budgetUsd: s.limits.monthlyBudgetUsd,
      hardStop: s.limits.hardStop, exceeded: await budgetExceeded(a.companyId),
    },
  });
}));

// ───────────── Sinov xabari (FAQAT chaqiruvchining o'ziga, mavjud bot orqali) ─────────────
const TEST_TEXT = {
  uz: "✅ AI yordamchi sinov xabari. Bot sizga yetib keladi — hammasi joyida.",
  ru: '✅ Тестовое сообщение AI-ассистента. Бот до вас доходит — всё в порядке.',
};

router.post('/test', wrap(async (req, res) => {
  const a = adminOf(res);
  const body = isObj(req.body) ? req.body : {};
  // Boshqa xodimga sinov yuborib bo'lmaydi
  if (body.userId !== undefined && String(body.userId) !== a.userId) return res.status(403).json({ error: 'self_only' });
  if (body.channel !== undefined && body.channel !== 'bot_message') return res.status(400).json({ error: 'invalid', errors: ['channel: bot_message'] });
  if (!(await isAiActive(a.companyId))) return res.status(409).json({ error: 'ai_disabled' });
  const rl = await hitRate(`aiv:test:${a.userId}`, 5, 3600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited', retryAfterSec: rl.retryAfterSec });
  const me: any = await User.findById(a.userId).select('telegramChatId language').lean();
  if (!me?.telegramChatId) return res.status(409).json({ error: 'telegram_not_linked' });
  const bot = getBotInstance();
  if (!bot) return res.status(503).json({ error: 'bot_unavailable' });
  try {
    await bot.sendMessage(me.telegramChatId, TEST_TEXT[me.language === 'ru' ? 'ru' : 'uz']);
  } catch (e: any) {
    const code = Number(e?.response?.statusCode || e?.response?.body?.error_code || 0);
    return res.status(502).json({ error: code === 403 ? 'bot_blocked' : 'send_failed' });
  }
  recordUsage({ companyId: a.companyId, userId: a.userId, provider: 'bot', model: 'none' }, { botMessages: 1 }).catch(() => {});
  logAudit({
    userId: a.userId, userName: a.name || 'Admin', userRole: a.role, action: 'create', entity: 'ai_settings',
    entityId: a.companyId, description: "AI: sinov bot xabari (o'ziga)", companyId: a.companyId, req,
  }).catch(() => {});
  res.json({ ok: true, channel: 'bot_message' });
}));

export default router;
