import { Router, type Request, type Response, type NextFunction } from 'express';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiCallSession from '../../models/AiCallSession';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import AiReminder from '../../models/AiReminder';
import {
  CHANNEL_NAMES, type AiMePrefsDto, type AiMePrefsPatchReq, type AiReminderDto, type AivIncoming, type ChannelName,
} from '../contracts';
import { setCallConsent, setOptOut } from '../consent';
import { getCompanyAiState, getSettings, isAiActive } from '../settings';
import { isObjectIdString, newCorrelationId } from '../lib/ids';
import { isHHmm, localDate } from '../lib/zonedTime';
import { reminderAction, respondAttendance } from '../scheduler/api';
import { firstFireAt, type Recurrence } from '../scheduler/recurrence';
import { REMINDER_CHANNELS } from '../scheduler/reminders';

// O'zim: /api/ai-voice/me (bootstrap: requireAuth + blockDeveloper; workGate ALLOW ro'yxatida —
// smenasi yopiq ishchi ham o'z sozlamasi/eslatmasi/davomat javobiga yeta oladi).
// Hamma narsa FAQAT req.user.userId uchun: yo'l/tana orqali boshqa foydalanuvchi ID'si qabul qilinmaydi
// (eslatma maqsadi ham faqat o'zi). Rozilik/opt-out — consent.ts orqali (ConsentLog source:'me').
// GET / har doim ishlaydi (AI holatini ko'rsatadi); qolgan yo'llar AI faol bo'lmasa 403 ai_disabled.

const router = Router();

type Me = { userId: string; companyId: string; role: string };
const me = (req: Request): Me => ({ userId: String(req.user!.userId), companyId: String(req.user!.companyId || ''), role: String(req.user!.role) });

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch((e) => {
    console.error('[aiVoice/me] xato:', (e as Error).message);
    if (!res.headersSent) res.status(500).json({ error: 'internal' });
    else next(e);
  });
};

router.use((req, res, next) => {
  if (!req.user?.userId || !req.user.companyId) { res.status(403).json({ error: 'no_company' }); return; }
  next();
});

/** GET / dan tashqari hamma yo'l — AI shu firmada faol bo'lishi shart (AI_VOICE_ENABLED + sozlama + tarif). */
const requireActive = (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET' && (req.path === '/' || req.path === '')) { next(); return; }
  isAiActive(me(req).companyId)
    .then((ok) => (ok ? next() : res.status(403).json({ error: 'ai_disabled' })))
    .catch(next);
};
router.use(requireActive);

// ───────────── Sozlamalar ─────────────
const isChannel = (c: unknown): c is ChannelName => (CHANNEL_NAMES as unknown[]).includes(c);
const uniqChannels = (v: unknown): v is ChannelName[] => Array.isArray(v) && v.length <= CHANNEL_NAMES.length && v.every(isChannel) && new Set(v).size === v.length;

async function prefsDto(m: Me): Promise<AiMePrefsDto & { status: { aiActive: boolean; attendanceEnabled: boolean; telegramLinked: boolean; planHasFeature: boolean } }> {
  const c: any = await AiEmployeeContact.findOne({ companyId: m.companyId, employeeId: m.userId }).lean();
  const [aiActive, settings, state] = await Promise.all([isAiActive(m.companyId), getSettings(m.companyId), getCompanyAiState(m.companyId)]);
  return {
    ...(c?.languageOverride ? { languageOverride: c.languageOverride } : {}),
    ...(c?.channelPrefs?.order?.length ? { channelOrder: c.channelPrefs.order } : {}),
    disabledChannels: c?.channelPrefs?.disabled || [],
    callConsent: c?.telegram?.callConsent || 'none',
    optOut: { calls: !!c?.optOut?.calls, reminders: !!c?.optOut?.reminders, all: !!c?.optOut?.all },
    // Kalit doim bor (null — o'rnatilmagan): frontend shu bilan qo'llab-quvvatlanishini biladi
    quietHours: c?.quietHours?.from && c?.quietHours?.to ? { from: c.quietHours.from, to: c.quietHours.to } : null,
    status: {
      aiActive,
      attendanceEnabled: aiActive && settings.attendance.enabled,
      telegramLinked: !!c?.telegram?.tgUserId,
      planHasFeature: state.hasFeature,
    },
  };
}

