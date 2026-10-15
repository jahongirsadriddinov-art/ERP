import AiCallSession, { type AiCallStatus } from '../../models/AiCallSession';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import User from '../../models/User';
import { aiConfig, INSTANCE_ID, LIMITS } from '../config';
import {
  AIV_SERVER_EVENTS, type AiLang, type AiRole, type AiSettingsData, type AivConfirmActionAck, type AivEndReason,
  type PendingActionInfo, type ToolChannel, type ToolCtx, type ToolDeclaration, type ToolResult, type ToolStatus,
} from '../contracts';
import { checkActor, type ActorState } from '../actor';
import { createTextAgent } from '../brain/textAgent';
import { geminiConfigured } from '../lib/geminiKeys';
import { newCorrelationId } from '../lib/ids';
import { localDate, zonedParts, zonedToUtc } from '../lib/zonedTime';
import { costUsdMicros } from '../pricing';
import { finishSession, liveCapacity, onSessionsEnded, recordCallEvent, touchSession, type EndedSession } from '../sessions';
import { getCompanyAiState, getSettings, isAiActive } from '../settings';
import { confirmPendingAction, executeTool } from '../tools/executor';
import { effectiveToolNames } from '../tools/rbac';
import { toolDeclarations } from '../tools/registry';
import { budgetExceeded, recordUsage } from '../usage';
import { chunkPcm, OUT_RATE, pcmDurationMs } from './audio';
import { CascadeProvider } from './cascade';
import { createDefaultDisclosure, type DisclosureService } from './disclosure';
import { GeminiLiveProvider } from './geminiLive';
import { GeminiTranscriber, GeminiTts } from './geminiSpeech';
import { OutQueue } from './outQueue';
import {
  buildVoiceSystemPrompt, confirmResultText, disclosureTextFor, firstTurnWithDisclosure, startTurnText, wrapUpText,
} from './prompts';
import { openFirstAvailable, openWithTimeout, type ProviderCandidate, type ProviderKind } from './provider';
import { ATTENDANCE_TOOL, attendanceToolDeclaration, runAttendanceTool } from './sessionTools';
import { TranscriptLog } from './transcriptLog';
import type {
  StartVoiceSessionOpts, StartVoiceSessionResult, VoiceOpenOpts, VoiceProvider, VoiceSession, VoiceSessionHandle,
  VoiceSessionManagerApi, VoiceTransport,
} from './types';

// VoiceSessionManager — AiCallSession'ning YAGONA egasi; istalgan audio transportini (in-app socket,
// P6 Telegram worker) VoiceProvider'ga (Gemini Live → kaskad) ulaydi. Asosiy kafolatlar:
//  • band: {employeeId} unique partial indeks (isActive) — E11000 = 'busy' (D9);
//  • platforma semafori AI_LIVE_MAX_CONCURRENT (bepul tarifda 1) va firma companyConcurrency —
//    HISOBLAGICH emas, faol sessiyalarni sanash (B12); insert'dan keyin tartib bo'yicha qayta
//    tekshiriladi (poyga), oshgan sessiya izsiz o'chiriladi;
//  • ringing paytida provayder oldindan ulanadi (A8), ulanishda disclosure klipi DETERMINISTIK
//    birinchi ijro etiladi; klip bo'lmasa — qat'iy birinchi matnli navbat;
//  • tool'lar faqat tools/executor orqali, har chaqiruvda aktyor QAYTA tekshiriladi (B2); tool javobi
//    yuborilmaguncha model ovozi/transkripti mijozga O'TKAZILMAYDI (A7 — "bajarildi"ni oldindan aytolmaydi);
//  • GoAway/uzilish → sessionResumption handle bilan qayta ulanish;
//  • davomiylik: chegara−15 s "yakunlang" navbati, chegarada qattiq to'xtatish;
//  • updatedAt har 15 s (sweeper osilgan deb hisoblamasin, C4); SIGTERM → 'interrupted';
//  • usage (audio sekundlari, tokenlar, narx) AiUsageMetrics'ga va AiCallSession.usage'ga;
//  • chiqish audio real vaqtda uzatiladi (OutQueue: ~400 ms oldinda, transport cap ~500 ms, A10);
//  • har bir yakuniy transkript AiConversation'ga (source + sessionId) — 7 kunlik retention/arxiv uchun.
// Har yakun sessions.finishSession() orqali → onSessionsEnded → P3 runner keyingi qadamni qo'yadi.

type FinalStatus = Exclude<AiCallStatus, 'queued' | 'dialing' | 'ringing' | 'connected'>;
type FailReason = Extract<StartVoiceSessionResult, { ok: false }>['reason'];

export interface ProviderSessionCtx {
  toolCtx: ToolCtx;
  lang: AiLang;
  transportKind: VoiceTransport['kind'];
  models: { live: string; tts: string; transcribe: string };
  onTtsUnavailable: () => void;
  onToolEvent: (e: { name: string; status: ToolStatus; message: string }) => void;
  onPendingAction: (p: PendingActionInfo) => void;
}

