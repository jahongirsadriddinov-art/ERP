import crypto from 'crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiCallSession from '../../models/AiCallSession';
import AiChannelConnection from '../../models/AiChannelConnection';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import Company from '../../models/Company';
import User from '../../models/User';
import AiUnmetRequest, { AI_UNMET_REASONS } from '../../models/AiUnmetRequest';
import { logAudit } from '../../services/audit';
import { placeGuestCall, telegramCallChannel } from '../channels/telegramCallChannel';
import { aiConfig } from '../config';
import { companyConsentMap, evaluateCallConsent, getCallConsent } from '../consent';
import { isAiActive } from '../settings';
import { botLinkedTgId } from '../telegram/tgLink';
import { isObjectIdString, newCorrelationId } from '../lib/ids';
import { hitRate, peekRate } from '../lib/mongoRateLimit';
import { ensurePlatformConnection } from '../lib/workerLease';
import {
  accountDto, maskPhone, setConnectedAccount, setFloodWait, setLoggedOut, setLoginState,
} from '../telegram/accountService';
import { setAvatarEnabled, setOpenConversation } from '../telegram/incomingCalls';
import { callWorker, WorkerRpcFailure } from '../telegram/workerRpc';
import { getActiveWorker } from '../telegram/workerNamespace';
import {
  createPoolAccount, getAccount, listPoolAccounts, MAX_POOL_ACCOUNTS, removePoolAccount,
  cleanAiName, setAccountConnected, setAccountLogin, setAccountName, syncAccountsToWorker,
} from '../telegram/companyAccounts';

// Platforma: /api/ai-voice/platform (bootstrap: requireAuth + requireDeveloper — faqat dasturchi).
// AI Telegram akkaunti: holat, login (telefon → kod → 2FA), chiqish, UDP tekshiruv, sinov qo'ng'irog'i.
// XAVFSIZLIK (review B7/B8):
//  • barcha javoblar Cache-Control: no-store;
//  • telefon/kod/parol HECH QACHON saqlanmaydi, log/audit qilinmaydi, xato matniga qo'shilmaydi —
//    to'g'ridan-to'g'ri worker RPC'ga uzatiladi; kutilayotgan login holati faqat worker xotirasida,
//    backend faqat server bergan loginAttemptId'ni (sir emas) va uni boshlagan dasturchini biladi;
//  • login qadamlari 5 ta / 10 daqiqa; sinov qo'ng'irog'i 20 ta / 10 daqiqa (30 s oraliq), faqat samarali rozilikka ega
//    (consent.getCallConsent) xodimga va firma bilan audit yozuvi;
//  • StringSession bu yerda yo'q — u faqat worker diskida (TG_SESSION_KEY bilan shifrlangan).

const router = Router();

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    // So'rov tanasi va xato tafsiloti hech qachon qaytarilmaydi yoki log qilinmaydi
    fn(req, res).catch((e) => {
      console.error('[aiVoice/platform] xato:', (e as Error)?.name || 'Error');
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
      else next();
    });
  };

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const fullName = (u: any) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLATFORM_TG = { scope: 'platform' as const, companyId: null, type: 'telegram_user' as const };

export const LOGIN_MAX = 5;
const LOGIN_WINDOW_MS = 10 * 60_000;
// Owner 2026-10-17: sinov qo'ng'irog'i — 20 ta / 10 daqiqa, oraliq 30 s; faqat TERILGAN qo'ng'iroqlar sanaladi
export const TEST_CALL_MAX = 20;
const TEST_CALL_WINDOW_MS = 10 * 60_000;
export const TEST_CALL_COOLDOWN_SEC = 30;
const lastTestAt = new Map<string, number>();

/** Bitta Telegram akkaunti bir vaqtda faqat BITTA qo'ng'iroqni ko'taradi (Telegram cheklovi). */
export const ONE_CALL_NOTE = {
  uz: "Bitta AI Telegram akkaunti bir vaqtda faqat bitta qo'ng'iroqni ko'taradi. Qo'ng'iroq davom etayotganda yangisi \"band\" bo'ladi; tugagach darhol keyingisi mumkin.",
  ru: 'Один Telegram-аккаунт ИИ одновременно ведёт только один звонок. Во время разговора новый звонок получит «занято»; после завершения — можно сразу звонить снова.',
};
const ATTEMPT_TTL_MS = 15 * 60_000;

const PHONE_RE = /^\+?[1-9]\d{8,14}$/;
const CODE_RE = /^\d{4,8}$/;
const ATTEMPT_RE = /^[0-9a-f-]{36}$/;

// Server bergan loginAttemptId → kim boshlagan (sir emas; kod/parol bu yerda yo'q)
const attempts = new Map<string, { userId: string; expiresAt: number }>();

function ownAttempt(id: unknown, userId: string): string | null {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.expiresAt <= now) attempts.delete(k);
  if (typeof id !== 'string' || !ATTEMPT_RE.test(id)) return null;
  const a = attempts.get(id);
  return a && a.userId === userId ? id : null;
}

interface Dev { userId: string; name: string; role: string }