router.get('/', wrap(async (req, res) => { res.json(await prefsDto(me(req))); }));

const PATCH_KEYS = new Set(['languageOverride', 'channelOrder', 'disabledChannels', 'callConsent', 'optOut', 'quietHours']);

router.patch('/', wrap(async (req, res) => {
  const m = me(req);
  const b = (req.body || {}) as AiMePrefsPatchReq & Record<string, unknown>;
  if (typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ error: 'bad_request' });
  const unknown = Object.keys(b).filter((k) => !PATCH_KEYS.has(k));
  if (unknown.length) return res.status(400).json({ error: 'bad_request', fields: unknown });
  const errors: string[] = [];
  if (b.languageOverride !== undefined && b.languageOverride !== null && b.languageOverride !== 'uz' && b.languageOverride !== 'ru') errors.push('languageOverride');
  if (b.channelOrder !== undefined && b.channelOrder !== null && !uniqChannels(b.channelOrder)) errors.push('channelOrder');
  if (b.disabledChannels !== undefined && !uniqChannels(b.disabledChannels)) errors.push('disabledChannels');
  if (b.callConsent !== undefined && b.callConsent !== 'granted' && b.callConsent !== 'revoked') errors.push('callConsent');
  if (b.optOut !== undefined) {
    const o = b.optOut as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o) || !Object.keys(o).length
      || Object.entries(o).some(([k, v]) => !['calls', 'reminders', 'all'].includes(k) || typeof v !== 'boolean')) errors.push('optOut');
  }
  if (b.quietHours !== undefined && b.quietHours !== null) {
    const q = b.quietHours as Record<string, unknown>;
    if (!q || typeof q !== 'object' || Array.isArray(q) || Object.keys(q).some((k) => k !== 'from' && k !== 'to')
      || !isHHmm(q.from) || !isHHmm(q.to) || q.from === q.to) errors.push('quietHours');
  }
  if (errors.length) return res.status(400).json({ error: 'bad_request', fields: errors });

  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  if (b.languageOverride === null) unset.languageOverride = ''; else if (b.languageOverride) set.languageOverride = b.languageOverride;
  if (b.channelOrder === null) unset['channelPrefs.order'] = ''; else if (b.channelOrder) set['channelPrefs.order'] = b.channelOrder;
  if (b.disabledChannels) set['channelPrefs.disabled'] = b.disabledChannels;
  if (b.quietHours === null) unset.quietHours = ''; else if (b.quietHours) set.quietHours = { from: b.quietHours.from, to: b.quietHours.to };
  if (Object.keys(set).length || Object.keys(unset).length) {
    await AiEmployeeContact.updateOne(
      { companyId: m.companyId, employeeId: m.userId },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}), $setOnInsert: { companyId: m.companyId, employeeId: m.userId } },
      { upsert: true },
    );
  }
  // Rozilik va opt-out — FAQAT o'zi (actor === employee), ConsentLog bilan
  if (b.callConsent) {
    const r = await setCallConsent({ companyId: m.companyId, employeeId: m.userId, actorUserId: m.userId, value: b.callConsent, source: 'me', ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) });
    if (!r.ok) return res.status(r.code === 'tg_conflict' ? 409 : 400).json({ error: r.code });
  }
  if (b.optOut) {
    const r = await setOptOut({ companyId: m.companyId, employeeId: m.userId, actorUserId: m.userId, source: 'me', ...b.optOut });
    if (!r.ok) return res.status(400).json({ error: r.code });
  }
  res.json(await prefsDto(m));
}));

// ───────────── Eslatmalar ─────────────
const FREQS = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];

function toDto(r: any): AiReminderDto {
  return {
    id: String(r._id), text: r.text, targetUserId: r.targetUserId, ownerId: r.ownerId,
    dueAt: new Date(r.dueAt).toISOString(), ...(r.nextFireAt ? { nextFireAt: new Date(r.nextFireAt).toISOString() } : {}),
    recurrence: {
      freq: r.recurrence?.freq || 'none', interval: r.recurrence?.interval || 1, byWeekday: r.recurrence?.byWeekday || [],
      ...(r.recurrence?.until ? { until: new Date(r.recurrence.until).toISOString() } : {}),
      ...(r.recurrence?.count ? { count: r.recurrence.count } : {}),
    },
    status: r.status, channels: r.channels || [],
  };
}

