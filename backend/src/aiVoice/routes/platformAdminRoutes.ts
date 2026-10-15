import { Router, type Request, type Response, type NextFunction } from 'express';
import AiActionAudit from '../../models/AiActionAudit';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiTranscriptArchive from '../../models/AiTranscriptArchive';
import AiUsageMetrics from '../../models/AiUsageMetrics';
import Company from '../../models/Company';
import User from '../../models/User';
import { logAudit } from '../../services/audit';
import { listArchives, readArchiveFile, sendArchive } from '../archive/transcriptArchive';
import { aiConfig } from '../config';
import { geminiConfigured } from '../lib/geminiKeys';
import { isObjectIdString } from '../lib/ids';
import { hitRate } from '../lib/mongoRateLimit';
import { addDays, isIsoDate, localDate } from '../lib/zonedTime';
import { getSharedQueue } from '../queue/jobQueue';
import { JOBS } from '../scheduler/jobTypes';
import { getCompanyAiState, getSettingsFresh, saveSettings, TRANSCRIPT_DB_DAYS, validateSettingsUpdate } from '../settings';
import { budgetExceeded, invalidateBudget, monthCostMicros } from '../usage';

// Dasturchi paneli: /api/ai-voice/platform (bootstrap: requireAuth + requireDeveloper; P6 telegram-account
// yo'llari platformRoutes'da — bu router ulardan OLDIN ulanadi, mos kelmagan so'rov keyingisiga o'tadi).
// Owner 2026-10-15 (#2): AI'ni platforma bo'yicha TO'LIQ boshqarish — firma bo'yicha yoqish, AI miyasi
// (brain/provider), limitlar, sarf/xarajat, firmalararo audit, transkript arxivlari.
// Kalit qiymatlari HECH QACHON qaytmaydi — faqat "sozlanganmi".