export interface VoiceManagerDeps {
  /** Provayder fabrikasi (testlar soxtasini beradi). null — bu tur mavjud emas. */
  providerFor?: (kind: ProviderKind, ctx: ProviderSessionCtx) => VoiceProvider | null;
  disclosure?: DisclosureService;
  setupTimeoutMs?: number;
  touchMs?: number;
  disclosureTimeoutMs?: number;
}

const GENERIC_ERR = { uz: "Ichki xato yuz berdi.", ru: 'Внутренняя ошибка.' };
const DENIED = { uz: "Bu amalga ruxsat yo'q.", ru: 'Нет доступа к этому действию.' };

function statusFor(reason: string, answered: boolean): FinalStatus {
  if (reason === 'shutdown' || reason === 'revoked') return 'interrupted';
  if (answered) return reason === 'error' ? 'interrupted' : 'completed';
  switch (reason) {
    case 'timeout': return 'no_answer';
    case 'declined': return 'declined';
    case 'busy': return 'busy';
    case 'error': case 'unsupported_transport': return 'failed';
    default: return 'cancelled';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); });

function defaultProviderFor(kind: ProviderKind, c: ProviderSessionCtx): VoiceProvider | null {
  if (!geminiConfigured()) return null;
  if (kind === 'gemini_live') return new GeminiLiveProvider();
  return new CascadeProvider({
    agent: createTextAgent(), ctx: c.toolCtx, transcriber: new GeminiTranscriber(), tts: new GeminiTts(),
    transcribeModel: c.models.transcribe, ttsModel: c.models.tts,
    ttsFailureMode: c.transportKind === 'telegram' ? 'close' : 'text_only',
    onTtsUnavailable: c.onTtsUnavailable, onToolEvent: c.onToolEvent, onPendingAction: c.onPendingAction,
  });
}

/** Ovozli sessiya tili: xodimning AI sozlamasi → interfeys tili → firma standarti. */
export async function resolveVoiceLang(companyId: string, userId: string, settings?: AiSettingsData): Promise<AiLang> {
  const contact: any = await AiEmployeeContact.findOne({ companyId, employeeId: userId }).select('languageOverride').lean().catch(() => null);
  if (contact?.languageOverride === 'ru' || contact?.languageOverride === 'uz') return contact.languageOverride;
  const u: any = await User.findById(userId).select('language').lean().catch(() => null);
  if (u?.language === 'ru') return 'ru';
  if (u?.language === 'uz' || u?.language === 'uz-cyrl') return 'uz';
  const s = settings || await getSettings(companyId);
  return s.language === 'ru' ? 'ru' : 'uz';
}

async function companyMinutesExceeded(companyId: string, s: AiSettingsData, now: Date): Promise<boolean> {
  const limit = s.limits.companyMinutesPerDay;
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return false;
  if (limit <= 0) return true;                      // 0 — ovozli daqiqa berilmagan
  const from = zonedToUtc(localDate(now), '00:00');
  const rows = await AiCallSession.aggregate([
    { $match: { companyId, createdAt: { $gte: from }, durationSec: { $gt: 0 } } },
    { $group: { _id: null, sec: { $sum: '$durationSec' } } },
  ]);
  return Number(rows[0]?.sec || 0) >= limit * 60;
}

class ManagedVoiceSession implements VoiceSessionHandle {
  state: 'ringing' | 'connecting' | 'connected' | 'ending' | 'ended' = 'ringing';
  readonly sessionId: string;
  readonly correlationId: string;
  readonly employeeId: string;
  readonly companyId: string;
  readonly purpose: StartVoiceSessionOpts['purpose'];
  readonly lang: AiLang;
  private transport: VoiceTransport;
  private toolChannel: ToolChannel;
  private vs: VoiceSession | null = null;
  private provider: VoiceProvider | null = null;
  private kind: ProviderKind | null = null;
  private model = '';
  private openOpts: VoiceOpenOpts | null = null;
  private providerReady: Promise<boolean> = Promise.resolve(false);
  private allowedTools = new Set<string>();
  private pendingTools = new Map<string, string>();
  private disclosureDone = false;
  private uplinkOpenAt = Number.POSITIVE_INFINITY;
  private seq = 0;
  private timers: NodeJS.Timeout[] = [];
  private touchTimer: NodeJS.Timeout | null = null;
  private ringTimer: NodeJS.Timeout | null = null;
  private inBytes = 0;
  private outBytes = 0;
  private tokensIn = 0;
  private tokensOut = 0;
  private out: OutQueue;
  private log: TranscriptLog;
  suppressedFrames = 0;
  private resumptionHandle?: string;
  private resumptionSavedAt = 0;
  private resumeAttempts = 0;
  private resuming = false;
  private answeredAt?: Date;
  endPromise: Promise<void> | null = null;
  private companyName = '';
  private actorName = '';
  private actorRole: string;
  private actorIsOwner: boolean;