const parseDate = (v: unknown): Date | null => {
  if (typeof v !== 'string' || v.length > 40) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Takrorlanishni tekshiradi; xato bo'lsa string. */
function parseRecurrence(v: unknown): Recurrence | string {
  if (v === undefined || v === null) return { freq: 'none', interval: 1, byWeekday: [] };
  if (typeof v !== 'object' || Array.isArray(v)) return 'recurrence';
  const o = v as Record<string, unknown>;
  const freq = o.freq === undefined ? 'none' : o.freq;
  if (!FREQS.includes(String(freq))) return 'recurrence.freq';
  const interval = o.interval === undefined ? 1 : o.interval;
  if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1 || interval > 365) return 'recurrence.interval';
  const byWeekday = o.byWeekday === undefined ? [] : o.byWeekday;
  if (!Array.isArray(byWeekday) || byWeekday.length > 7 || new Set(byWeekday).size !== byWeekday.length
    || !byWeekday.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return 'recurrence.byWeekday';
  let until: Date | null = null;
  if (o.until !== undefined && o.until !== null) { until = parseDate(o.until); if (!until) return 'recurrence.until'; }
  let count: number | null = null;
  if (o.count !== undefined && o.count !== null) {
    if (typeof o.count !== 'number' || !Number.isInteger(o.count) || o.count < 1 || o.count > 1000) return 'recurrence.count';
    count = o.count;
  }
  return { freq: freq as Recurrence['freq'], interval, byWeekday: byWeekday as number[], until, count };
}

const parseChannels = (v: unknown): ChannelName[] | null =>
  v === undefined ? [] : (uniqChannels(v) && v.every((c) => REMINDER_CHANNELS.includes(c)) ? v : null);

router.get('/reminders', wrap(async (req, res) => {
  const m = me(req);
  const status = typeof req.query.status === 'string' ? req.query.status : 'active';
  const f: Record<string, unknown> = { companyId: m.companyId, $or: [{ ownerId: m.userId }, { targetUserId: m.userId }] };
  if (status !== 'all') {
    if (!['active', 'done', 'cancelled', 'failed', 'missed'].includes(status)) return res.status(400).json({ error: 'bad_request' });
    f.status = status;
  }
  const rows: any[] = await AiReminder.find(f).sort({ nextFireAt: 1, dueAt: 1 }).limit(200).lean();
  // canCancel: faqat o'zi yaratganini bekor qila oladi (rahbar qo'ygan eslatmani xodim o'chirmaydi — DELETE 404)
  res.json({ reminders: rows.map((r) => ({ ...toDto(r), canCancel: String(r.ownerId) === m.userId })) });
}));

router.post('/reminders', wrap(async (req, res) => {
  const m = me(req);
  const b = (req.body || {}) as Record<string, unknown>;
  // Faqat o'zi uchun: boshqa maqsad ID'si — 403 (boshqalarga eslatma — P2 tool, RBAC bilan)
  if (b.targetUserId !== undefined && String(b.targetUserId) !== m.userId) return res.status(403).json({ error: 'forbidden' });
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text || text.length > 500) return res.status(400).json({ error: 'bad_request', fields: ['text'] });
  const dueAt = parseDate(b.dueAt);
  if (!dueAt) return res.status(400).json({ error: 'bad_request', fields: ['dueAt'] });
  const rec = parseRecurrence(b.recurrence);
  if (typeof rec === 'string') return res.status(400).json({ error: 'bad_request', fields: [rec] });
  const channels = parseChannels(b.channels);
  if (!channels) return res.status(400).json({ error: 'bad_request', fields: ['channels'] });
  const idem = b.idempotencyKey;
  if (idem !== undefined && (typeof idem !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(idem))) return res.status(400).json({ error: 'bad_request', fields: ['idempotencyKey'] });
  const now = new Date();
  const nextFireAt = firstFireAt(rec, dueAt, new Date(now.getTime() - 60_000));
  if (!nextFireAt) return res.status(400).json({ error: 'bad_request', fields: ['dueAt'], message: "vaqt o'tib ketgan" });

  if (idem) {
    const ex: any = await AiReminder.findOne({ companyId: m.companyId, ownerId: m.userId, idempotencyKey: idem }).lean();
    if (ex) return res.status(200).json(toDto(ex));
  }
  const settings = await getSettings(m.companyId);
  const active = await AiReminder.countDocuments({ companyId: m.companyId, targetUserId: m.userId, status: 'active' });
  if (active >= settings.reminders.maxActivePerUser) return res.status(429).json({ error: 'limit', max: settings.reminders.maxActivePerUser });
  try {
    const r = await AiReminder.create({
      companyId: m.companyId, ownerId: m.userId, targetUserId: m.userId, text, timezone: 'Asia/Tashkent', dueAt,
      recurrence: { freq: rec.freq, interval: rec.interval || 1, byWeekday: rec.byWeekday || [], ...(rec.until ? { until: rec.until } : {}), ...(rec.count ? { count: rec.count } : {}) },
      nextFireAt, status: 'active', channels, createdVia: 'ui', ...(idem ? { idempotencyKey: idem } : {}), correlationId: newCorrelationId(),
    });
    res.status(201).json(toDto(r.toObject()));
  } catch (e: any) {
    if (e?.code === 11000 && idem) {
      const ex: any = await AiReminder.findOne({ companyId: m.companyId, ownerId: m.userId, idempotencyKey: idem }).lean();
      if (ex) return res.status(200).json(toDto(ex));
    }
    throw e;
  }
}));

