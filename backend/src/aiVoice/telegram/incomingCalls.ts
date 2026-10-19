import AiChannelConnection from '../../models/AiChannelConnection';
import { resolveAvatarLook } from '../persona';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import User from '../../models/User';
import { WORKER_ROLES, isOnShift } from '../../middleware/workGate';
import { logAudit } from '../../services/audit';
import { checkActor } from '../actor';
import { aiConfig, INSTANCE_ID } from '../config';
import type { IncomingCallAck, IncomingCallRequest, WorkerEvent } from '../contracts';
import { hitRate } from '../lib/mongoRateLimit';
import { ensurePlatformConnection } from '../lib/workerLease';
import { telegramCapacity } from '../sessions';
import { getSettings, isAiActive } from '../settings';
import { getVoiceSessionManager, resolveVoiceLang } from '../voice/sessionManager';
import { getCallConsent } from '../consent';
import { checkUserCallLimit } from '../voice/callLimits';
import { reapStaleTelegramSessions, registerBridge, TelegramTransport } from './callBridge';
import { findEmployeeByTgId } from './tgLink';
import { callWorker } from './workerRpc';
import { setIncomingCallHandler, workerConnectedHere, workerHub } from './workerNamespace';

// "Ochiq muloqot" (owner so'rovi): AI Telegram akkauntiga kiruvchi shaxsiy qo'ng'iroqlar.
//  • platforma sozlamasi (AiChannelConnection.openConversation), standart O'CHIQ — o'chiq bo'lsa worker
//    qo'ng'iroqni o'zi darhol rad etadi (A3, o'zgarmagan);
//  • yoqilgan bo'lsa worker {tgUserId} so'raydi: Telegram id ERP bot bog'lanishidan (yoki eski kontaktdan) topilgan,
//    samarali rozilikka ega (consent.getCallConsent), bloklanmagan, firmasida AI yoqilgan xodim qabul qilinadi;
//    notanish — rad (busy);
//  • qabulda — in-app bilan bir xil user-initiated ovozli sessiya (xodim aktyor, tool/RBAC/transkript);
//  • har qabul/rad AuditLog'ga (entity 'ai_telegram_incoming'); notanish raqamdan spam — soatiga 10 ta;
//  • cheklovlar — voice/callLimits (dasturchi/direktor/o'rinbosar — limitsiz; ishchilar — qisqa tanaffus).

const PLATFORM_TG = { scope: 'platform' as const, companyId: null, type: 'telegram_user' as const };
const TG_ID_RE = /^\d{1,20}$/;
/** Worker accept → confirm kutadi (calls.py INCOMING_ACCEPT_TIMEOUT_S = 20) + zaxira. */
const INCOMING_RING_FALLBACK_SEC = 40;
const AUDIT_PER_CALLER_HOUR = 10;

export type IncomingDecision = IncomingCallAck & { companyId?: string; employeeId?: string };

const maskTg = (id: string) => (id.length > 4 ? `…${id.slice(-4)}` : '…');

export async function getOpenConversation(): Promise<boolean> {
  const c: any = await AiChannelConnection.findOne(PLATFORM_TG).select('openConversation').lean();
  return c?.openConversation === true;
}

/** Holatni workerga yuborish (worker yo'q bo'lsa — keyingi 'up'da). true — worker tasdiqladi. */
export async function pushOpenConversation(open?: boolean): Promise<boolean> {
  if (!workerConnectedHere()) return false;
  try {
    const v = typeof open === 'boolean' ? open : await getOpenConversation();
    await callWorker('incoming.config', { open: v });
    return true;
  } catch {
    return false;
  }
}

export async function setOpenConversation(enabled: boolean, by: string, now: Date = new Date()): Promise<boolean> {
  await ensurePlatformConnection();
  await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { openConversation: enabled, openConversationBy: by, openConversationAt: now } });
  return pushOpenConversation(enabled);
}