  constructor(
    private mgr: VoiceSessionManager,
    private deps: Required<Pick<VoiceManagerDeps, 'setupTimeoutMs' | 'touchMs' | 'disclosureTimeoutMs'>> & { providerFor: NonNullable<VoiceManagerDeps['providerFor']>; disclosure: DisclosureService },
    private opts: StartVoiceSessionOpts,
    readonly settings: AiSettingsData,
    actor: ActorState,
    doc: { _id: unknown; correlationId: string },
    private limits: { ringTimeoutSec: number; maxDurationSec: number },
  ) {
    this.sessionId = String(doc._id);
    this.correlationId = doc.correlationId;
    this.employeeId = opts.employeeId;
    this.companyId = opts.companyId;
    this.purpose = opts.purpose;
    this.lang = opts.lang === 'ru' ? 'ru' : 'uz';
    this.transport = opts.transport;
    this.toolChannel = opts.channel === 'telegram_call' ? 'telegram_call' : 'inapp_call';
    this.actorName = actor.name;
    this.actorRole = actor.role;
    this.actorIsOwner = actor.isOwner;
    this.out = new OutQueue({
      maxBytes: LIMITS.audioOutQueueMaxBytes,
      backlogBytes: () => { try { return this.transport.backlogBytes?.() ?? 0; } catch { return 0; } },
      send: (f) => this.safe(() => this.transport.sendAudio(f)),
    });
    this.log = new TranscriptLog({
      companyId: this.companyId, userId: this.employeeId, sessionId: this.sessionId, correlationId: this.correlationId,
      source: opts.channel === 'telegram_call' ? 'telegram_call' : 'voice_inapp', purpose: this.purpose, lang: this.lang,
    });
  }

  private isOver(): boolean { return this.state === 'ending' || this.state === 'ended'; }

  // ───────────── Ishga tushirish (ringing) ─────────────
  init(): void {
    this.touchTimer = setInterval(() => { void this.touch(); }, this.deps.touchMs);
    this.touchTimer.unref?.();
    if (this.limits.ringTimeoutSec > 0) {
      this.ringTimer = setTimeout(() => { if (this.state === 'ringing') void this.end('timeout'); }, this.limits.ringTimeoutSec * 1000);
      this.ringTimer.unref?.();
    }
    this.ev('state', { state: this.opts.channel === 'telegram_call' ? 'dialing' : 'ringing', instanceId: INSTANCE_ID });
    this.providerReady = this.openProvider();
  }

  private models() {
    const p = this.settings.provider;
    return {
      live: p.liveModel || aiConfig.models.live,
      tts: p.ttsModel || aiConfig.models.tts,
      // Kaskad transkripsiyasi generateContent orqali — standart matn modeli (inline audio)
      transcribe: p.transcribeModel || aiConfig.models.text,
    };
  }

  private toolCtx(role?: string, isOwner?: boolean): ToolCtx {
    const own = isOwner ?? this.actorIsOwner;
    return {
      companyId: this.companyId, userId: this.employeeId, role: (own ? 'direktor' : (role ?? this.actorRole)) as AiRole, isOwner: own,
      lang: this.lang, tz: 'Asia/Tashkent', channel: this.toolChannel, purpose: this.purpose,
      sessionId: this.sessionId, correlationId: this.correlationId,
    };
  }

  private disclosureText(): string {
    return disclosureTextFor(this.lang, this.companyName, this.settings.disclosureText);
  }

  private clipReq() {
    return { text: this.disclosureText(), lang: this.lang, voiceName: this.settings.voiceName, model: this.models().tts };
  }