async function developer(req: Request): Promise<Dev> {
  const userId = String(req.user?.userId || '');
  const me: any = isObjectIdString(userId) ? await User.findById(userId).select('firstName lastName').lean() : null;
  return { userId, name: fullName(me) || 'Dasturchi', role: String(req.user?.role || 'dasturchi') };
}

async function limited(res: Response, key: string, max: number, windowMs: number): Promise<boolean> {
  const rl = await hitRate(key, max, windowMs);
  if (rl.allowed) return false;
  res.status(429).json({ error: 'rate_limited', retryAfterSec: rl.retryAfterSec });
  return true;
}

// Worker xato kodlari → HTTP (javobda faqat kod; kiritilgan qiymatlar hech qachon qaytmaydi)
const RPC_HTTP: Record<string, number> = {
  worker_offline: 503, timeout: 504, bad_response: 502, not_leased: 503, telegram_unavailable: 503,
  phone_invalid: 400, phone_banned: 403, code_invalid: 400, code_expired: 410, password_invalid: 400,
  attempt_expired: 410, password_required: 409, already_connected: 409, not_authorized: 409,
  flood_wait: 429, busy: 409,
};

async function rpcError(res: Response, e: unknown): Promise<void> {
  const code = e instanceof WorkerRpcFailure ? e.code : 'error';
  const retryAfterSec = e instanceof WorkerRpcFailure ? e.retryAfterSec : undefined;
  if (code === 'flood_wait' && retryAfterSec) await setFloodWait(Date.now() + retryAfterSec * 1000).catch(() => undefined);
  res.status(RPC_HTTP[code] || 502).json({ error: code, ...(retryAfterSec ? { retryAfterSec } : {}) });
}

const audit = (req: Request, dev: Dev, action: 'create' | 'update' | 'delete', description: string, extra: { entityId?: string; companyId?: string } = {}) =>
  logAudit({
    userId: dev.userId, userName: dev.name, userRole: dev.role, action, entity: 'ai_telegram_account',
    entityId: extra.entityId || 'platform', companyId: extra.companyId, description, req,
  }).catch(() => {});

export async function platformStatusView() {
  const conn: any = await AiChannelConnection.findOne(PLATFORM_TG)
    .select('status lastError workerId leaseUntil udpProbe connectedAt openConversation openConversationAt avatarEnabled').lean();
  const w = getActiveWorker();
  return {
    aiVoiceEnabled: aiConfig.enabled,
    account: await accountDto(),
    worker: {
      connectedHere: !!w,
      workerId: w?.workerId || conn?.workerId || undefined,
      leaseActive: !!conn?.leaseUntil && new Date(conn.leaseUntil).getTime() > Date.now(),
    },
    lastError: conn?.status !== 'connected' ? (conn?.lastError || undefined) : undefined,
    udpCheckedAt: conn?.udpProbe?.at ? new Date(conn.udpProbe.at).toISOString() : undefined,
    connectedAt: conn?.connectedAt ? new Date(conn.connectedAt).toISOString() : undefined,
    limits: { loginPer10Min: LOGIN_MAX, testCallsPer10Min: TEST_CALL_MAX, testCallCooldownSec: TEST_CALL_COOLDOWN_SEC, concurrentCalls: 1 },
    notes: { oneCallAtATime: ONE_CALL_NOTE },
    openConversation: conn?.openConversation === true,
    avatarEnabled: conn?.avatarEnabled !== false,
    openConversationAt: conn?.openConversationAt ? new Date(conn.openConversationAt).toISOString() : undefined,
  };
}

// ───────────── "AI qila olmadi" (owner 2026-10-22) ─────────────
// AI navbati rad / noma'lum tool / tool xatosi / "qila olmayman" javobi bilan tugagan so'rovlar (brain/unmet.ts).
// GET /unmet?limit=50&reason=tool_error&companyId=... — eng yangisi birinchi; firma va foydalanuvchi nomi bilan.
router.get('/unmet', wrap(async (req, res) => {
  const n = Number(req.query.limit);
  const limit = Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : 50;
  const filter: Record<string, unknown> = {};
  if (typeof req.query.reason === 'string' && (AI_UNMET_REASONS as string[]).includes(req.query.reason)) filter.reason = req.query.reason;
  if (typeof req.query.companyId === 'string' && (isObjectIdString(req.query.companyId) || req.query.companyId === 'platform')) filter.companyId = req.query.companyId;
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [rows, total, week] = await Promise.all([
    AiUnmetRequest.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean(),
    AiUnmetRequest.countDocuments(filter),
    AiUnmetRequest.aggregate([{ $match: { ...filter, createdAt: { $gte: since } } }, { $group: { _id: '$reason', n: { $sum: 1 } } }]),
  ]);
  const uids = [...new Set(rows.map((r: any) => String(r.userId)).filter(isObjectIdString))];
  const cids = [...new Set(rows.map((r: any) => String(r.companyId)).filter(isObjectIdString))];
  const [users, cos]: any[][] = await Promise.all([
    uids.length ? User.find({ _id: { $in: uids } }).select('firstName lastName role').lean() : [],
    cids.length ? Company.find({ _id: { $in: cids } }).select('name').lean() : [],
  ]);
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const cMap = new Map(cos.map((c) => [String(c._id), String(c.name || '')]));
  res.json({
    total,
    byReason7d: Object.fromEntries((week as any[]).map((w) => [w._id, w.n])),
    items: rows.map((r: any) => {
      const u = uMap.get(String(r.userId));
      return {
        id: String(r._id), createdAt: new Date(r.createdAt).toISOString(), companyId: r.companyId,
        companyName: cMap.get(String(r.companyId)) || (r.companyId === 'platform' ? 'platform' : ''),
        userId: r.userId, userName: u ? fullName(u) : '', userRole: u?.role || '', channel: r.channel, reason: r.reason,
        userText: r.userText || '', aiReply: r.aiReply || '', toolName: r.toolName || undefined, toolMessage: r.toolMessage || undefined,
      };
    }),
  });
}));