async function auditIncoming(tgUserId: string, d: IncomingDecision, actor?: { name: string; role: string }): Promise<void> {
  const accepted = d.accept === true;
  await logAudit({
    userId: d.employeeId || 'telegram',
    userName: actor?.name || (d.employeeId ? 'Xodim' : `Telegram ${maskTg(tgUserId)}`),
    userRole: actor?.role || 'unknown',
    action: 'create',
    entity: 'ai_telegram_incoming',
    entityId: accepted ? d.sessionId : undefined,
    companyId: d.companyId,
    description: accepted
      ? "AI Telegram: kiruvchi qo'ng'iroq qabul qilindi (Ochiq muloqot)"
      : `AI Telegram: kiruvchi qo'ng'iroq rad etildi — ${(d as { reason: string }).reason}`,
  }).catch(() => undefined);
}

/** Video avatar dasturchi panelida yoqilganmi (standart — ha). O'chiq bo'lsa workerga "off" boradi. 30 s kesh. */
let avatarCache: { at: number; on: boolean } | null = null;
export async function avatarEnabled(): Promise<boolean> {
  if (avatarCache && Date.now() - avatarCache.at < 30_000) return avatarCache.on;
  const c: any = await AiChannelConnection.findOne(PLATFORM_TG).select('avatarEnabled').lean().catch(() => null);
  avatarCache = { at: Date.now(), on: c?.avatarEnabled !== false };
  return avatarCache.on;
}
export async function setAvatarEnabled(enabled: boolean): Promise<void> {
  await ensurePlatformConnection();
  await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { avatarEnabled: enabled } });
  avatarCache = { at: Date.now(), on: enabled };
}
/** Workerga yuboriladigan avatar qiymati: o'chiq bo'lsa "off", aks holda firma tanlagan ko'rinish. */
export async function avatarParam(look: string | undefined): Promise<string | undefined> {
  return (await avatarEnabled()) ? look : 'off';
}