  private async openProvider(): Promise<boolean> {
    try {
      const st = await getCompanyAiState(this.companyId);
      this.companyName = st.name;
      // Disclosure klipini oldindan isitish (ringing paytida) — ulanishda kutish bo'lmasin
      void this.deps.disclosure.getClip(this.clipReq(), 15_000).catch(() => null);

      const names = effectiveToolNames(this.settings, this.actorRole, this.actorIsOwner, { channel: this.toolChannel, purpose: this.purpose });
      const decls: ToolDeclaration[] = toolDeclarations(names, this.lang);
      if (this.purpose === 'attendance' && this.opts.confirmationId) decls.push(attendanceToolDeclaration(this.lang));
      this.allowedTools = new Set(decls.map((d) => d.name));
      const zp = zonedParts(new Date());
      const systemInstruction = buildVoiceSystemPrompt({
        lang: this.lang, purpose: this.purpose, channel: this.toolChannel, companyName: this.companyName,
        userName: this.actorName, role: this.actorRole, isOwner: this.actorIsOwner, today: zp.date, weekday: zp.isoWeekday,
        requestText: this.opts.requestText,
      });
      const base: Omit<VoiceOpenOpts, 'model'> = {
        systemInstruction, tools: decls, lang: this.lang, voiceName: this.settings.voiceName, ptt: this.opts.ptt,
      };
      const kinds: ProviderKind[] = [this.settings.provider.primary];
      if (this.settings.provider.fallback === 'gemini_cascade' && !kinds.includes('gemini_cascade')) kinds.push('gemini_cascade');
      const models = this.models();
      const pctx: ProviderSessionCtx = {
        toolCtx: this.toolCtx(), lang: this.lang, transportKind: this.transport.kind, models,
        onTtsUnavailable: () => this.safeSend(AIV_SERVER_EVENTS.error, { code: 'tts_unavailable', message: 'TTS unavailable — text only' }),
        onToolEvent: (e) => this.safeSend(AIV_SERVER_EVENTS.tool, { sessionId: this.sessionId, ...e }),
        onPendingAction: (p) => this.sendConfirmCard(p),
      };
      const candidates: ProviderCandidate[] = [];
      for (const k of kinds) {
        const provider = this.deps.providerFor(k, pctx);
        if (provider) candidates.push({ kind: k, model: k === 'gemini_live' ? models.live : aiConfig.models.text, provider });
      }
      if (!candidates.length) { this.ev('error', { stage: 'open', message: 'no_provider' }); return this.providerFailed(); }
      const opened = await openFirstAvailable(candidates, base, this.deps.setupTimeoutMs,
        (kind, err) => this.ev('error', { stage: 'open', provider: kind, message: err.message.slice(0, 200) }));
      if (this.isOver()) { void opened.session.close('ended'); return false; }
      this.vs = opened.session;
      this.provider = opened.provider;
      this.kind = opened.kind;
      this.model = opened.model;
      this.openOpts = { ...base, model: opened.model };
      this.attach(opened.session);
      AiCallSession.updateOne({ _id: this.sessionId }, { $set: { provider: opened.kind, modelId: opened.model } }).catch(() => undefined);
      return true;
    } catch (e) {
      this.ev('error', { stage: 'open', message: (e as Error).message.slice(0, 200) });
      return this.providerFailed();
    }
  }

  /** Provayder umuman ochilmadi: hali ulanmagan qo'ng'iroq darhol 'failed' (o'lik qo'ng'iroqni qabul qildirmaymiz). */
  private providerFailed(): false {
    if (this.state === 'ringing') void this.end('error');
    return false;
  }

  private attach(s: VoiceSession) {
    s.on('audioOut', (pcm) => { if (s === this.vs) this.onModelAudio(pcm); });
    s.on('transcript', (t) => { if (s === this.vs) this.onTranscript(t); });
    s.on('toolCall', (c) => { if (s === this.vs) void this.onToolCall(c); });
    s.on('interrupted', () => {
      if (s !== this.vs || this.state !== 'connected') return;
      this.out.clear();
      this.safe(() => this.transport.flushAudio());
      this.safeSend(AIV_SERVER_EVENTS.interrupted, { sessionId: this.sessionId });
    });
    s.on('goAway', (g) => {
      if (s !== this.vs) return;
      this.ev('goaway', { timeLeftMs: g.timeLeftMs });
      void this.resume('goaway');
    });
    s.on('resumption', (r) => { if (s === this.vs) this.onResumption(r.handle); });
    // Audio sekundlari menejerda o'lchanadi (kirish/chiqish baytlari) — provayderdan faqat tokenlar
    s.on('usage', (u) => {
      this.tokensIn += Math.max(0, u.tokensIn || 0);
      this.tokensOut += Math.max(0, u.tokensOut || 0);
    });
    s.on('closed', (c) => {
      if (s !== this.vs || this.isOver()) return;
      this.ev('error', { stage: 'provider_closed', reason: String(c.reason).slice(0, 80), message: c.error ? String(c.error).slice(0, 200) : undefined });
      if (c.reason === 'tts_unavailable') { void this.end('error'); return; }
      void this.resume('closed');
    });
  }

  // ───────────── Ulanish va disclosure ─────────────
  async connected(): Promise<void> {
    if (this.state !== 'ringing') return;
    this.state = 'connecting';
    if (this.ringTimer) { clearTimeout(this.ringTimer); this.ringTimer = null; }
    this.answeredAt = new Date();
    await AiCallSession.updateOne({ _id: this.sessionId, isActive: true }, { $set: { status: 'connected', answeredAt: this.answeredAt } })
      .catch((e) => console.error('[aiVoice] sessiya holati yozilmadi:', (e as Error).message));
    this.ev('state', { state: 'connected' });
    this.safeSend(AIV_SERVER_EVENTS.ready, {
      sessionId: this.sessionId, correlationId: this.correlationId, inputSampleRate: 16000, outputSampleRate: 24000, frameMs: 40, ptt: this.opts.ptt,
    });
    this.startDurationTimers();
    const ok = await this.providerReady;
    if (this.state !== 'connecting') return;             // shu orada yakunlandi
    if (!ok || !this.vs) { await this.end('error'); return; }
    this.state = 'connected';
    await this.playDisclosure();
  }