// ───────────── Holat ─────────────
router.get('/telegram-account', wrap(async (_req, res) => {
  res.json(await platformStatusView());
}));

// ───────────── Login: telefon → kod → 2FA ─────────────
router.post('/telegram-account/login/start', wrap(async (req, res) => {
  const dev = await developer(req);
  const phone = isObj(req.body) && typeof req.body.phone === 'string' ? req.body.phone.replace(/[\s()-]/g, '') : '';
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'phone_invalid' });
  if (await limited(res, `aiv:tglogin:start:${dev.userId}`, LOGIN_MAX, LOGIN_WINDOW_MS)) return;
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  const loginAttemptId = crypto.randomUUID();
  attempts.set(loginAttemptId, { userId: dev.userId, expiresAt: Date.now() + ATTEMPT_TTL_MS });
  let r;
  try {
    r = await callWorker('auth.start', { loginAttemptId, phone });
  } catch (e) {
    attempts.delete(loginAttemptId);
    return rpcError(res, e);
  }
  const phoneMasked = maskPhone(phone);
  if (r.status === 'connected') {
    attempts.delete(loginAttemptId);
    await setConnectedAccount({}, dev.userId);
    audit(req, dev, 'update', 'AI Telegram akkaunti ulandi');
    return res.json({ status: 'connected', phoneMasked, account: await accountDto() });
  }
  await setLoginState({ status: r.status, phoneMasked, by: dev.userId });
  audit(req, dev, 'update', 'AI Telegram: kirish boshlandi');
  res.json({ status: r.status, loginAttemptId, phoneMasked });
}));

async function finishConnected(req: Request, dev: Dev, info: { tgUserId?: string; username?: string; displayName?: string }) {
  await setConnectedAccount(info, dev.userId);
  audit(req, dev, 'update', 'AI Telegram akkaunti ulandi');
}

router.post('/telegram-account/login/code', wrap(async (req, res) => {
  const dev = await developer(req);
  const body = isObj(req.body) ? req.body : {};
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'code_invalid' });
  const loginAttemptId = ownAttempt(body.loginAttemptId, dev.userId);
  if (!loginAttemptId) return res.status(410).json({ error: 'attempt_expired' });
  if (await limited(res, `aiv:tglogin:code:${dev.userId}`, LOGIN_MAX, LOGIN_WINDOW_MS)) return;
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  let r;
  try {
    r = await callWorker('auth.code', { loginAttemptId, code });
  } catch (e) {
    return rpcError(res, e);
  }
  if (r.status === 'connected') {
    attempts.delete(loginAttemptId);
    await finishConnected(req, dev, r);
    return res.json({ status: 'connected', account: await accountDto() });
  }
  await setLoginState({ status: 'awaiting_password', by: dev.userId });
  res.json({ status: 'awaiting_password', loginAttemptId });
}));

router.post('/telegram-account/login/password', wrap(async (req, res) => {
  const dev = await developer(req);
  const body = isObj(req.body) ? req.body : {};
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 256) return res.status(400).json({ error: 'password_invalid' });
  const loginAttemptId = ownAttempt(body.loginAttemptId, dev.userId);
  if (!loginAttemptId) return res.status(410).json({ error: 'attempt_expired' });
  if (await limited(res, `aiv:tglogin:pw:${dev.userId}`, LOGIN_MAX, LOGIN_WINDOW_MS)) return;
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  let r;
  try {
    r = await callWorker('auth.password', { loginAttemptId, password });
  } catch (e) {
    return rpcError(res, e);
  }
  attempts.delete(loginAttemptId);
  await finishConnected(req, dev, r);
  res.json({ status: 'connected', account: await accountDto() });
}));

router.post('/telegram-account/login/cancel', wrap(async (req, res) => {
  const dev = await developer(req);
  const id = ownAttempt(isObj(req.body) ? req.body.loginAttemptId : undefined, dev.userId);
  if (id) attempts.delete(id);
  const conn: any = await AiChannelConnection.findOne(PLATFORM_TG).select('status').lean();
  if (conn?.status === 'awaiting_code' || conn?.status === 'awaiting_password') await setLoginState({ status: 'disconnected', by: dev.userId });
  res.json({ ok: true });
}));