/** O'z (ownerId) eslatmasi; boshqanikini o'zgartirib/o'chirib bo'lmaydi — 404 (mavjudligi oshkor qilinmaydi). */
async function ownReminder(m: Me, id: string): Promise<any | null> {
  if (!isObjectIdString(id)) return null;
  return AiReminder.findOne({ _id: id, companyId: m.companyId, ownerId: m.userId }).lean();
}

router.patch('/reminders/:id', wrap(async (req, res) => {
  const m = me(req);
  const r = await ownReminder(m, String(req.params.id));
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.status !== 'active') return res.status(409).json({ error: 'not_active' });
  const b = (req.body || {}) as Record<string, unknown>;
  const allowed = new Set(['text', 'dueAt', 'recurrence', 'channels']);
  const unknown = Object.keys(b).filter((k) => !allowed.has(k));
  if (unknown.length) return res.status(400).json({ error: 'bad_request', fields: unknown });
  const set: Record<string, unknown> = {};
  if (b.text !== undefined) {
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!text || text.length > 500) return res.status(400).json({ error: 'bad_request', fields: ['text'] });
    set.text = text;
  }
  if (b.channels !== undefined) {
    const ch = parseChannels(b.channels);
    if (!ch) return res.status(400).json({ error: 'bad_request', fields: ['channels'] });
    set.channels = ch;
  }
  if (b.dueAt !== undefined || b.recurrence !== undefined) {
    const dueAt = b.dueAt !== undefined ? parseDate(b.dueAt) : new Date(r.dueAt);
    if (!dueAt) return res.status(400).json({ error: 'bad_request', fields: ['dueAt'] });
    const rec = b.recurrence !== undefined ? parseRecurrence(b.recurrence) : parseRecurrence({ ...r.recurrence, until: r.recurrence?.until ? new Date(r.recurrence.until).toISOString() : undefined });
    if (typeof rec === 'string') return res.status(400).json({ error: 'bad_request', fields: [rec] });
    const next = firstFireAt(rec, dueAt, new Date(Date.now() - 60_000));
    if (!next) return res.status(400).json({ error: 'bad_request', fields: ['dueAt'], message: "vaqt o'tib ketgan" });
    set.dueAt = dueAt;
    set.recurrence = { freq: rec.freq, interval: rec.interval || 1, byWeekday: rec.byWeekday || [], ...(rec.until ? { until: rec.until } : {}), ...(rec.count ? { count: rec.count } : {}) };
    set.nextFireAt = next;
  }
  if (!Object.keys(set).length) return res.json(toDto(r));
  const upd: any = await AiReminder.findOneAndUpdate({ _id: r._id, ownerId: m.userId, status: 'active', updatedAt: r.updatedAt }, { $set: set }, { returnDocument: 'after' }).lean();
  if (!upd) return res.status(409).json({ error: 'conflict' });
  res.json(toDto(upd));
}));