  private async playDisclosure() {
    const text = this.disclosureText();
    const clip = await this.deps.disclosure.getClip(this.clipReq(), this.deps.disclosureTimeoutMs).catch(() => null);
    if (this.state !== 'connected' || !this.vs) return;
    this.safeSend(AIV_SERVER_EVENTS.transcript, { sessionId: this.sessionId, role: 'assistant', text, final: true });
    this.log.add('assistant', text);
    if (clip && clip.length >= 2) {
      // Klip — model ovozidan OLDIN, deterministik (A8)
      for (const f of chunkPcm(clip)) this.sendOut(f);
      this.disclosureDone = true;
      this.uplinkOpenAt = Date.now() + Math.min(8_000, pcmDurationMs(clip.length, OUT_RATE));
      this.ev('state', { state: 'disclosure', mode: 'clip', ms: pcmDurationMs(clip.length, OUT_RATE) });
      this.vs.sendText(startTurnText(this.lang, this.purpose));
    } else {
      // TTS yo'q — qat'iy birinchi matnli navbat: model aynan shu jumla bilan boshlaydi
      this.disclosureDone = true;
      this.uplinkOpenAt = Date.now() + 3_000;
      this.ev('state', { state: 'disclosure', mode: 'text' });
      this.vs.sendText(firstTurnWithDisclosure(this.lang, this.purpose, text));
    }
  }

  private startDurationTimers() {
    const limitMs = Math.max(1, this.limits.maxDurationSec) * 1000;
    if (limitMs > 20_000) {
      const t = setTimeout(() => { if (this.state === 'connected') this.vs?.sendText(wrapUpText(this.lang)); }, limitMs - 15_000);
      t.unref?.(); this.timers.push(t);
    }
    const hard = setTimeout(() => { void this.end('max_duration'); }, limitMs);
    hard.unref?.(); this.timers.push(hard);
  }

  // ───────────── Audio ─────────────
  pushAudio(pcm16k: Buffer): void {
    if (this.state !== 'connected' || !this.vs || !this.disclosureDone) return;
    if (Date.now() < this.uplinkOpenAt) return;          // disclosure ijro etilayotganda kirish e'tiborsiz
    if (!pcm16k?.length || pcm16k.length % 2) return;
    this.inBytes += pcm16k.length;
    this.vs.pushAudio(pcm16k);
  }

  activityStart(): void { if (this.opts.ptt && this.state === 'connected') this.vs?.activityStart(); }
  activityEnd(): void { if (this.opts.ptt && this.state === 'connected') this.vs?.activityEnd(); }

  private onModelAudio(pcm: Buffer) {
    if (this.state !== 'connected' || !this.disclosureDone) return;
    if (this.pendingTools.size) { this.suppressedFrames++; return; }   // A7: tool javobidan oldin ovoz yo'q
    for (const f of chunkPcm(pcm)) this.sendOut(f);
  }

  private sendOut(f: Buffer) {
    this.outBytes += f.length;
    this.out.push(f);
  }

  private onTranscript(t: { role: 'user' | 'assistant'; text: string; final: boolean }) {
    if (this.state !== 'connected') return;
    if (t.role === 'assistant' && (this.pendingTools.size || !this.disclosureDone)) return;
    const text = String(t.text || '').slice(0, 2000);
    if (!text) return;
    this.safeSend(AIV_SERVER_EVENTS.transcript, { sessionId: this.sessionId, role: t.role, text, final: !!t.final });
    if (t.final) {
      this.ev(t.role === 'user' ? 'transcript_in' : 'transcript_out', { text });
      this.log.add(t.role, text);
    }
  }

  // ───────────── Tool'lar ─────────────
  private async onToolCall(c: { id: string; name: string; args: Record<string, unknown> }) {
    if (this.isOver()) return;
    const id = String(c.id || '').slice(0, 128) || `t${this.seq}`;
    const name = String(c.name || '').slice(0, 64);
    this.pendingTools.set(id, name);
    this.ev('tool_call', { id, name, args: c.args });
    let result: ToolResult;
    let pending: PendingActionInfo | undefined;
    let revoke = false;
    try {
      const ac = await checkActor(this.employeeId, this.companyId);                 // B2: har chaqiruvda
      if (!ac.ok) {
        result = { status: 'denied', message: DENIED[this.lang], retryable: false };
        revoke = ac.code !== 'feature';
      } else if (!this.allowedTools.has(name)) {
        result = { status: 'denied', message: DENIED[this.lang], retryable: false };
      } else if (name === ATTENDANCE_TOOL) {
        result = await runAttendanceTool({ companyId: this.companyId, employeeId: this.employeeId, confirmationId: this.opts.confirmationId, lang: this.lang }, c.args || {});
      } else {
        const out = await executeTool(this.toolCtx(ac.actor.role, ac.actor.isOwner), name, c.args || {}, { idempotencyKey: `aiv:${this.sessionId}:${id}`.slice(0, 120) });
        result = out.result;
        pending = out.pending;
      }
    } catch (e) {
      console.error('[aiVoice] tool ko\'prigi xatosi:', (e as Error).message);
      result = { status: 'error', message: GENERIC_ERR[this.lang], retryable: false };
    }
    this.ev('tool_result', { id, name, status: result.status, message: result.message });
    if (this.isOver()) { this.pendingTools.delete(id); return; }
    this.safeSend(AIV_SERVER_EVENTS.tool, { sessionId: this.sessionId, name, status: result.status, message: result.message });
    if (pending) this.sendConfirmCard(pending);
    // Avval "kutilmoqda" holatidan chiqaramiz, keyin javob — shundan keyingi model ovozi o'tadi
    this.pendingTools.delete(id);
    this.vs?.toolResponse([{ id, name, result }]);
    if (revoke) await this.end('revoked');
  }