router.post('/telegram-account/logout', wrap(async (req, res) => {
  const dev = await developer(req);
  if (await limited(res, `aiv:tglogout:${dev.userId}`, LOGIN_MAX, LOGIN_WINDOW_MS)) return;
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  try {
    await callWorker('auth.logout', {});
  } catch (e) {
    return rpcError(res, e);
  }
  await setLoggedOut(dev.userId);
  audit(req, dev, 'delete', 'AI Telegram akkauntidan chiqildi');
  res.json({ ok: true, account: await accountDto() });
}));

// ───────────── "Ochiq muloqot" (kiruvchi qo'ng'iroqlar) ─────────────
// Yoqilsa: faqat bog'langan + rozilik bergan xodimlarning qo'ng'irog'ini AI qabul qiladi (telegram/incomingCalls.ts).
router.post('/telegram-account/open-conversation', wrap(async (req, res) => {
  const dev = await developer(req);
  const enabled = isObj(req.body) ? req.body.enabled : undefined;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'invalid', errors: ['enabled'] });
  if (await limited(res, `aiv:tgopen:${dev.userId}`, 20, LOGIN_WINDOW_MS)) return;
  const workerSynced = await setOpenConversation(enabled, dev.userId);
  audit(req, dev, 'update', `AI Telegram: "Ochiq muloqot" ${enabled ? 'yoqildi' : "o'chirildi"}`);
  res.json({ ok: true, openConversation: enabled, workerSynced });
}));

// ───────────── Video avatar (owner 2026-10-19): o'chirilsa — avatar yo'q, kamera ko'rish va boshqa hammasi ishlaydi ─────────────
router.post('/telegram-account/avatar', wrap(async (req, res) => {
  const dev = await developer(req);
  const enabled = isObj(req.body) ? req.body.enabled : undefined;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'invalid', errors: ['enabled'] });
  await setAvatarEnabled(enabled);
  audit(req, dev, 'update', `AI Telegram: video avatar ${enabled ? 'yoqildi' : "o'chirildi"}`);
  res.json({ ok: true, avatarEnabled: enabled });
}));

// ───────────── UDP tekshiruv ─────────────
router.post('/telegram-account/udp-probe', wrap(async (req, res) => {
  const dev = await developer(req);
  if (await limited(res, `aiv:tgudp:${dev.userId}`, 10, LOGIN_WINDOW_MS)) return;
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  let r;
  try {
    r = await callWorker('udp.probe', {});
  } catch (e) {
    return rpcError(res, e);
  }
  await ensurePlatformConnection();
  await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { udpProbe: { ok: !!r?.ok, at: new Date() } } });
  res.json({ ok: !!r?.ok, details: typeof r?.details === 'string' ? r.details.slice(0, 200) : undefined });
}));

// ───────────── Sinov qo'ng'irog'i (B7) ─────────────
/**
 * Sinov uchun nomzodlar (owner 2026-10-16): AI yoqilgan (faol, tarifli) firmalarning samarali roziligi bor va
 * ERP botga (yoki eski kod bilan) Telegram bog'langan xodimlari. Telefon raqamlari qaytmaydi.
 */
router.get('/telegram-account/test-targets', wrap(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
  const enabled: any[] = await AiAssistantSettings.find({ enabled: true }).select('companyId').limit(500).lean();
  const companyIds: string[] = [];
  for (const id of [...new Set(enabled.map((s) => String(s.companyId || '')))]) {
    if (isObjectIdString(id) && (await isAiActive(id))) companyIds.push(id);
  }
  if (!companyIds.length) return res.json({ targets: [] });
  const userFilter: Record<string, unknown> = {
    companyId: { $in: companyIds }, isBlocked: { $ne: true }, role: { $ne: 'dasturchi' },
  };
  const and: Record<string, unknown>[] = [];
  if (q) {
    const rx = new RegExp(esc(q), 'i');
    and.push({ $or: [{ firstName: rx }, { lastName: rx }] });
  }
  // Telefon tanlanmaydi
  const users: any[] = await User.find(and.length ? { ...userFilter, $and: and } : userFilter)
    .select('firstName lastName companyId telegramChatId telegramUserId').sort({ firstName: 1 }).limit(500).lean();
  const contacts: any[] = users.length ? await AiEmployeeContact.find({ employeeId: { $in: users.map((u) => String(u._id)) } })
    .select('companyId employeeId telegram.tgUserId telegram.callConsent telegram.resolveStatus optOut').lean() : [];
  const byUser = new Map(contacts.map((c) => [`${c.companyId}:${c.employeeId}`, c]));
  const consentOn = await companyConsentMap(companyIds);
  const targets: unknown[] = [];
  for (const u of users) {
    const companyId = String(u.companyId || '');
    const ct = byUser.get(`${companyId}:${String(u._id)}`);
    const linked = !!botLinkedTgId(u) || typeof ct?.telegram?.tgUserId === 'string';
    if (!linked || !evaluateCallConsent(consentOn.get(companyId) !== false, ct).allowed) continue;
    targets.push({ userId: String(u._id), name: fullName(u) || '—', companyId, resolveStatus: String(ct?.telegram?.resolveStatus || 'unknown') });
    if (targets.length >= 20) break;
  }
  const names = new Map<string, string>();
  const cos: any[] = await Company.find({ _id: { $in: [...new Set(targets.map((t: any) => t.companyId))] } }).select('name').lean();
  for (const c of cos) names.set(String(c._id), String(c.name || ''));
  res.json({ targets: targets.map((t: any) => ({ ...t, companyName: names.get(t.companyId) || '' })) });
}));