const router = Router();

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Ikkinchi himoya qatlami (bootstrap requireDeveloper'dan tashqari)
router.use((req, res, next) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  if (!u.isDeveloper && u.role !== 'dasturchi') return res.status(403).json({ error: 'forbidden' });
  return next();
});

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fullName = (u: any) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
const intParam = (v: unknown, def: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.parseInt(String(v ?? def), 10) || def));
const dateParam = (v: unknown) => (typeof v === 'string' && isIsoDate(v) ? v : undefined);
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:00`);

async function devName(req: Request): Promise<string> {
  const me: any = req.user?.userId ? await User.findById(req.user.userId).select('firstName lastName').lean().catch(() => null) : null;
  return fullName(me) || 'Dasturchi';
}

function audit(req: Request, companyId: string | undefined, description: string, action: 'update' | 'download' | 'create' = 'update') {
  void devName(req).then((userName) => logAudit({
    userId: String(req.user?.userId || ''), userName, userRole: 'dasturchi', action, entity: 'ai_settings',
    entityId: companyId || 'platform', description, ...(companyId ? { companyId } : {}), req,
  })).catch(() => {});
}

const providersConfigured = () => ({ gemini: geminiConfigured(), openrouter: aiConfig.brain.openRouterConfigured, claude: aiConfig.brain.claudeConfigured });

/** Firma bo'yicha joriy oy xarajati (bitta aggregate). */
async function monthCosts(ids: string[]): Promise<Map<string, number>> {
  const month = localDate().slice(0, 7);
  const rows: any[] = ids.length ? await AiUsageMetrics.aggregate([
    { $match: { companyId: { $in: ids }, userId: null, day: { $gte: `${month}-01`, $lte: `${month}-31` } } },
    { $group: { _id: '$companyId', total: { $sum: '$costUsdMicros' } } },
  ]) : [];
  return new Map(rows.map((r) => [String(r._id), Number(r.total || 0)]));
}

// ───────────── Umumiy holat ─────────────
router.get('/overview', wrap(async (_req, res) => {
  const month = localDate().slice(0, 7);
  const [enabledCompanies, cost, archives, pendingArchives] = await Promise.all([
    AiAssistantSettings.countDocuments({ enabled: true }),
    AiUsageMetrics.aggregate([
      { $match: { userId: null, day: { $gte: `${month}-01`, $lte: `${month}-31` } } },
      { $group: { _id: null, total: { $sum: '$costUsdMicros' } } },
    ]),
    AiTranscriptArchive.countDocuments({}),
    AiTranscriptArchive.countDocuments({ status: 'stored' }),
  ]);
  res.json({
    aiVoiceEnabled: aiConfig.enabled,
    providers: providersConfigured(),
    enabledCompanies,
    month: { month, costUsdMicros: Number((cost as any[])[0]?.total || 0) },
    archives: { total: archives, pendingDelete: pendingArchives, keepInDbDays: TRANSCRIPT_DB_DAYS },
    queue: { running: !!getSharedQueue() },
  });
}));

// ───────────── Firmalar ─────────────
router.get('/companies', wrap(async (req, res) => {
  const page = intParam(req.query.page, 1, 1, 1000);
  const limit = intParam(req.query.limit, 30, 1, 100);
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const filter: Record<string, unknown> = q ? { name: new RegExp(esc(q), 'i') } : {};
  // aiOnly=1 — faqat AI sozlamasi yoqilgan firmalar
  if (req.query.aiOnly === '1') {
    const ids = (await AiAssistantSettings.find({ enabled: true }).select('companyId').limit(5000).lean()).map((r: any) => String(r.companyId));
    filter._id = { $in: ids.filter(isObjectIdString) };
  }
  const [total, cos] = await Promise.all([
    Company.countDocuments(filter),
    Company.find(filter).select('name status').sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const ids = cos.map((c: any) => String(c._id));
  const [settingsRows, costs] = await Promise.all([
    AiAssistantSettings.find({ companyId: { $in: ids } }).select('companyId enabled attendance.enabled brain limits version').lean(),
    monthCosts(ids),
  ]);
  const byId = new Map(settingsRows.map((r: any) => [String(r.companyId), r]));
  const items = [];
  for (const c of cos as any[]) {
    const id = String(c._id);
    const st = await getCompanyAiState(id);
    const s: any = byId.get(id);
    items.push({
      companyId: id, name: String(c.name || ''), status: String(c.status || 'ACTIVE'), planHasFeature: st.hasFeature,
      aiEnabled: !!s?.enabled, attendanceEnabled: !!s?.attendance?.enabled,
      monthCostUsdMicros: costs.get(id) || 0,
      ...(s?.limits?.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: s.limits.monthlyBudgetUsd } : {}),
    });
  }
  res.json({ page, limit, total, items });
}));

async function companyView(companyId: string) {
  const [s, st] = await Promise.all([getSettingsFresh(companyId), getCompanyAiState(companyId)]);
  return {
    companyId, name: st.name, status: { exists: st.exists, active: st.active, planHasFeature: st.hasFeature, aiVoiceEnabled: aiConfig.enabled },
    settings: s,                                          // TO'LIQ (brain/provider/limits bilan)
    providers: providersConfigured(),
    month: { costUsdMicros: await monthCostMicros(companyId), budgetUsd: s.limits.monthlyBudgetUsd, hardStop: s.limits.hardStop, exceeded: await budgetExceeded(companyId) },
  };
}

async function loadCompany(req: Request, res: Response): Promise<string | null> {
  const id = String(req.params.companyId || '');
  if (!isObjectIdString(id) || !(await getCompanyAiState(id)).exists) { res.status(404).json({ error: 'not_found' }); return null; }
  return id;
}

router.get('/companies/:companyId', wrap(async (req, res) => {
  const id = await loadCompany(req, res);
  if (id) res.json(await companyView(id));
}));

/** Dasturchi o'zgartira oladigan bo'limlar: yoqish, AI miyasi, ovoz provayderi/modellari, limitlar. */
const PLATFORM_KEYS = new Set(['enabled', 'brain', 'provider', 'limits']);

router.patch('/companies/:companyId', wrap(async (req, res) => {
  const id = await loadCompany(req, res);
  if (!id) return;
  const body = req.body;
  if (!isObj(body) || typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 0 || !isObj(body.patch)) {
    return res.status(400).json({ error: 'invalid', errors: ['{version:number, patch:object} kerak'] });
  }
  const bad = Object.keys(body.patch).filter((k) => !PLATFORM_KEYS.has(k));
  if (bad.length) return res.status(400).json({ error: 'invalid', errors: bad.map((k) => `${k}: dasturchi panelida o'zgartirilmaydi (firma sozlamasi)`) });
  const current = await getSettingsFresh(id);
  if (body.version !== current.version) return res.status(409).json({ error: 'version_conflict', current: await companyView(id) });
  // Dasturchi firma jadvali/tool'lariga tegmaydi — validator shu bo'limlarni o'zgarmagan holda tekshiradi
  const v = validateSettingsUpdate(body.patch, current, { role: 'dasturchi', isOwner: false });
  if (!v.ok) return res.status(400).json({ error: 'invalid', errors: v.errors });
  const saved = await saveSettings(id, v.value, current.version, String(req.user?.userId || 'developer'));
  if (!saved.ok) return res.status(409).json({ error: 'version_conflict', current: await companyView(id) });
  invalidateBudget(id);
  audit(req, id, `AI (dasturchi): ${Object.keys(body.patch).join(', ')}`);
  res.json(await companyView(id));
}));