  private sendConfirmCard(p: PendingActionInfo) {
    // Telegram qo'ng'irog'ida UI yo'q — tasdiq bot ai:x tugmasi orqali (executor yo'naltiradi, B3)
    if (p.confirmVia !== 'ui' || this.transport.kind !== 'inapp') return;
    this.safeSend(AIV_SERVER_EVENTS.confirm, { sessionId: this.sessionId, pendingActionId: p.pendingActionId, summary: p.summary, expiresAt: p.expiresAt });
  }

  async confirmAction(pendingActionId: string, accept: boolean): Promise<AivConfirmActionAck> {
    const out = await confirmPendingAction({
      pendingActionId, actorUserId: this.employeeId, companyId: this.companyId, channel: this.toolChannel, accept: !!accept, lang: this.lang,
    });
    const r = out.result;
    this.ev('tool_result', { id: `confirm:${pendingActionId}`, name: 'confirm', status: r.status, message: r.message, accept: !!accept });
    if (this.state === 'connected') {
      this.safeSend(AIV_SERVER_EVENTS.tool, { sessionId: this.sessionId, name: 'confirm', status: r.status, message: r.message });
      this.vs?.sendText(confirmResultText(this.lang, !!accept, r.status, r.message));
    }
    if (r.status === 'error' && !out.auditId) return { ok: false, code: 'not_found', message: r.message };
    return { ok: true, status: r.status, message: r.message };
  }

  // ───────────── Resumption ─────────────
  private onResumption(handle: string) {
    if (!handle) return;
    this.resumptionHandle = handle;
    const now = Date.now();
    if (now - this.resumptionSavedAt > 10_000) {
      this.resumptionSavedAt = now;
      AiCallSession.updateOne({ _id: this.sessionId, isActive: true }, { $set: { resumptionHandle: handle } }).catch(() => undefined);
    }
  }

  private async resume(why: 'goaway' | 'closed'): Promise<void> {
    if (this.resuming || this.isOver()) return;
    if (!this.resumptionHandle || this.kind !== 'gemini_live' || !this.provider || !this.openOpts || this.resumeAttempts >= 3) {
      if (why === 'closed') await this.end('error');
      return;
    }
    this.resuming = true;
    this.resumeAttempts++;
    const old = this.vs;
    try {
      const s = await openWithTimeout(this.provider, { ...this.openOpts, resumptionHandle: this.resumptionHandle }, this.deps.setupTimeoutMs);
      if (this.isOver()) { void s.close('ended'); return; }
      this.vs = s;
      this.attach(s);
      this.ev('state', { state: 'resumed', why, attempt: this.resumeAttempts });
      if (old && old !== s) void old.close('goaway');
    } catch (e) {
      this.ev('error', { stage: 'resume', message: (e as Error).message.slice(0, 200) });
      if (why === 'closed') await this.end('error');
    } finally {
      this.resuming = false;
    }
  }

  // ───────────── Yakun ─────────────
  end(reason: AivEndReason): Promise<void> {
    if (!this.endPromise) this.endPromise = this.finish(reason, true);
    return this.endPromise;
  }

  /** Sessiya tashqaridan yakunlangan (blok, sweep, bekor qilish) — DB'ga yozmasdan mahalliy tozalash. */
  externalEnd(reason: string): Promise<void> {
    if (!this.endPromise) {
      const r: AivEndReason = reason === 'revoked' ? 'revoked' : reason === 'shutdown' ? 'shutdown' : 'error';
      this.endPromise = this.finish(r, false);
    }
    return this.endPromise;
  }