router.post('/telegram-account/test-call', wrap(async (req, res) => {
  const dev = await developer(req);
  const userId = isObj(req.body) ? req.body.userId : undefined;
  if (!isObjectIdString(userId)) return res.status(400).json({ error: 'invalid', errors: ['userId'] });
  const target: any = await User.findById(userId).select('firstName lastName companyId language').lean();
  const companyId = target?.companyId ? String(target.companyId) : '';
  if (!target || !companyId) return res.status(404).json({ error: 'not_found' });
  // B7 (owner 2026-10-16): faqat samarali rozilikka ega xodimga (firma roziligi yoki eski shaxsiy, opt-out'siz)
  const consent = await getCallConsent(companyId, String(userId));
  if (!consent.allowed) return res.status(409).json({ error: consent.reason || 'no_consent' });
  {
    const nowMs = Date.now();
    const lang = target.language === 'ru' ? 'ru' : 'uz';
    const last = lastTestAt.get(dev.userId) || 0;
    const wait = Math.ceil((last + TEST_CALL_COOLDOWN_SEC * 1000 - nowMs) / 1000);
    if (wait > 0) {
      return res.status(429).json({ error: 'rate_limited', code: 'cooldown', retryAfterSec: wait,
        message: lang === 'ru' ? `Следующий тестовый звонок — через ${wait} сек.` : `Keyingi sinov qo'ng'irog'i ${wait} soniyadan keyin.` });
    }
    const used = await peekRate(`aiv:tgtest:${dev.userId}`, TEST_CALL_WINDOW_MS, new Date(nowMs));
    if (used >= TEST_CALL_MAX) {
      const retryAfterSec = Math.max(1, Math.ceil((TEST_CALL_WINDOW_MS - (nowMs % TEST_CALL_WINDOW_MS)) / 1000));
      return res.status(429).json({ error: 'rate_limited', code: 'window', retryAfterSec,
        message: lang === 'ru' ? `${TEST_CALL_MAX} тестовых звонков за 10 минут — подождите ${retryAfterSec} сек.` : `10 daqiqada ${TEST_CALL_MAX} ta sinov qo'ng'irog'i — ${retryAfterSec} soniya kuting.` });
    }
  }

  const ctx = {
    companyId, employeeId: String(userId), correlationId: newCorrelationId(), purpose: 'test' as const,
    lang: (target.language === 'ru' ? 'ru' : 'uz') as 'uz' | 'ru', now: new Date(), attemptNo: 1,
  };
  const av = await telegramCallChannel.isAvailable(ctx);
  let result: { outcome: string; errorCode?: string; sessionId?: string };
  if (!av.ok) {
    result = { outcome: 'unavailable', errorCode: av.reason };
  } else {
    const r = await telegramCallChannel.attempt(ctx, { kind: 'test', ringTimeoutSec: 45, maxDurationSec: 60 });
    result = { outcome: r.outcome, errorCode: r.errorCode, sessionId: r.sessionId };
  }
  // 'no_answer' + sessionId — qo'ng'iroq terildi, natija keyin call.state orqali keladi
  const placed = !!result.sessionId && result.outcome === 'no_answer';
  // Terilmagan urinish (kanal yo'q, band, xato) limitga yozilmaydi
  if (placed) {
    lastTestAt.set(dev.userId, Date.now());
    await hitRate(`aiv:tgtest:${dev.userId}`, TEST_CALL_MAX, TEST_CALL_WINDOW_MS).catch(() => undefined);
  }
  audit(req, dev, 'create',
    `AI Telegram: sinov qo'ng'irog'i — ${fullName(target) || 'xodim'} (${placed ? 'terildi' : (result.errorCode || result.outcome)})`,
    { entityId: String(userId), companyId });
  res.status(placed ? 202 : 409).json({ placed, ...result });
}));

// Mehmon sinov qo'ng'irog'i (owner 2026-10-19): Telegram raqami yoki @username → AI oddiy suhbat uchun qo'ng'iroq
// qiladi (firma/ERP'ga ulanmaydi). Sinov qo'ng'irog'i bilan BIR XIL chegara (oraliq + 10 daqiqalik oyna).
// Telefon saqlanmaydi; auditda faqat maskalangan ko'rinish.
const GUEST_USERNAME_RE = /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/;
export function parseGuestTarget(raw: unknown): { username?: string; phone?: string } | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v || v.length > 40) return null;
  const tme = v.replace(/^(https?:\/\/)?t\.me\//i, '');
  if (GUEST_USERNAME_RE.test(tme)) return { username: tme.replace(/^@/, '') };
  const ph = v.replace(/[\s()-]/g, '');
  if (/^\+?\d{9,15}$/.test(ph)) {
    const digits = ph.replace(/^\+/, '');
    return { phone: `+${digits.length === 9 ? `998${digits}` : digits}` };
  }
  return null;
}

