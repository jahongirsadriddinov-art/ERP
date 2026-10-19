import AiCallSession, { type AiCallStatus } from '../models/AiCallSession';
import AiCallEvent, { type IAiCallEvent } from '../models/AiCallEvent';
import { aiConfig } from './config';
import { invalidateActor } from './actor';
import { redact, redactText } from './lib/redact';
import { getSettings, invalidateSettings } from './settings';
import AiJob from '../models/AiJob';

/**
 * Qo'ng'iroq voqeasini yozish — data DOIM redact()'dan o'tadi, expiresAt firma sozlamasidan
 * (privacy.transcriptRetentionDays). Takroriy (sessionId, seq) — jim e'tiborsiz (qayta urinish xavfsiz).
 */
export async function recordCallEvent(e: {
  companyId: string; sessionId: string; correlationId: string; seq: number; type: IAiCallEvent['type']; data?: unknown; at?: Date;
}): Promise<boolean> {
  const at = e.at || new Date();
  const s = await getSettings(e.companyId);
  try {
    await AiCallEvent.create({
      companyId: e.companyId, sessionId: e.sessionId, correlationId: e.correlationId, seq: e.seq, type: e.type, at,
      data: redact(e.data), expiresAt: new Date(at.getTime() + s.privacy.transcriptRetentionDays * 86_400_000),
    });
    return true;
  } catch (err: any) {
    if (err?.code === 11000) return false;
    throw err;
  }
}

// Faol qo'ng'iroq sessiyalari bo'yicha umumiy yordamchilar. Parallellik HISOBLAGICH bilan emas,
// isActive:true sessiyalarni sanash orqali (review B12) — jarayon qulasa ham "oqmaydi";
// osilib qolganlarini queue/sessionSweep.ts tozalaydi (C4).

export interface EndedSession {
  sessionId: string;
  correlationId: string;
  companyId: string;
  employeeId: string;
  channel: string;
  purpose: string;
  confirmationId?: string;
  attemptKey?: string;
  status: AiCallStatus;
  reason: string;
}

type EndedListener = (sessions: EndedSession[]) => void | Promise<void>;
const listeners = new Set<EndedListener>();