  private async finish(reason: AivEndReason, writeDb: boolean): Promise<void> {
    this.state = 'ending';
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.ringTimer) clearTimeout(this.ringTimer);
    if (this.touchTimer) clearInterval(this.touchTimer);
    this.out.close();
    const vs = this.vs;
    this.vs = null;
    if (vs) await Promise.race([vs.close(reason).catch(() => undefined), sleep(2_000)]);
    const status = statusFor(reason, !!this.answeredAt);
    const audioInSec = Math.round((this.inBytes / 32_000) * 10) / 10;
    const audioOutSec = Math.round((this.outBytes / 48_000) * 10) / 10;
    const model = this.model || 'none';
    const cost = this.kind ? costUsdMicros(model, { tokensIn: this.tokensIn, tokensOut: this.tokensOut, audioInSec, audioOutSec }) : 0;
    if (writeDb) {
      await finishSession(this.sessionId, status, reason, {
        usage: { audioInSec, audioOutSec, tokensIn: this.tokensIn, tokensOut: this.tokensOut, costUsdMicros: cost },
      }).catch((e) => console.error('[aiVoice] finishSession xatosi:', (e as Error).message));
    }
    await recordUsage(
      { companyId: this.companyId, userId: this.employeeId, provider: this.kind || 'none', model },
      { sessions: 1, audioInSec, audioOutSec, tokensIn: this.tokensIn, tokensOut: this.tokensOut, costUsdMicros: cost, bytesRelayed: this.inBytes + this.outBytes },
    ).catch(() => undefined);
    await Promise.race([this.log.close(), sleep(3_000)]);
    this.ev('usage', {
      audioInSec, audioOutSec, tokensIn: this.tokensIn, tokensOut: this.tokensOut, costUsdMicros: cost,
      suppressedFrames: this.suppressedFrames, droppedOutFrames: this.out.droppedFrames, transcriptMessages: this.log.count,
    });
    this.ev('state', { state: 'ended', reason, status });
    this.safe(() => this.transport.close(reason));
    this.state = 'ended';
    this.mgr.remove(this);
  }

  private async touch() {
    if (this.isOver()) return;
    const alive = await touchSession(this.sessionId).catch(() => true);
    if (!alive && !this.isOver()) await this.externalEnd('stale');
  }

  // ───────────── Yordamchilar ─────────────
  private ev(type: Parameters<typeof recordCallEvent>[0]['type'], data: unknown) {
    const seq = this.seq++;
    recordCallEvent({ companyId: this.companyId, sessionId: this.sessionId, correlationId: this.correlationId, seq, type, data })
      .catch((e) => console.error('[aiVoice] call event yozilmadi:', (e as Error).message));
  }

  private safeSend(event: string, payload: unknown) { this.safe(() => this.transport.sendEvent(event, payload)); }
  private safe(fn: () => void) {
    try { fn(); } catch (e) { console.error('[aiVoice] transport xatosi:', (e as Error).message); }
  }
}

export class VoiceSessionManager implements VoiceSessionManagerApi {
  private sessions = new Map<string, ManagedVoiceSession>();
  private byCorrelation = new Map<string, string>();
  private draining = false;
  private offEnded: () => void;
  private d: ConstructorParameters<typeof ManagedVoiceSession>[1];

  constructor(deps: VoiceManagerDeps = {}) {
    this.d = {
      providerFor: deps.providerFor || defaultProviderFor,
      disclosure: deps.disclosure || createDefaultDisclosure(),
      setupTimeoutMs: deps.setupTimeoutMs ?? 4_500,
      touchMs: deps.touchMs ?? LIMITS.sessionTouchMs,
      disclosureTimeoutMs: deps.disclosureTimeoutMs ?? 3_000,
    };
    this.offEnded = onSessionsEnded((list) => this.onExternalEnd(list));
  }

  get activeCount(): number { return this.sessions.size; }

  async start(opts: StartVoiceSessionOpts): Promise<StartVoiceSessionResult> {
    const fail = (reason: FailReason): StartVoiceSessionResult => ({ ok: false, reason });
    try {
      if (this.draining || !aiConfig.enabled) return fail('disabled');
      if (!opts?.companyId || !opts.employeeId || !opts.transport) return fail('error');
      if (!(await isAiActive(opts.companyId))) return fail('disabled');
      const ac = await checkActor(opts.employeeId, opts.companyId);
      if (!ac.ok) return fail('denied');
      if (await budgetExceeded(opts.companyId)) return fail('budget');
      const settings = await getSettings(opts.companyId);
      const now = new Date();
      if (await companyMinutesExceeded(opts.companyId, settings, now)) return fail('limit');
      const cap = await liveCapacity(opts.companyId, settings.calls.companyConcurrency);
      if (!cap.ok) return fail(cap.reason || 'platform_cap');

      const limits = {
        ringTimeoutSec: Math.max(0, Math.round(opts.ringTimeoutSec ?? settings.calls.ringTimeoutSec)),
        maxDurationSec: Math.max(1, Math.round(opts.maxDurationSec ?? (opts.purpose === 'assistant' ? settings.calls.assistantMaxDurationSec : settings.calls.maxDurationSec))),
      };
      let doc: any;
      try {
        doc = await AiCallSession.create({
          companyId: opts.companyId, employeeId: opts.employeeId, correlationId: opts.correlationId || newCorrelationId(),
          ...(opts.attemptKey ? { attemptKey: opts.attemptKey } : {}),
          purpose: opts.purpose, channel: opts.channel,
          direction: (opts.userInitiated ?? (opts.purpose === 'assistant' && opts.channel === 'inapp_call')) ? 'inbound' : 'outbound',
          status: opts.channel === 'telegram_call' ? 'dialing' : 'ringing', isActive: true,
          attemptNo: opts.attemptNo ?? 1, jobId: opts.jobId, confirmationId: opts.confirmationId,
          provider: settings.provider.primary, instanceId: INSTANCE_ID, workerInstanceId: opts.workerInstanceId, socketId: opts.socketId,
          limits, startedAt: now, ringingAt: now,
        });
      } catch (e: any) {
        if (e?.code === 11000 && (e?.keyPattern?.employeeId || /employeeId|one_active_call/.test(String(e?.message)))) return fail('busy');
        console.error('[aiVoice] sessiya yaratilmadi:', e?.message);
        return fail('error');
      }
      // Poyga: count → insert atomik emas. Faol sessiyalar tartibida o'rnimiz chegaradan oshsa — izsiz chekinamiz
      const over = await this.overCap(String(doc._id), opts.companyId, settings);
      if (over) {
        await AiCallSession.deleteOne({ _id: doc._id }).catch(() => undefined);
        return fail(over);
      }
      const s = new ManagedVoiceSession(this, this.d, opts, settings, ac.actor, doc, limits);
      this.sessions.set(s.sessionId, s);
      this.byCorrelation.set(s.correlationId, s.sessionId);
      s.init();
      return { ok: true, handle: s };
    } catch (e) {
      console.error('[aiVoice] ovozli sessiya boshlanmadi:', (e as Error).message);
      return fail('error');
    }
  }