router.post('/telegram-account/guest-call', wrap(async (req, res) => {
  const dev = await developer(req);
  const body = isObj(req.body) ? req.body : {};
  const target = parseGuestTarget(body.target);
  if (!target) return res.status(400).json({ error: 'invalid', errors: ['target'] });
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';
  const lang: 'uz' | 'ru' = body.lang === 'ru' ? 'ru' : 'uz';
  const nowMs = Date.now();
  const last = lastTestAt.get(dev.userId) || 0;
  const wait = Math.ceil((last + TEST_CALL_COOLDOWN_SEC * 1000 - nowMs) / 1000);
  if (wait > 0) return res.status(429).json({ error: 'rate_limited', code: 'cooldown', retryAfterSec: wait, message: `Keyingi sinov qo'ng'irog'i ${wait} soniyadan keyin.` });
  const used = await peekRate(`aiv:tgtest:${dev.userId}`, TEST_CALL_WINDOW_MS, new Date(nowMs));
  if (used >= TEST_CALL_MAX) {
    const retryAfterSec = Math.max(1, Math.ceil((TEST_CALL_WINDOW_MS - (nowMs % TEST_CALL_WINDOW_MS)) / 1000));
    return res.status(429).json({ error: 'rate_limited', code: 'window', retryAfterSec, message: `10 daqiqada ${TEST_CALL_MAX} ta sinov qo'ng'irog'i — ${retryAfterSec} soniya kuting.` });
  }
  const r = await placeGuestCall({ developerId: dev.userId, target, name, lang });
  if (r.placed) {
    lastTestAt.set(dev.userId, Date.now());
    await hitRate(`aiv:tgtest:${dev.userId}`, TEST_CALL_MAX, TEST_CALL_WINDOW_MS).catch(() => undefined);
  }
  const who = target.username ? `@${target.username}` : maskPhone(target.phone || '');
  audit(req, dev, 'create', `AI Telegram: mehmon sinov qo'ng'irog'i — ${who} (${r.placed ? 'terildi' : r.errorCode})`, { entityId: r.placed ? r.sessionId : undefined });
  res.status(r.placed ? 202 : 409).json(r);
}));

// Mehmon qo'ng'irog'i natijasi (owner 2026-10-19: "terildi, lekin telefon jiringlamadi") — panel kuzatadi:
// holat, javob berildimi va Telegram/worker bergan sabab (privacy, peer_flood, network ...)
router.get('/telegram-account/guest-call/:sessionId', wrap(async (req, res) => {
  const dev = await developer(req);
  const id = String(req.params.sessionId || '');
  if (!isObjectIdString(id)) return res.status(400).json({ error: 'invalid' });
  const s: any = await AiCallSession.findOne({ _id: id, companyId: 'platform', employeeId: dev.userId })
    .select('status isActive answeredAt endReason errorCode durationSec').lean();
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({ status: s.status, active: !!s.isActive, answered: !!s.answeredAt, endReason: s.endReason || '', errorCode: s.errorCode || '', durationSec: s.durationSec || 0 });
}));

/** Faqat testlar uchun. */
export function __resetPlatformRoutesForTests(): void { attempts.clear(); lastTestAt.clear(); }

// ───────────── AI Telegram akkauntlari — umumiy hovuz (owner 2026-10-19) ─────────────
// Dasturchi hohlagancha Telegram profil qo'shadi (telefon → kod → 2FA, kodlar faqat brauzerda), har biriga ism beradi —
// AI shu akkauntdan gapirganda o'zini shu ism bilan tanishtiradi. Hamma firmalar uchun; qaysi bo'sh bo'lsa o'sha.

async function accountOf(req: Request, res: Response): Promise<any | null> {
  const acc = await getAccount(String(req.params.accountId || ''));
  if (!acc) { res.status(404).json({ error: 'account_not_found' }); return null; }
  return acc;
}

router.get('/tg-accounts', wrap(async (_req, res) => {
  res.json({ accounts: await listPoolAccounts(), workerConnected: !!getActiveWorker(), max: MAX_POOL_ACCOUNTS });
}));

router.post('/tg-accounts', wrap(async (req, res) => {
  const dev = await developer(req);
  const name = isObj(req.body) ? req.body.name : undefined;
  const r = await createPoolAccount(typeof name === 'string' ? name : undefined, dev.userId);
  if (!r.ok) return res.status(409).json({ error: r.error });
  audit(req, dev, 'create', "AI Telegram: akkaunt qo'shildi", { entityId: r.id });
  res.json({ ok: true, id: r.id, accounts: await listPoolAccounts() });
}));

router.patch('/tg-accounts/:accountId', wrap(async (req, res) => {
  const dev = await developer(req);
  const acc = await accountOf(req, res);
  if (!acc) return;
  const name = isObj(req.body) ? req.body.name : undefined;
  if (name !== undefined && typeof name !== 'string') return res.status(400).json({ error: 'invalid' });
  await setAccountName(String(acc._id), name);
  audit(req, dev, 'update', 'AI Telegram: akkaunt ismi o\'zgardi', { entityId: String(acc._id) });
  res.json({ ok: true, accounts: await listPoolAccounts() });
}));

