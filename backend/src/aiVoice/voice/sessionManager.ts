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
import { countActiveSessions, endActiveSessions, finishSession, liveCapacity, onSessionsEnded, recordCallEvent, touchSession, type EndedSession } from '../sessions';
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
  buildGuestVoicePrompt, buildVoiceSystemPrompt, confirmResultText, disclosureTextFor, firstTurnWithDisclosure, greetingTurn, startTurnText, wrapUpText,
} from './prompts';
import { openFirstAvailable, openWithTimeout, type ProviderCandidate, type ProviderKind } from './provider';
import { ATTENDANCE_TOOL, attendanceToolDeclaration, runAttendanceTool } from './sessionTools';
import { TranscriptLog } from './transcriptLog';
import { clearVision, pushFrame } from './vision';
import { pureYesNo } from '../brain/style';
import { getTool } from '../tools/registry';
import { VISION_GUIDE } from '../brain/systemPrompt';
import { loadDeveloperActor, PLATFORM_SCOPE, platformSettings } from '../platform';
import { generalToolNames } from '../tools/rbac';
import {
  classifyVoiceError, FAIL_TEXT, failCodeFor, LIVE_FALLBACK_MODELS, liveModelDown, modelChain, noteLiveFailure, noteLiveOk,
  worthNextModel, type VoiceErrorKind,
} from './voiceErrors';
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
// Ishonchlilik (owner 2026-10-16 "ilovada AI qo'ng'iroq ishlamayapti"):
//  • Live modellar zanjiri (AI_LIVE_MODEL → tasdiqlangan zaxiralar), ishlamagan model "o'chirgich"da
//    (voiceErrors), keyin kaskad; kalit xatosi (auth) bo'lsa kaskad ham sinalmaydi;
//  • hech biri ochilmasa — mijozga sabab kodi (aiv:error ai_quota|ai_not_configured|ai_unavailable), keyin end;
//  • suhbat o'rtasida Live uzilib qayta ulanib bo'lmasa — kaskadga o'tiladi (qo'ng'iroq uzilmaydi);
//  • aiv:ready faqat provayder TAYYOR bo'lganda (mijoz "AI ulanmoqda" ko'radi, jim "ulandi" emas);
//  • semafor/band "osilib" qolmasin: cap yoki band bo'lsa 45 s+ yangilanmagan begona sessiyalar yakunlanadi.

type FinalStatus = Exclude<AiCallStatus, 'queued' | 'dialing' | 'ringing' | 'connected'>;
type FailReason = Extract<StartVoiceSessionResult, { ok: false }>['reason'];

export interface ProviderSessionCtx {
  toolCtx: ToolCtx;
  lang: AiLang;
  transportKind: VoiceTransport['kind'];
  models: { live: string; tts: string; transcribe: string };
  onTtsUnavailable: () => void;
  /** Kaskad: ovozni matnga o'girib bo'lmaydi (kvota) — matnli rejimga o'tish. */
  onInputUnavailable?: (kind: 'quota') => void;
  onToolEvent: (e: { name: string; status: ToolStatus; message: string }) => void;
  onPendingAction: (p: PendingActionInfo) => void;
}

export interface VoiceManagerDeps {
  /** Kaskad (Live'siz) ochib bo'ladimi — Live semafori to'lganda foydalanuvchi qo'ng'irog'i kaskadga o'tadi. */
  canCascade?: () => boolean;
  /** Provayder fabrikasi (testlar soxtasini beradi). null — bu tur mavjud emas. */
  providerFor?: (kind: ProviderKind, ctx: ProviderSessionCtx) => VoiceProvider | null;
  disclosure?: DisclosureService;
  setupTimeoutMs?: number;
  touchMs?: number;
  disclosureTimeoutMs?: number;
  /** Gemini Live'da ham TTS klipini ijro etish (standart false — ovoz ikki xil bo'lmasin; testlar uchun). */
  clipOnLive?: boolean;
}

/** canCascade tekshiruvi uchun bo'sh kontekst (provayder fabrikasi faqat turini ko'radi). */
const PROBE_CTX = {
  toolCtx: {} as ToolCtx, lang: 'uz', transportKind: 'inapp', models: { live: '', tts: '', transcribe: '' },
  onTtsUnavailable: () => undefined, onToolEvent: () => undefined, onPendingAction: () => undefined,
} as ProviderSessionCtx;