router.delete('/reminders/:id', wrap(async (req, res) => {
  const m = me(req);
  const r = await ownReminder(m, String(req.params.id));
  if (!r) return res.status(404).json({ error: 'not_found' });
  await AiReminder.updateOne({ _id: r._id, ownerId: m.userId, status: { $in: ['active', 'failed'] } }, { $set: { status: 'cancelled', nextFireAt: null } });
  res.json({ ok: true });
}));

/** Veb "Bajarildi"/"Kechiktirish" — bot tugmalarining ekvivalenti (faqat maqsad foydalanuvchi). */
router.post('/reminders/:id/action', wrap(async (req, res) => {
  const m = me(req);
  const action = req.body?.action;
  if (action !== 'done' && action !== 'snooze') return res.status(400).json({ error: 'bad_request' });
  const snoozeMin = req.body?.snoozeMin;
  if (snoozeMin !== undefined && (typeof snoozeMin !== 'number' || !Number.isInteger(snoozeMin) || snoozeMin < 1 || snoozeMin > 120)) {
    return res.status(400).json({ error: 'bad_request', fields: ['snoozeMin'] });
  }
  const r = await reminderAction({ companyId: m.companyId, userId: m.userId, reminderId: String(req.params.id), action, snoozeMin, via: 'web' });
  if (!r.ok) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, status: r.status, already: r.already, ...(r.nextFireAt ? { nextFireAt: r.nextFireAt.toISOString() } : {}) });
}));

// ───────────── Davomat ─────────────
router.get('/attendance/today', wrap(async (req, res) => {
  const m = me(req);
  const date = localDate();
  const rows: any[] = await AiAttendanceConfirmation.find({ companyId: m.companyId, employeeId: m.userId, date })
    .select('shiftId date status voiceAnswer buttonAnswer checkInAt finalizedAt').lean();
  res.json({
    date,
    confirmations: rows.map((r) => ({
      confirmationId: String(r._id), shiftId: r.shiftId, date: r.date, status: r.status,
      voiceAnswer: r.voiceAnswer, buttonAnswer: r.buttonAnswer,
      ...(r.checkInAt ? { checkInAt: new Date(r.checkInAt).toISOString() } : {}),
      canRespond: !r.finalizedAt && r.buttonAnswer === 'none' && ['pending', 'no_answer', 'call_failed'].includes(r.status),
    })),
  });
}));

router.post('/attendance/:id/respond', wrap(async (req, res) => {
  const m = me(req);
  const answer = req.body?.answer;
  if (!['confirm', 'late', 'decline'].includes(answer)) return res.status(400).json({ error: 'bad_request' });
  const r = await respondAttendance({ companyId: m.companyId, employeeId: m.userId, confirmationId: String(req.params.id), answer, via: 'web' });
  if (!r.ok) return res.status(r.code === 'not_found' ? 404 : 409).json({ error: r.code });
  res.json(r);
}));

/** Muddati o'tmagan AI qo'ng'irog'i (bildirishnomadan ilovani ochganlar uchun). */
router.get('/pending-call', wrap(async (req, res) => {
  const m = me(req);
  const s: any = await AiCallSession.findOne({ employeeId: m.userId, companyId: m.companyId, isActive: true, channel: 'inapp_call', status: { $in: ['queued', 'dialing', 'ringing'] } })
    .select('correlationId purpose limits ringingAt startedAt createdAt').lean();
  if (!s) return res.json({ call: null });
  const from = new Date(s.ringingAt || s.startedAt || s.createdAt).getTime();
  const expiresAt = new Date(from + (s.limits?.ringTimeoutSec || 45) * 1000);
  if (expiresAt.getTime() <= Date.now()) return res.json({ call: null });
  const st = await getCompanyAiState(m.companyId);
  const call: AivIncoming = { sessionId: String(s._id), correlationId: s.correlationId, purpose: s.purpose, expiresAt: expiresAt.toISOString(), ...(st.name ? { companyName: st.name.slice(0, 60) } : {}) };
  res.json({ call });
}));

export default router;