/** Sessiya tashqaridan yakunlanganda (sweep, blok, bekor qilish) — socket/worker/scheduler xabardor bo'ladi. */
export function onSessionsEnded(cb: EndedListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function emitSessionsEnded(list: EndedSession[]): Promise<void> {
  if (!list.length) return;
  for (const cb of listeners) {
    try { await cb(list); } catch (e) { console.error('[aiVoice] onSessionsEnded tinglovchisi xatosi:', (e as Error).message); }
  }
}

export async function countActiveSessions(filter: { companyId?: string; channel?: 'telegram_call' | 'inapp_call' } = {}): Promise<number> {
  const q: Record<string, unknown> = { isActive: true };
  if (filter.companyId) q.companyId = filter.companyId;
  if (filter.channel) q.channel = filter.channel;
  return AiCallSession.countDocuments(q);
}

/** Yangi Live sessiyaga sig'im bormi: platforma (AI_LIVE_MAX_CONCURRENT) va firma (companyConcurrency). */
export async function liveCapacity(companyId: string, companyConcurrency: number): Promise<{ ok: boolean; reason?: 'platform_cap' | 'company_cap' }> {
  if ((await countActiveSessions()) >= aiConfig.liveMaxConcurrent) return { ok: false, reason: 'platform_cap' };
  if ((await countActiveSessions({ companyId })) >= companyConcurrency) return { ok: false, reason: 'company_cap' };
  return { ok: true };
}

/** Telegram akkaunti bo'yicha sig'im (A1: odatda 1). */
export async function telegramCapacity(): Promise<boolean> {
  return (await countActiveSessions({ channel: 'telegram_call' })) < aiConfig.tgMaxConcurrent;
}

/** Sessiya tirikligini bildiradi (har ~15 s) — sweeper uni osilgan deb hisoblamasligi uchun. */
export async function touchSession(sessionId: string): Promise<boolean> {
  const r = await AiCallSession.updateOne({ _id: sessionId, isActive: true }, { $set: { updatedAt: new Date() } });
  return r.matchedCount === 1;
}

/**
 * Filtrga mos faol sessiyalarni yakunlaydi (har biri shartli — poyga xavfsiz) va tinglovchilarni chaqiradi.
 * onlyIfUnchanged=true — oraliqda yangilangan (tirik) sessiyaga tegmaydi (sweep uchun);
 * false — baribir yakunlaydi (blok/bekor qilish — kuchga kirishi shart).
 */
export async function endActiveSessions(
  filter: Record<string, unknown>,
  status: AiCallStatus,
  reason: string,
  now: Date = new Date(),
  opts: { onlyIfUnchanged?: boolean; extraSet?: Record<string, unknown> } = {},
): Promise<EndedSession[]> {
  const onlyIfUnchanged = opts.onlyIfUnchanged ?? true;
  const docs: any[] = await AiCallSession.find({ ...filter, isActive: true })
    .select('correlationId companyId employeeId channel purpose confirmationId attemptKey startedAt answeredAt updatedAt').limit(500).lean();
  const ended: EndedSession[] = [];
  for (const d of docs) {
    const set: Record<string, unknown> = { ...(opts.extraSet || {}), isActive: false, status, endedAt: now, endReason: reason };
    if (d.answeredAt) set.durationSec = Math.max(0, Math.round((now.getTime() - new Date(d.answeredAt).getTime()) / 1000));
    const cond: Record<string, unknown> = { _id: d._id, isActive: true };
    if (onlyIfUnchanged) cond.updatedAt = d.updatedAt;
    const r = await AiCallSession.updateOne(cond, { $set: set });
    if (r.modifiedCount !== 1) continue; // shu orada boshqa jarayon yakunladi yoki yangiladi
    ended.push({
      sessionId: String(d._id), correlationId: d.correlationId, companyId: d.companyId, employeeId: d.employeeId,
      channel: d.channel, purpose: d.purpose, confirmationId: d.confirmationId, attemptKey: d.attemptKey, status, reason,
    });
  }
  await emitSessionsEnded(ended);
  return ended;
}

/**
 * Bitta sessiyaning ODDIY yakuni (P5 in-app, P6 Telegram call.state terminal): atomik (isActive:true
 * bo'lsagina) va onSessionsEnded tinglovchilari chaqiriladi — P3 runner keyingi qadamni shu orqali qo'yadi (C1).
 * Allaqachon yakunlangan bo'lsa null (takroriy voqea — no-op).
 */
export async function finishSession(
  sessionId: string,
  status: Exclude<AiCallStatus, 'queued' | 'dialing' | 'ringing' | 'connected'>,
  reason: string,
  extra: { errorCode?: string; summary?: string; usage?: Partial<Record<'audioInSec' | 'audioOutSec' | 'tokensIn' | 'tokensOut' | 'costUsdMicros', number>>; now?: Date } = {},
): Promise<EndedSession | null> {
  if (!/^[0-9a-fA-F]{24}$/.test(String(sessionId || ''))) return null;
  const extraSet: Record<string, unknown> = {};
  if (extra.errorCode) extraSet.errorCode = String(extra.errorCode).slice(0, 120);
  if (extra.summary) extraSet.summary = redactText(String(extra.summary)).slice(0, 2000);
  for (const [k, v] of Object.entries(extra.usage || {})) if (typeof v === 'number' && Number.isFinite(v)) extraSet[`usage.${k}`] = v;
  const ended = await endActiveSessions({ _id: sessionId }, status, String(reason).slice(0, 120), extra.now || new Date(), { onlyIfUnchanged: false, extraSet });
  return ended[0] || null;
}

/**
 * Foydalanuvchi bloklanganda / sessiyasi bekor qilinganda (routes/sessions.ts, users.ts setBlocked):
 * aktyor keshi tozalanadi va uning barcha faol AI sessiyalari yakunlanadi (B2).
 */
export async function aiEndSessionsForUser(userId: string, reason = 'revoked'): Promise<number> {
  invalidateActor(String(userId));
  try {
    const ended = await endActiveSessions({ employeeId: String(userId) }, 'interrupted', reason, new Date(), { onlyIfUnchanged: false });
    return ended.length;
  } catch (e) {
    console.error('[aiVoice] aiEndSessionsForUser xatosi:', (e as Error).message);
    return 0;
  }
}

/**
 * Xodim yoki butun firma o'chirilganda / to'xtatilganda (owner 2026-10-19: "o'chirilgan odam AI'dan hech narsadan
 * darhol foydalana olmasin"): aktyor/sozlama keshi tozalanadi, faol AI qo'ng'iroqlari yakunlanadi va navbatdagi
 * AI ishlari (qayta qo'ng'iroq, xodimga qo'ng'iroq, eslatma qo'ng'irog'i) bekor qilinadi.
 */
export async function aiRevokeAccess(p: { userIds?: string[]; companyId?: string; reason?: string }): Promise<void> {
  const ids = (p.userIds || []).map(String).filter(Boolean);
  for (const id of ids) invalidateActor(id);
  if (p.companyId) invalidateSettings(String(p.companyId));
  const or: Record<string, unknown>[] = [];
  if (ids.length) or.push({ employeeId: { $in: ids } });
  if (p.companyId) or.push({ companyId: String(p.companyId) });
  if (!or.length) return;
  const reason = String(p.reason || 'revoked').slice(0, 60);
  try {
    await endActiveSessions({ $or: or }, 'interrupted', reason, new Date(), { onlyIfUnchanged: false });
  } catch (e) {
    console.error('[aiVoice] aiRevokeAccess sessiyalar:', (e as Error).message);
  }
  await AiJob.updateMany({ $or: or, status: 'queued' }, { $set: { status: 'cancelled' } }).catch(() => undefined);
}