const GENERIC_ERR = { uz: "Ichki xato yuz berdi.", ru: 'Внутренняя ошибка.' };
const FALLBACK_NOTE = {
  uz: "Ovozli aloqa zaxira rejimga o'tdi — suhbatni davom ettiring.",
  ru: 'Голосовая связь перешла в резервный режим — продолжайте разговор.',
};
/** Live modellarini sinash uchun umumiy vaqt (keyin darhol kaskad). */
const LIVE_BUDGET_MS = 7_000;
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
    onTtsUnavailable: c.onTtsUnavailable, onInputUnavailable: c.onInputUnavailable, onToolEvent: c.onToolEvent, onPendingAction: c.onPendingAction,
  });
}

/** Ovozli sessiya tili: xodimning AI sozlamasi → interfeys tili → firma standarti. */
/** Mehmon qo'ng'irog'ida ruxsat etilgan umumiy tool'lar — firma/xodimga tegadigan hech narsa yo'q. */
const GUEST_TOOLS = new Set(['endCall', 'getWeather', 'getExchangeRate', 'searchWeb', 'setSubtitles']);

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
  private failKind: VoiceErrorKind | null = null;
  private cascade: ProviderCandidate | null = null;
  private fellBack = false;
  /** Live semafori to'lgan (foydalanuvchi qo'ng'irog'i) — faqat kaskad. */
  liveBlocked = false;
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
  /** Qo'ng'iroq diagnostikasi (owner 2026-10-19: "sekin, bo'linib gapiradi") — yakunda logga yoziladi. */
  private stats = { connectedAt: 0, firstAudioAt: 0, interruptions: 0, userTurns: 0, toolCalls: 0, lastUserAt: 0, replyMs: [] as number[] };
  /** Mehmon sinov qo'ng'irog'i — firmasiz, faqat umumiy tool'lar (owner 2026-10-19). */
  private readonly guest: boolean;

  constructor(
    private mgr: VoiceSessionManager,
    private deps: Required<Pick<VoiceManagerDeps, 'setupTimeoutMs' | 'touchMs' | 'disclosureTimeoutMs' | 'clipOnLive'>> & { providerFor: NonNullable<VoiceManagerDeps['providerFor']>; disclosure: DisclosureService },
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
    // Murojaat — faqat ism (familiyasiz)
    this.guest = !!opts.guest;
    this.actorName = this.guest ? String(opts.guest?.name || '').slice(0, 40) : (actor.firstName || actor.name);
    this.actorRole = this.guest ? 'dasturchi' : actor.role;
    this.actorIsOwner = this.guest ? false : actor.isOwner;
    this.out = new OutQueue({
      // Telegram: worker o'zi 10 ms'lik kadrlarni bir tekis yuboradi — unga ~1.5 s zaxira beramiz (Render'dagi Node
      // biror ishga band bo'lib qolsa ovoz "bo'linib" qolmasin). Gap bo'linsa worker buferi flushAudio bilan tozalanadi.
      leadMs: opts.channel === 'telegram_call' ? 1500 : 400,
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
      // Sozlama/env (vergul bilan bir nechta bo'lishi mumkin) → tasdiqlangan zaxiralar
      liveChain: modelChain(p.liveModel || aiConfig.models.live, LIVE_FALLBACK_MODELS, 5),
      tts: p.ttsModel || aiConfig.models.tts,
      // Kaskad transkripsiyasi generateContent orqali — standart matn modeli (inline audio)
      transcribe: p.transcribeModel || aiConfig.models.text,
    };
  }

  private toolCtx(role?: string, isOwner?: boolean): ToolCtx {
    const own = isOwner ?? this.actorIsOwner;
    return {
      companyId: this.companyId, userId: this.employeeId, role: (this.guest ? 'dasturchi' : own ? 'direktor' : (role ?? this.actorRole)) as AiRole, isOwner: this.guest ? false : own,
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

  /** Kim qo'ng'iroq qildi (prompt konteksti; DB 'direction' bilan bir xil qoida). */
  private get direction(): 'inbound' | 'outbound' {
    return (this.opts.userInitiated ?? (this.opts.purpose === 'assistant' && this.opts.channel === 'inapp_call')) ? 'inbound' : 'outbound';
  }

  private async openProvider(): Promise<boolean> {
    try {
      const st = this.guest ? { name: '' } : await getCompanyAiState(this.companyId);
      this.companyName = st.name;
      // Disclosure klipini oldindan isitish — faqat kaskad asosiy bo'lsa (Live'da klip ishlatilmaydi)
      if (this.settings.provider.primary !== 'gemini_live' || this.deps.clipOnLive) void this.deps.disclosure.getClip(this.clipReq(), 15_000).catch(() => null);

      const names = this.guest
        ? generalToolNames({ channel: this.toolChannel, purpose: this.purpose }).filter((n) => GUEST_TOOLS.has(n))
        : effectiveToolNames(this.settings, this.actorRole, this.actorIsOwner, { channel: this.toolChannel, purpose: this.purpose });
      const decls: ToolDeclaration[] = toolDeclarations(names, this.lang);
      if (this.purpose === 'attendance' && this.opts.confirmationId) decls.push(attendanceToolDeclaration(this.lang));
      this.allowedTools = new Set(decls.map((d) => d.name));
      const zp = zonedParts(new Date());
      const systemInstruction = this.guest ? buildGuestVoicePrompt({
        lang: this.lang, name: this.actorName, today: zp.date, time: zp.hhmm, persona: this.settings.persona, voiceName: this.settings.voiceName,
      }) : buildVoiceSystemPrompt({
        lang: this.lang, purpose: this.purpose, channel: this.toolChannel, companyName: this.companyName,
        userName: this.actorName, role: this.actorRole, isOwner: this.actorIsOwner, today: zp.date, weekday: zp.isoWeekday,
        requestText: this.opts.requestText, direction: this.direction, time: zp.hhmm,
        persona: this.settings.persona, voiceName: this.settings.voiceName,
      });
      const base: Omit<VoiceOpenOpts, 'model'> = {
        systemInstruction, tools: decls, lang: this.lang, voiceName: this.settings.voiceName, ptt: this.opts.ptt,
        telephony: this.opts.channel === 'telegram_call',
      };
      // Owner 2026-10-16: qo'ng'iroq "limit" bilan to'xtamasin — kaskad (transkripsiya → TextAgent → TTS)
      // doim oxirgi zaxira (sozlamadagi fallback='none' bo'lsa ham). Live semafori to'lgan bo'lsa — faqat kaskad.
      const kinds: ProviderKind[] = this.liveBlocked ? ['gemini_cascade'] : [this.settings.provider.primary];
      if (!kinds.includes('gemini_cascade')) kinds.push('gemini_cascade');
      const models = this.models();
      const pctx: ProviderSessionCtx = {
        toolCtx: this.toolCtx(), lang: this.lang, transportKind: this.transport.kind, models,
        onTtsUnavailable: () => this.safeSend(AIV_SERVER_EVENTS.error, { code: 'tts_unavailable', message: 'TTS unavailable — text only' }),
        onInputUnavailable: (kind) => this.toTextMode(kind),
        onToolEvent: (e) => this.safeSend(AIV_SERVER_EVENTS.tool, { sessionId: this.sessionId, ...e }),
        onPendingAction: (p) => this.sendConfirmCard(p),
      };
      const candidates: ProviderCandidate[] = [];
      const cascadeProvider = kinds.includes('gemini_cascade') ? this.deps.providerFor('gemini_cascade', pctx) : null;
      for (const k of kinds) {
        if (k === 'gemini_live') {
          const provider = this.deps.providerFor(k, pctx);
          if (!provider) continue;
          // "O'chirgich"dagi modellar o'tkaziladi; hammasi o'chiq va kaskad yo'q bo'lsa — baribir birinchisi
          const healthy = models.liveChain.filter((m) => !liveModelDown(m));
          const list = healthy.length ? healthy : (cascadeProvider ? [] : models.liveChain.slice(0, 1));
          for (const m of list) candidates.push({ kind: k, model: m, provider });
        } else if (cascadeProvider) {
          this.cascade = { kind: k, model: aiConfig.models.text, provider: cascadeProvider };
          candidates.push(this.cascade);
        }
      }
      if (!candidates.length) {
        this.failKind = 'not_configured';
        this.ev('error', { stage: 'open', message: 'no_provider' });
        return this.providerFailed();
      }
      const opened = await openFirstAvailable(candidates, base, this.deps.setupTimeoutMs,
        (kind, err, model) => {
          const k = kind === 'gemini_live' ? noteLiveFailure(model, err) : classifyVoiceError(err);
          this.failKind = k;
          this.ev('error', { stage: 'open', provider: kind, model, kind: k, message: err.message.slice(0, 200) });
        },
        {
          skip: (c, err, elapsed) => {
            if (!err) return false;
            const k = classifyVoiceError(err);
            // Kalit noto'g'ri / sozlanmagan — kaskad ham shu kalit bilan ishlaydi: behuda kutmaymiz
            if (k === 'auth' || k === 'not_configured') return true;
            if (c.kind !== 'gemini_live') return false;
            return elapsed > LIVE_BUDGET_MS || !worthNextModel(err);
          },
        });
      if (opened.kind === 'gemini_live') noteLiveOk(opened.model);
      this.failKind = null;
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
    if (this.state === 'ringing') { this.sendFailReason(); void this.end('error'); }
    return false;
  }

  /** Mijozga tushunarli sabab (kvota / sozlanmagan / ulanib bo'lmadi) — end'dan OLDIN. */
  private sendFailReason() {
    const code = failCodeFor(this.failKind || 'other');
    this.safeSend(AIV_SERVER_EVENTS.error, { code, message: FAIL_TEXT[code][this.lang] });
  }

  /**
   * Ovozli yo'l butunlay kvotada (kaskad transkripsiyasi ham) — mijozga sabab (ai_quota: "matn bilan davom
   * etamiz") va qo'ng'iroqni yopamiz; mijoz avtomatik AI chatiga (matnli rejim) o'tadi.
   */
  private toTextMode(kind: 'quota') {
    if (this.isOver()) return;
    this.failKind = kind;
    this.ev('error', { stage: 'text_mode', kind });
    this.sendFailReason();
    void this.end('error');
  }

  private attach(s: VoiceSession) {
    s.on('audioOut', (pcm) => { if (s === this.vs) this.onModelAudio(pcm); });
    s.on('transcript', (t) => { if (s === this.vs) this.onTranscript(t); });
    s.on('toolCall', (c) => { if (s === this.vs) void this.onToolCall(c); });
    s.on('interrupted', () => {
      this.stats.interruptions++;
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
      if (c.error && this.kind === 'gemini_live') noteLiveFailure(this.model, new Error(String(c.error)));
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
    this.startDurationTimers();
    const ok = await this.providerReady;
    if (this.state !== 'connecting') return;             // shu orada yakunlandi
    // Provayder umuman ochilmadi — suhbat bo'lmagan: yakun 'failed' (interrupted emas), sabab mijozga
    if (!ok || !this.vs) { this.answeredAt = undefined; this.sendFailReason(); await this.end('error'); return; }
    // ready — provayder TAYYOR bo'lgandagina (mijoz shu paytgacha "AI ulanmoqda" ko'radi)
    this.safeSend(AIV_SERVER_EVENTS.ready, {
      sessionId: this.sessionId, correlationId: this.correlationId, inputSampleRate: 16000, outputSampleRate: 24000, frameMs: 40, ptt: this.opts.ptt,
    });
    this.state = 'connected';
    await this.playDisclosure();
  }

  private async playDisclosure() {
    const text = this.disclosureText();
    // Ogohlantirish matni DARHOL ko'rinadi; klip qisqa kutiladi (isitilgan bo'lsa — keshdan bir zumda)
    // Owner 2026-10-19: yordamchi qo'ng'iroq — birinchi marta tanishtiruv, keyin ism bilan qisqa salom (model aytadi, bitta ovoz)
    // (clipOnLive — eski deterministik klip yo'li; faqat testlar/maxsus sozlama)
    if (this.purpose === 'assistant' && !this.deps.clipOnLive) {
      const firstTime = this.guest || !(await AiCallSession.exists({
        companyId: this.companyId, employeeId: this.employeeId, answeredAt: { $ne: null }, _id: { $ne: this.sessionId },
      }).catch(() => null));
      if (this.state !== 'connected' || !this.vs) return;
      this.disclosureDone = true;
      this.uplinkOpenAt = Date.now() + 1_500;
      this.ev('state', { state: 'disclosure', mode: firstTime ? 'intro' : 'greeting' });
      this.vs.sendText(greetingTurn(this.lang, { name: this.actorName, firstTime, disclosure: text, inbound: this.direction === 'inbound', reason: this.opts.requestText }));
      return;
    }
    this.safeSend(AIV_SERVER_EVENTS.transcript, { sessionId: this.sessionId, role: 'assistant', text, final: true });
    this.log.add('assistant', text);
    // Owner 2026-10-18: "ovoz ikki xil — biri yo'g'on, biri ingichka, baland-past". TTS klipining ovozi Gemini
    // Live ovozidan farq qiladi (boshqa model) — Live'da klip ISHLATILMAYDI: ogohlantirishni modelning o'zi
    // aytadi, butun suhbat bitta ovozda. Klip faqat kaskadda (u yerda ham TTS — ovoz bir xil).
    const clip = this.kind === 'gemini_live' && !this.deps.clipOnLive ? null
      : await this.deps.disclosure.getClip(this.clipReq(), this.deps.disclosureTimeoutMs).catch(() => null);
    if (this.state !== 'connected' || !this.vs) return;
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

  /** Pending amal so'ralgandan keyin foydalanuvchi aniq "ha" (accept) yoki "yo'q" degan bo'lsa — true. */
  private userSaidYesNo(accept: boolean): boolean {
    if (!this.lastPendingAt || this.lastUserAt <= this.lastPendingAt) return false;
    return pureYesNo(this.lastUserText) === accept;
  }

  // Kamera (owner 2026-10-18): kadrlar xotiraga (tool'lar uchun) va ~1 kadr/s Live modelga
  private visionOn = false;
  private lastVideoAt = 0;
  pushVideo(jpeg: Buffer): void {
    if (this.state !== 'connected' || !this.vs || !this.disclosureDone) return;
    pushFrame(this.sessionId, jpeg);
    if (!this.visionOn) {
      this.visionOn = true;
      // Javob so'ramasdan (silent): model endi ko'rishini biladi
      this.vs.sendText(`[TIZIM] Suhbatdosh kamerasini yoqdi. ${VISION_GUIDE}`, { silent: true });
    }
    const now = Date.now();
    if (this.vs.sendVideo && now - this.lastVideoAt >= 900) { this.lastVideoAt = now; this.vs.sendVideo(jpeg); }
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

  // Ovozli tasdiq tekshiruvi (audit 2026-10-19): oxirgi foydalanuvchi gapi va oxirgi pending amal vaqti
  private lastUserText = '';
  private lastUserAt = 0;
  private lastPendingAt = 0;

  private onTranscript(t: { role: 'user' | 'assistant'; text: string; final: boolean }) {
    if (this.state !== 'connected') return;
    if (t.role === 'user' && t.text) {
      // Bir navbat ichida bo'laklab keladi — yangi navbat (2 s jimlikdan keyin) bo'lsa matn qaytadan yig'iladi
      const now = Date.now();
      this.lastUserText = now - this.lastUserAt > 2_000 ? String(t.text) : `${this.lastUserText} ${t.text}`.slice(-200);
      this.lastUserAt = now;
    }
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
    try { this.transport.activity?.({ tool: name, phase: 'start' }); } catch { /* avatar — ixtiyoriy */ }
    let result: ToolResult;
    let pending: PendingActionInfo | undefined;
    let revoke = false;
    try {
      // B2: har chaqiruvda. Mehmon qo'ng'irog'i — uni boshlagan dasturchi hamon faol bo'lishi shart
      const ac = this.guest
        ? await loadDeveloperActor(this.employeeId).then((a) => (a ? { ok: true as const, actor: a } : { ok: false as const, code: 'denied' as const }))
        : await checkActor(this.employeeId, this.companyId);
      if (!ac.ok) {
        result = { status: 'denied', message: DENIED[this.lang], retryable: false };
        revoke = ac.code !== 'feature';
      } else if (!this.allowedTools.has(name)) {
        result = { status: 'denied', message: DENIED[this.lang], retryable: false };
      } else if (getTool(name)?.spokenConfirm && !this.userSaidYesNo((c.args || {}).accept === true)) {
        // XAVFSIZLIK (audit 2026-10-19): model o'zi "tasdiqladim" deya olmaydi — foydalanuvchi pending amal
        // so'ralgandan KEYIN aniq "ha"/"yo'q" degan bo'lishi shart (kaskad yo'lidagi qoida bilan bir xil)
        result = { status: 'error', retryable: true, message: this.lang === 'ru'
          ? 'Пользователь ещё не ответил «да» или «нет». Спросите его и дождитесь ответа.'
          : "Foydalanuvchi hali aniq «ha» yoki «yo'q» demadi. Undan so'rang va javobini kuting." };
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
    try { this.transport.activity?.({ tool: name, phase: 'end', status: result.status }); } catch { /* avatar — ixtiyoriy */ }
    if (pending || result.status === 'needs_confirmation') this.lastPendingAt = Date.now();
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
      if (why === 'closed' && !(await this.fallbackToCascade())) { this.sendFailReason(); await this.end('error'); }
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
      this.resuming = false;
      if (why === 'closed' && !(await this.fallbackToCascade())) { this.sendFailReason(); await this.end('error'); }
    } finally {
      this.resuming = false;
    }
  }

  /** Live suhbat o'rtasida yiqildi (kvota/uzilish) — qo'ng'iroqni uzmasdan kaskadga o'tamiz (bir marta). */
  private async fallbackToCascade(): Promise<boolean> {
    const c = this.cascade;
    if (!c || this.fellBack || this.kind !== 'gemini_live' || !this.openOpts || this.isOver() || this.state !== 'connected') return false;
    this.fellBack = true;
    this.resuming = true;
    const old = this.vs;
    try {
      const { resumptionHandle: _h, ...rest } = this.openOpts;
      const s = await openWithTimeout(c.provider, { ...rest, model: c.model }, this.deps.setupTimeoutMs);
      if (this.isOver()) { void s.close('ended'); return true; }
      this.vs = s; this.provider = c.provider; this.kind = c.kind; this.model = c.model;
      this.openOpts = { ...rest, model: c.model };
      this.pendingTools.clear();
      this.attach(s);
      this.ev('state', { state: 'fallback', to: c.kind });
      AiCallSession.updateOne({ _id: this.sessionId }, { $set: { provider: c.kind, modelId: c.model } }).catch(() => undefined);
      this.safeSend(AIV_SERVER_EVENTS.error, { code: 'ai_fallback', message: FALLBACK_NOTE[this.lang] });
      if (old && old !== s) void old.close('fallback');
      return true;
    } catch (e) {
      this.ev('error', { stage: 'fallback', message: (e as Error).message.slice(0, 200) });
      return false;
    } finally {
      this.resuming = false;
    }
  }

  // ───────────── Yakun ─────────────
  end(reason: AivEndReason): Promise<void> {
    if (!this.endPromise) {
      console.log(`[aiVoice] qo'ng'iroq statistikasi ${this.sessionId}: kanal=${this.opts.channel} bo'linishlar=${this.stats.interruptions} sabab=${reason}`);
    }
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
    clearVision(this.sessionId);
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
  private canCascade: () => boolean;

  constructor(deps: VoiceManagerDeps = {}) {
    const pf = deps.providerFor;
    this.canCascade = deps.canCascade || (pf ? () => !!pf('gemini_cascade', PROBE_CTX) : geminiConfigured);
    this.d = {
      providerFor: deps.providerFor || defaultProviderFor,
      disclosure: deps.disclosure || createDefaultDisclosure(),
      setupTimeoutMs: deps.setupTimeoutMs ?? 4_500,
      touchMs: deps.touchMs ?? LIMITS.sessionTouchMs,
      // Klip isitilgan bo'lsa bir zumda; bo'lmasa uzoq kutmaymiz — model ogohlantirishni o'zi aytadi
      disclosureTimeoutMs: deps.disclosureTimeoutMs ?? 1_500,
      clipOnLive: deps.clipOnLive ?? false,
    };
    this.offEnded = onSessionsEnded((list) => this.onExternalEnd(list));
  }

  get activeCount(): number { return this.sessions.size; }

  async start(opts: StartVoiceSessionOpts): Promise<StartVoiceSessionResult> {
    const fail = (reason: FailReason): StartVoiceSessionResult => ({ ok: false, reason });
    try {
      if (this.draining || !aiConfig.enabled) return fail('disabled');
      if (!opts?.companyId || !opts.employeeId || !opts.transport) return fail('error');
      let ac: { ok: true; actor: ActorState } | { ok: false };
      let settings: AiSettingsData;
      const now = new Date();
      if (opts.guest) {
        // Mehmon sinov qo'ng'irog'i: faqat platforma doirasida va faol dasturchi nomidan; firma byudjeti/sozlamasi yo'q
        if (opts.companyId !== PLATFORM_SCOPE || opts.channel !== 'telegram_call') return fail('error');
        const dev = await loadDeveloperActor(opts.employeeId);
        if (!dev) return fail('denied');
        ac = { ok: true, actor: dev };
        settings = platformSettings();
      } else {
        if (!(await isAiActive(opts.companyId))) return fail('disabled');
        ac = await checkActor(opts.employeeId, opts.companyId);
        if (!ac.ok) return fail('denied');
        if (await budgetExceeded(opts.companyId)) return fail('budget');
        settings = await getSettings(opts.companyId);
        if (await companyMinutesExceeded(opts.companyId, settings, now)) return fail('limit');
      }
      let cap = await liveCapacity(opts.companyId, settings.calls.companyConcurrency);
      // Semafor "osilib" qolmasin (jarayon qulagan / Render uyqusi): eskirgan begona sessiyalarni yopib qayta tekshiramiz
      if (!cap.ok && (await this.reclaimOrphans(cap.reason === 'company_cap' ? { companyId: opts.companyId } : {}))) {
        cap = await liveCapacity(opts.companyId, settings.calls.companyConcurrency);
      }
      // Foydalanuvchi o'zi qo'ng'iroq qilganda (ilova, assistant) Live semafori to'lsa — "limit" emas, kaskad
      // (u Live sessiya kvotasini band qilmaydi). Rejali qo'ng'iroqlar (A6) esa kutadi — o'zgarmagan.
      const userCall = opts.purpose === 'assistant' && opts.channel === 'inapp_call';
      let liveBlocked = false;
      if (!cap.ok && cap.reason === 'platform_cap' && userCall && this.canCascade()) {
        if ((await countActiveSessions({ companyId: opts.companyId })) >= settings.calls.companyConcurrency) return fail('company_cap');
        liveBlocked = true;
      } else if (!cap.ok) return fail(cap.reason || 'platform_cap');

      const limits = {
        ringTimeoutSec: Math.max(0, Math.round(opts.ringTimeoutSec ?? settings.calls.ringTimeoutSec)),
        maxDurationSec: Math.max(1, Math.round(opts.maxDurationSec ?? (opts.purpose === 'assistant' ? settings.calls.assistantMaxDurationSec : settings.calls.maxDurationSec))),
      };
      let doc: any;
      const create = () => AiCallSession.create({
          companyId: opts.companyId, employeeId: opts.employeeId, correlationId: opts.correlationId || newCorrelationId(),
          ...(opts.attemptKey ? { attemptKey: opts.attemptKey } : {}),
          purpose: opts.purpose, channel: opts.channel,
          direction: (opts.userInitiated ?? (opts.purpose === 'assistant' && opts.channel === 'inapp_call')) ? 'inbound' : 'outbound',
          status: opts.channel === 'telegram_call' ? 'dialing' : 'ringing', isActive: true,
          attemptNo: opts.attemptNo ?? 1, jobId: opts.jobId, confirmationId: opts.confirmationId,
          provider: liveBlocked ? 'gemini_cascade' : settings.provider.primary, instanceId: INSTANCE_ID, workerInstanceId: opts.workerInstanceId, socketId: opts.socketId,
          limits, startedAt: now, ringingAt: now,
      });
      const isBusyErr = (e: any) => e?.code === 11000 && (e?.keyPattern?.employeeId || /employeeId|one_active_call/.test(String(e?.message)));
      try {
        try { doc = await create(); } catch (e: any) {
          // Band — lekin eski sessiya eskirgan bo'lsa (yangilanmayapti) uni yopib bir marta qayta urinamiz
          if (!isBusyErr(e) || !(await this.reclaimOrphans({ employeeId: opts.employeeId }))) throw e;
          doc = await create();
        }
      } catch (e: any) {
        if (isBusyErr(e)) return fail('busy');
        console.error('[aiVoice] sessiya yaratilmadi:', e?.message);
        return fail('error');
      }
      // Poyga: count → insert atomik emas. Faol sessiyalar tartibida o'rnimiz chegaradan oshsa — izsiz chekinamiz
      const over = await this.overCap(String(doc._id), opts.companyId, settings, liveBlocked);
      if (over === 'platform_cap' && userCall && this.canCascade()) {
        liveBlocked = true;
        await AiCallSession.updateOne({ _id: doc._id }, { $set: { provider: 'gemini_cascade' } }).catch(() => undefined);
      } else if (over) {
        await AiCallSession.deleteOne({ _id: doc._id }).catch(() => undefined);
        return fail(over);
      }
      const s = new ManagedVoiceSession(this, this.d, opts, settings, (ac as { actor: ActorState }).actor, doc, limits);
      s.liveBlocked = liveBlocked;
      this.sessions.set(s.sessionId, s);
      this.byCorrelation.set(s.correlationId, s.sessionId);
      s.init();
      return { ok: true, handle: s };
    } catch (e) {
      console.error('[aiVoice] ovozli sessiya boshlanmadi:', (e as Error).message);
      return fail('error');
    }
  }

  /**
   * Qo'ng'iroqdan oldin isitish: disclosure klipini (TTS) keshga render qiladi — ulanishda ogohlantirish
   * darhol ijro etilsin. Hech narsa yubormaydi, xato jim. Kesh firma + til + ovoz + matn bo'yicha (bitta TTS).
   */
  async prewarm(companyId: string, userId: string): Promise<void> {
    try {
      if (this.draining || !aiConfig.enabled || !companyId || !userId) return;
      if (!(await isAiActive(companyId))) return;
      const settings = await getSettings(companyId);
      if (settings.provider.primary === 'gemini_live' && !this.d.clipOnLive) return;      // Live'da klip yo'q (bitta ovoz)
      const [lang, st] = await Promise.all([resolveVoiceLang(companyId, userId, settings), getCompanyAiState(companyId)]);
      await this.d.disclosure.getClip({
        text: disclosureTextFor(lang, st.name, settings.disclosureText), lang, voiceName: settings.voiceName,
        model: settings.provider.ttsModel || aiConfig.models.tts,
      }, 15_000);
    } catch { /* isitish — majburiy emas */ }
  }

  /**
   * Shu jarayonda bo'lmagan va 45 s+ (3 × touch) yangilanmagan faol sessiyalar — o'lik (egasi har 15 s
   * yangilaydi). Ularni 'interrupted' qilamiz (shartli — tirik sessiyaga tegmaydi). Yopilganlar soni.
   */
  private async reclaimOrphans(filter: Record<string, unknown>): Promise<number> {
    try {
      const staleBefore = new Date(Date.now() - Math.max(45_000, this.d.touchMs * 3));
      const docs: any[] = await AiCallSession.find({ ...filter, isActive: true, updatedAt: { $lt: staleBefore } }).select('_id').limit(50).lean();
      const ids = docs.map((d) => String(d._id)).filter((id) => !this.sessions.has(id));
      if (!ids.length) return 0;
      const ended = await endActiveSessions({ _id: { $in: ids }, updatedAt: { $lt: staleBefore } }, 'interrupted', 'orphan_reclaim');
      if (ended.length) console.warn(`[aiVoice] ${ended.length} ta osilgan sessiya yopildi (orphan_reclaim)`);
      return ended.length;
    } catch (e) {
      console.error('[aiVoice] orphan reclaim xatosi:', (e as Error).message);
      return 0;
    }
  }

  private async overCap(id: string, companyId: string, s: AiSettingsData, liveBlocked = false): Promise<'platform_cap' | 'company_cap' | null> {
    const active: any[] = await AiCallSession.find({ isActive: true }).sort({ createdAt: 1, _id: 1 }).select('_id companyId provider').limit(1000).lean();
    if (!liveBlocked) {
      // Live semafori faqat Live sessiyalarni sanaydi (kaskaddagilar Live kvotasini band qilmaydi)
      const pIdx = active.filter((a) => a.provider !== 'gemini_cascade' || String(a._id) === id).findIndex((a) => String(a._id) === id);
      if (pIdx >= aiConfig.liveMaxConcurrent) return 'platform_cap';
    }
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