router.post('/tg-accounts/:accountId/login/start', wrap(async (req, res) => {
  const dev = await developer(req);
  const acc = await accountOf(req, res);
  if (!acc) return;
  const account = String(acc._id);
  const phone = isObj(req.body) && typeof req.body.phone === 'string' ? req.body.phone.replace(/[\s()-]/g, '') : '';
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'phone_invalid' });
  if (await limited(res, `aiv:tglogin:start:${dev.userId}`, LOGIN_MAX * 2, LOGIN_WINDOW_MS)) return;
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  await syncAccountsToWorker();
  const loginAttemptId = crypto.randomUUID();
  attempts.set(loginAttemptId, { userId: dev.userId, expiresAt: Date.now() + ATTEMPT_TTL_MS });
  let r;
  try {
    r = await callWorker('auth.start', { loginAttemptId, phone, account });
  } catch (e) {
    attempts.delete(loginAttemptId);
    return rpcError(res, e);
  }
  const phoneMasked = maskPhone(phone);
  if (r.status === 'connected') {
    attempts.delete(loginAttemptId);
    await setAccountConnected(account, {}, dev.userId);
    return res.json({ status: 'connected', accounts: await listPoolAccounts() });
  }
  await setAccountLogin(account, { status: r.status, phoneMasked });
  audit(req, dev, 'update', 'AI Telegram: akkauntga kirish boshlandi', { entityId: account });
  res.json({ status: r.status, loginAttemptId, phoneMasked });
}));

router.post('/tg-accounts/:accountId/login/code', wrap(async (req, res) => {
  const dev = await developer(req);
  const acc = await accountOf(req, res);
  if (!acc) return;
  const account = String(acc._id);
  const body = isObj(req.body) ? req.body : {};
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'code_invalid' });
  const loginAttemptId = ownAttempt(body.loginAttemptId, dev.userId);
  if (!loginAttemptId) return res.status(410).json({ error: 'attempt_expired' });
  if (await limited(res, `aiv:tglogin:code:${dev.userId}`, LOGIN_MAX * 2, LOGIN_WINDOW_MS)) return;
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  let r;
  try {
    r = await callWorker('auth.code', { loginAttemptId, code, account });
  } catch (e) {
    return rpcError(res, e);
  }
  if (r.status === 'connected') {
    attempts.delete(loginAttemptId);
    await setAccountConnected(account, r, dev.userId);
    audit(req, dev, 'update', 'AI Telegram: akkaunt ulandi', { entityId: account });
    return res.json({ status: 'connected', accounts: await listPoolAccounts() });
  }
  await setAccountLogin(account, { status: 'awaiting_password' });
  res.json({ status: 'awaiting_password', loginAttemptId });
}));

router.post('/tg-accounts/:accountId/login/password', wrap(async (req, res) => {
  const dev = await developer(req);
  const acc = await accountOf(req, res);
  if (!acc) return;
  const account = String(acc._id);
  const body = isObj(req.body) ? req.body : {};
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 256) return res.status(400).json({ error: 'password_invalid' });
  const loginAttemptId = ownAttempt(body.loginAttemptId, dev.userId);
  if (!loginAttemptId) return res.status(410).json({ error: 'attempt_expired' });
  if (await limited(res, `aiv:tglogin:pw:${dev.userId}`, LOGIN_MAX * 2, LOGIN_WINDOW_MS)) return;
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  let r;
  try {
    r = await callWorker('auth.password', { loginAttemptId, password, account });
  } catch (e) {
    return rpcError(res, e);
  }
  attempts.delete(loginAttemptId);
  await setAccountConnected(account, r, dev.userId);
  audit(req, dev, 'update', 'AI Telegram: akkaunt ulandi', { entityId: account });
  res.json({ status: 'connected', accounts: await listPoolAccounts() });
}));

router.post('/tg-accounts/:accountId/logout', wrap(async (req, res) => {
  const dev = await developer(req);
  const acc = await accountOf(req, res);
  if (!acc) return;
  const account = String(acc._id);
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  try {
    await callWorker('auth.logout', { account });
  } catch (e) {
    if (!(e instanceof WorkerRpcFailure && e.code === 'unknown_account')) return rpcError(res, e);
  }
  await setAccountLogin(account, { status: 'disconnected' }, ['tgUserId', 'username', 'displayName', 'phoneMasked', 'connectedAt', 'lastError']);
  audit(req, dev, 'update', 'AI Telegram: akkauntdan chiqildi', { entityId: account });
  res.json({ ok: true, accounts: await listPoolAccounts() });
}));