  private async overCap(id: string, companyId: string, s: AiSettingsData): Promise<'platform_cap' | 'company_cap' | null> {
    const active: any[] = await AiCallSession.find({ isActive: true }).sort({ createdAt: 1, _id: 1 }).select('_id companyId').limit(1000).lean();
    const pIdx = active.findIndex((a) => String(a._id) === id);
    if (pIdx >= aiConfig.liveMaxConcurrent) return 'platform_cap';
    const cIdx = active.filter((a) => a.companyId === companyId).findIndex((a) => String(a._id) === id);
    if (cIdx >= s.calls.companyConcurrency) return 'company_cap';
    return null;
  }

  get(id: string): VoiceSessionHandle | undefined {
    if (!id) return undefined;
    return this.sessions.get(id) || this.sessions.get(this.byCorrelation.get(id) || '');
  }

  /** Shu instansiyadagi sessiyalar (in-app socket uchun). */
  list(): VoiceSessionHandle[] { return [...this.sessions.values()]; }

  remove(s: ManagedVoiceSession): void {
    this.sessions.delete(s.sessionId);
    this.byCorrelation.delete(s.correlationId);
  }

  async endAllForUser(userId: string, reason: AivEndReason): Promise<number> {
    const mine = [...this.sessions.values()].filter((s) => s.employeeId === String(userId));
    await Promise.all(mine.map((s) => s.end(reason)));
    return mine.length;
  }

  async drain(timeoutMs: number): Promise<void> {
    this.draining = true;
    const all = [...this.sessions.values()];
    if (!all.length) return;
    await Promise.race([Promise.all(all.map((s) => s.end('shutdown'))), sleep(Math.max(0, timeoutMs))]);
  }

  private async onExternalEnd(list: EndedSession[]) {
    for (const e of list) {
      const s = this.sessions.get(e.sessionId);
      if (s && !s.endPromise) await s.externalEnd(e.reason);
    }
  }

  /** Testlar uchun: tinglovchini olib tashlash va mahalliy holatni tozalash. */
  dispose(): void {
    this.offEnded();
    this.sessions.clear();
    this.byCorrelation.clear();
  }
}

class DisabledVoiceSessionManager implements VoiceSessionManagerApi {
  async start(_opts: StartVoiceSessionOpts): Promise<StartVoiceSessionResult> { return { ok: false, reason: 'disabled' }; }
  get(_id: string): VoiceSessionHandle | undefined { return undefined; }
  async endAllForUser(_userId: string): Promise<number> { return 0; }
  async drain(_timeoutMs: number): Promise<void> { /* no-op */ }
}

const disabled = new DisabledVoiceSessionManager();
let manager: VoiceSessionManagerApi | null = null;

/**
 * P6 (Telegram ko'prigi), in-app socket va bootstrap menejerni FAQAT shu orqali oladi.
 * AI o'chiq bo'lsa — hech narsa qilmaydigan menejer (keshlanmaydi: keyin yoqilsa haqiqiysi yaratiladi).
 */
export function getVoiceSessionManager(): VoiceSessionManagerApi {
  if (manager) return manager;
  if (!aiConfig.enabled) return disabled;
  manager = new VoiceSessionManager();
  return manager;
}

/** P5 (yoki testlar soxtasini) ulaydi. null — standartga qaytarish. */
export function setVoiceSessionManager(m: VoiceSessionManagerApi | null): void {
  if (manager && manager !== m && manager instanceof VoiceSessionManager) manager.dispose();
  manager = m;
}