// ───────────── Sarf va xarajat ─────────────
function rangeOf(req: Request): { from: string; to: string } {
  let to = dateParam(req.query.to) || localDate();
  let from = dateParam(req.query.from) || addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (from < addDays(to, -366)) from = addDays(to, -366);
  return { from, to };
}

/** Barcha firmalar bo'yicha jami (firma kesimida). */
router.get('/usage', wrap(async (req, res) => {
  const { from, to } = rangeOf(req);
  const rows: any[] = await AiUsageMetrics.aggregate([
    { $match: { userId: null, day: { $gte: from, $lte: to } } },
    { $group: {
      _id: '$companyId', costUsdMicros: { $sum: '$costUsdMicros' }, tokensIn: { $sum: '$tokensIn' }, tokensOut: { $sum: '$tokensOut' },
      sessions: { $sum: '$sessions' }, audioSec: { $sum: { $add: ['$audioInSec', '$audioOutSec'] } }, toolCalls: { $sum: '$toolCalls' },
      telegramCalls: { $sum: '$telegramCalls' }, botMessages: { $sum: '$botMessages' },
    } },
    { $sort: { costUsdMicros: -1 } },
    { $limit: 500 },
  ]);
  const ids = rows.map((r) => String(r._id)).filter(isObjectIdString);
  const names = new Map((await Company.find({ _id: { $in: ids } }).select('name').lean()).map((c: any) => [String(c._id), String(c.name || '')]));
  const totals = rows.reduce((t, r) => ({ costUsdMicros: t.costUsdMicros + r.costUsdMicros, sessions: t.sessions + r.sessions }), { costUsdMicros: 0, sessions: 0 });
  res.json({
    from, to, totals,
    companies: rows.map((r) => ({
      companyId: String(r._id), name: names.get(String(r._id)) || '', costUsdMicros: r.costUsdMicros, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
      sessions: r.sessions, audioSec: r.audioSec, toolCalls: r.toolCalls, telegramCalls: r.telegramCalls, botMessages: r.botMessages,
    })),
  });
}));