// ── Profil: rasm, ism-familiya, bio, username (owner 2026-10-19) — bittalab yoki hammasiga birdan ──
const PROFILE_PHOTO_MAX_B64 = 3 * 1024 * 1024;   // ~2 MB rasm
type ProfilePatch = { firstName?: string; lastName?: string; about?: string; username?: string; photo?: string };
function profilePatch(body: unknown, allowUsername: boolean): ProfilePatch | null {
  if (!isObj(body)) return null;
  const out: ProfilePatch = {};
  for (const [k, max] of [['firstName', 64], ['lastName', 64], ['about', 70]] as const) {
    const v = body[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || v.length > max) return null;
    out[k] = v;
  }
  if (allowUsername && body.username !== undefined && body.username !== null) {
    if (typeof body.username !== 'string' || !/^@?([A-Za-z][A-Za-z0-9_]{3,31})?$/.test(body.username.trim())) return null;
    out.username = body.username.trim();
  }
  if (body.photo !== undefined && body.photo !== null) {
    if (typeof body.photo !== 'string' || body.photo.length > PROFILE_PHOTO_MAX_B64) return null;
    out.photo = body.photo;
  }
  return out;
}
const PROFILE_HTTP: Record<string, number> = { username_occupied: 409, username_invalid: 400, name_invalid: 400, about_too_long: 400, photo_invalid: 400 };

async function applyProfile(accountId: string, patch: ProfilePatch): Promise<{ ok: true } | { ok: false; error: string; retryAfterSec?: number }> {
  try {
    const r = await callWorker('profile.update', { account: accountId, ...patch });
    const set: Record<string, unknown> = {};
    if (r.displayName) set.displayName = r.displayName.slice(0, 80);
    if (patch.username !== undefined) set.username = r.username || undefined;
    // AI o'zini Telegram'dagi ism bilan tanishtiradi — ism o'zgarsa AI ismi ham
    const cleaned = cleanAiName(patch.firstName);
    if (cleaned) set.label = cleaned;
    if (Object.keys(set).length) await setAccountLogin(accountId, set);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof WorkerRpcFailure ? e.code : 'error', ...(e instanceof WorkerRpcFailure && e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {}) };
  }
}

router.get('/tg-accounts/:accountId/profile', wrap(async (req, res) => {
  const acc = await accountOf(req, res);
  if (!acc) return;
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  try {
    res.json(await callWorker('profile.get', { account: String(acc._id) }));
  } catch (e) {
    return rpcError(res, e);
  }
}));

router.post('/tg-accounts/:accountId/profile', wrap(async (req, res) => {
  const dev = await developer(req);
  const acc = await accountOf(req, res);
  if (!acc) return;
  const patch = profilePatch(req.body, true);
  if (!patch || !Object.keys(patch).length) return res.status(400).json({ error: 'invalid' });
  if (await limited(res, `aiv:tgprofile:${dev.userId}`, 60, LOGIN_WINDOW_MS)) return;
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  const r = await applyProfile(String(acc._id), patch);
  if (!r.ok) return res.status(PROFILE_HTTP[r.error] || RPC_HTTP[r.error] || 502).json({ error: r.error, ...(r.retryAfterSec ? { retryAfterSec: r.retryAfterSec } : {}) });
  audit(req, dev, 'update', `AI Telegram: profil o'zgardi (${Object.keys(patch).filter((k) => k !== 'photo').concat(patch.photo ? ['rasm'] : []).join(', ')})`, { entityId: String(acc._id) });
  res.json({ ok: true, accounts: await listPoolAccounts() });
}));

// Hammasiga birdan: rasm / familiya / bio (va xohlansa ism). Username birdan qo'yilmaydi — har akkauntda noyob bo'lishi shart.
router.post('/tg-accounts/profile-bulk', wrap(async (req, res) => {
  const dev = await developer(req);
  const body = isObj(req.body) ? req.body : {};
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string' && isObjectIdString(x)).slice(0, 50) : [];
  const patch = profilePatch(body, false);
  if (!ids.length || !patch || !Object.keys(patch).length) return res.status(400).json({ error: 'invalid' });
  if (await limited(res, `aiv:tgprofile:${dev.userId}`, 60, LOGIN_WINDOW_MS)) return;
  if (!getActiveWorker()) return res.status(503).json({ error: 'worker_offline' });
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    const acc = await getAccount(id);
    if (!acc) { results.push({ id, ok: false, error: 'account_not_found' }); continue; }
    const r = await applyProfile(id, patch);
    results.push(r.ok ? { id, ok: true } : { id, ok: false, error: r.error });
    if (!r.ok && r.error === 'flood_wait') break;   // Telegram cheklasa — qolganlariga urinmaymiz
  }
  audit(req, dev, 'update', `AI Telegram: ${results.filter((x) => x.ok).length} ta akkaunt profili birdan o'zgardi`, {});
  res.json({ ok: true, results, accounts: await listPoolAccounts() });
}));

router.delete('/tg-accounts/:accountId', wrap(async (req, res) => {
  const dev = await developer(req);
  const acc = await accountOf(req, res);
  if (!acc) return;
  const r = await removePoolAccount(String(acc._id));
  if (!r.ok) return res.status(r.error === 'busy' ? 409 : r.error === 'worker_offline' ? 503 : 502).json({ error: r.error });
  audit(req, dev, 'delete', "AI Telegram: akkaunt o'chirildi", { entityId: String(acc._id) });
  res.json({ ok: true, accounts: await listPoolAccounts() });
}));

export default router;