/** Qaror (testlar to'g'ridan-to'g'ri chaqiradi). Sessiya faqat qabulda yaratiladi. */
export async function decideIncomingCall(req: IncomingCallRequest, now: Date = new Date()): Promise<IncomingDecision> {
  const tgUserId = String(req?.tgUserId || '');
  if (!TG_ID_RE.test(tgUserId)) return { accept: false, reason: 'bad_request' };
  const rl = await hitRate(`aiv:tgin:${tgUserId}`, AUDIT_PER_CALLER_HOUR, 3600_000, now);
  let actor: { name: string; role: string } | undefined;
  const decide = async (): Promise<IncomingDecision> => {
    if (!aiConfig.enabled) return { accept: false, reason: 'disabled' };
    if (!(await getOpenConversation())) return { accept: false, reason: 'closed' };
    // Owner 2026-10-16: Telegram id ERP bot bog'lanishidan ham olinadi (kod shart emas; darhol backfill)
    const who = await findEmployeeByTgId(tgUserId);
    if (!who) {
      // Spam himoyasi faqat notanish raqamlarga (bog'langan xodimlarga rol cheklovlari — callLimits)
      if (!rl.allowed) return { accept: false, reason: 'rate_limited' };
      // Dasturchi akkaunti (firmasiz) — ovozli sessiya firma konteksti talab qiladi; aniq sabab bilan rad
      const dev = await User.exists({ role: 'dasturchi', $or: [{ telegramUserId: tgUserId }, { telegramChatId: tgUserId }] });
      return { accept: false, reason: dev ? 'developer_unsupported' : 'unknown_caller' };
    }
    const { companyId, employeeId } = who;
    const base = { companyId, employeeId };
    const ct: any = await AiEmployeeContact.findOne({ companyId, employeeId }).select('telegram.callConsent optOut').lean();
    const consent = await getCallConsent(companyId, employeeId, { incoming: true, contact: ct });
    if (!consent.allowed) return { ...base, accept: false, reason: consent.reason || 'no_consent' };
    const ac = await checkActor(employeeId, companyId);
    if (!ac.ok) return { ...base, accept: false, reason: ac.code === 'blocked' ? 'blocked' : `denied_${ac.code}` };
    actor = { name: ac.actor.name, role: ac.actor.role };
    if (!(await isAiActive(companyId))) return { ...base, accept: false, reason: 'ai_disabled' };
    // A1: bir vaqtda 1 ta Telegram qo'ng'irog'i. Worker bo'sh desa — tugagan, lekin bazada "faol" qolgan
    // sessiyalar darhol yopiladi (owner 2026-10-17: keyingi qo'ng'iroq 'busy' bo'lmasin)
    if (req.workerBusy === true) return { ...base, accept: false, reason: 'busy' };
    if (!(await telegramCapacity())) {
      if (workerConnectedHere()) await reapStaleTelegramSessions(now);
      if (!(await telegramCapacity())) return { ...base, accept: false, reason: 'busy' };
    }
    if (!workerConnectedHere()) return { ...base, accept: false, reason: 'worker_not_here' };
    const settings = await getSettings(companyId);
    // In-app qo'ng'iroq bilan bir xil cheklovlar: ishchi rollar smenadan tashqarida rad
    if (WORKER_ROLES.includes(ac.actor.role) && !settings.tools.allowOffShiftAssistant && !(await isOnShift(employeeId))) {
      return { ...base, accept: false, reason: 'off_shift' };
    }
    // Owner 2026-10-17: rahbarlarga limit yo'q, ishchilarga qisqa tanaffus; ulanmagan urinishlar sanalmaydi
    const lim = await checkUserCallLimit({ companyId, employeeId, role: ac.actor.role, settings, now });
    if (!lim.ok) return { ...base, accept: false, reason: lim.code === 'cooldown' ? `limit_cooldown_${lim.retryAfterSec}s` : `limit_hourly_${lim.retryAfterSec}s` };

    const lang = await resolveVoiceLang(companyId, employeeId, settings);
    const maxDurationSec = Math.min(600, Math.max(30, Math.round(Number(settings.calls.assistantMaxDurationSec) || 300)));
    const transport = new TelegramTransport();
    const started = await getVoiceSessionManager().start({
      companyId, employeeId, purpose: 'assistant', channel: 'telegram_call', lang, ptt: false, transport,
      userInitiated: true, workerInstanceId: INSTANCE_ID, ringTimeoutSec: INCOMING_RING_FALLBACK_SEC, maxDurationSec,
    });
    if (!started.ok) return { ...base, accept: false, reason: started.reason };
    const h = started.handle;
    transport.bind(h.sessionId);
    registerBridge({ sessionId: h.sessionId, handle: h, employeeId, companyId });
    return { ...base, accept: true, sessionId: h.sessionId, maxDurationSec, avatar: await avatarParam(resolveAvatarLook(settings)) };
  };
  let d: IncomingDecision;
  try {
    d = await decide();
  } catch (e) {
    console.error("[aiVoice/telegram] kiruvchi qo'ng'iroq qarori xatosi:", (e as Error)?.name || 'Error');
    d = { accept: false, reason: 'error' };
  }
  // Spam: bitta raqamdan soatiga 10 tadan ortiq — audit yozilmaydi (rad baribir)
  if (rl.allowed) await auditIncoming(tgUserId, d, actor);
  return d;
}

/** Worker uchun javob (faqat ack maydonlari — firma/xodim id'lari workerga ketmaydi). */
async function handleIncoming(req: IncomingCallRequest): Promise<IncomingCallAck> {
  const d = await decideIncomingCall(req);
  return d.accept ? { accept: true, sessionId: d.sessionId, maxDurationSec: d.maxDurationSec, ...(d.avatar ? { avatar: d.avatar } : {}) } : { accept: false, reason: d.reason };
}

let initialized = false;

/** Worker ulanganda holatni yuborish, health'da farq bo'lsa tuzatish (idempotent). */
export function initIncomingCalls(): void {
  setIncomingCallHandler(handleIncoming);
  if (initialized) return;
  initialized = true;
  workerHub.on('up', () => { pushOpenConversation().catch(() => undefined); });
  workerHub.on('event', (ev: WorkerEvent) => {
    if (ev?.type !== 'health') return;
    // Worker'da qo'ng'iroq yo'q — bazada osilib qolgan Telegram sessiyalari darhol yopiladi (owner 2026-10-17)
    if (ev.status?.activeCalls === 0 && workerConnectedHere()) reapStaleTelegramSessions().catch(() => undefined);
    if (typeof ev.status?.openConversation !== 'boolean') return;
    const reported = ev.status.openConversation;
    getOpenConversation()
      .then((want) => (want !== reported ? pushOpenConversation(want) : false))
      .catch(() => undefined);
  });
}