/** Bitta firma: kunlik va provayder bo'yicha (avval /admin/usage edi). */
router.get('/usage/:companyId', wrap(async (req, res) => {
  const id = await loadCompany(req, res);
  if (!id) return;
  const { from, to } = rangeOf(req);
  const rows: any[] = await AiUsageMetrics.aggregate([
    { $match: { companyId: id, userId: null, day: { $gte: from, $lte: to } } },
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
  const s = await getSettingsFresh(id);
  res.json({
    companyId: id, from, to, days: [...days.values()], totals, byProvider,
    month: { costUsdMicros: await monthCostMicros(id), budgetUsd: s.limits.monthlyBudgetUsd, hardStop: s.limits.hardStop, exceeded: await budgetExceeded(id) },
  });
}));

// ───────────── Firmalararo audit ─────────────
const AUDIT_STATUSES = new Set(['ok', 'denied', 'not_found', 'error', 'needs_confirmation', 'confirmed', 'cancelled', 'expired']);

router.get('/audit', wrap(async (req, res) => {
  const page = intParam(req.query.page, 1, 1, 1000);
  const limit = intParam(req.query.limit, 20, 1, 100);
  const filter: Record<string, any> = {};
  if (typeof req.query.companyId === 'string' && isObjectIdString(req.query.companyId)) filter.companyId = req.query.companyId;
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
    AiActionAudit.find(filter).select('companyId createdAt actorUserId actorRole targetUserId channel tool kind status resultSummary errorCode latencyMs')
      .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const uids = [...new Set(rows.flatMap((r: any) => [r.actorUserId, r.targetUserId]).filter(isObjectIdString))];
  const cids = [...new Set(rows.map((r: any) => String(r.companyId)).filter(isObjectIdString))];
  const [users, cos]: any[][] = await Promise.all([
    uids.length ? User.find({ _id: { $in: uids } }).select('firstName lastName').lean() : [],
    cids.length ? Company.find({ _id: { $in: cids } }).select('name').lean() : [],
  ]);
  const names = new Map(users.map((u) => [String(u._id), fullName(u)]));
  const coNames = new Map(cos.map((c) => [String(c._id), String(c.name || '')]));
  res.json({
    page, limit, total,
    items: rows.map((r: any) => ({
      id: String(r._id), companyId: r.companyId, companyName: coNames.get(String(r.companyId)) || '', at: r.createdAt,
      actorUserId: r.actorUserId, actorName: names.get(String(r.actorUserId)) || '', actorRole: r.actorRole,
      targetUserId: r.targetUserId, targetName: r.targetUserId ? names.get(String(r.targetUserId)) || '' : undefined,
      channel: r.channel, tool: r.tool, kind: r.kind, status: r.status, resultSummary: r.resultSummary, errorCode: r.errorCode, latencyMs: r.latencyMs,
    })),
  });
}));

// ───────────── Transkript arxivlari (barcha firmalar) ─────────────
router.get('/archives', wrap(async (req, res) => {
  const c = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  // companyId=platform — firmasiz (dasturchi) suhbatlari
  const companyId = c === 'platform' ? null : isObjectIdString(c) ? c : undefined;
  const r = await listArchives({ all: true, ...(companyId !== undefined ? { companyId } : {}) }, {
    page: intParam(req.query.page, 1, 1, 1000), limit: intParam(req.query.limit, 30, 1, 100),
    from: dateParam(req.query.from), to: dateParam(req.query.to),
  });
  const cids = [...new Set(r.items.map((i) => i.companyId).filter((x): x is string => !!x && isObjectIdString(x)))];
  const names = new Map((cids.length ? await Company.find({ _id: { $in: cids } }).select('name').lean() : []).map((x: any) => [String(x._id), String(x.name || '')]));
  res.json({ ...r, items: r.items.map((i) => ({ ...i, companyName: i.companyId ? names.get(i.companyId) || '' : '' })) });
}));

router.get('/archives/:id/download', wrap(async (req, res) => {
  const f = await readArchiveFile(String(req.params.id), { all: true });
  if (!f) return res.status(404).json({ error: 'not_found' });
  audit(req, f.companyId || undefined, `AI transkript arxivi yuklab olindi (${f.period})`, 'download');
  sendArchive(res, f.fileName, f.data);
}));

/** Arxivni hozir ishga tushirish (navbat orqali; AI o'chiq bo'lsa navbat yo'q — 503). */
router.post('/archives/run', wrap(async (req, res) => {
  const q = getSharedQueue();
  if (!q) return res.status(503).json({ error: 'queue_unavailable' });
  const rl = await hitRate(`aiv:archrun:${String(req.user?.userId || '')}`, 6, 3600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited', retryAfterSec: rl.retryAfterSec });
  const minute = new Date().toISOString().slice(0, 16);
  const r = await q.enqueue({ type: JOBS.archive, runAt: new Date(), dedupeKey: `arch:manual:${minute}`, payload: { manual: true } });
  audit(req, undefined, 'AI transkript arxivi qo\'lda ishga tushirildi', 'create');
  res.json({ ok: true, jobId: r.id, duplicate: r.duplicate });
}));

export default router;
