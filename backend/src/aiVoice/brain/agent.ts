import { randomUUID } from 'crypto';
import type {
  PendingActionInfo, TextAgent, TextAgentInput, TextAgentOutput, TextProviderName, ToolCtx, ToolResult, ToolStatus,
} from '../contracts';
import AiActionAudit from '../../models/AiActionAudit';
import { checkActor } from '../actor';
import { aiConfig } from '../config';
import { isObjectIdString } from '../lib/ids';
import { buildPlatformSystemPrompt, loadDeveloperActor, PLATFORM_SCOPE, platformSettings, platformStatus } from '../platform';
import { sha256Hex } from '../lib/crypto';
import { zonedParts } from '../lib/zonedTime';
import { costFromUsd, costUsdMicros } from '../pricing';
import { getCompanyAiState, getSettings, isAiActive } from '../settings';
import { budgetExceeded, recordTextUsage } from '../usage';
import { confirmPendingAction, executeTool, type ExecuteOutcome } from '../tools/executor';
import { effectiveToolNames, generalToolNames } from '../tools/rbac';
import { getTool, toolDeclarations } from '../tools/registry';
import { registerErpTools } from '../tools/erp';
import { promptObjects } from '../tools/erp/common';
import { resolveTextProviderOrder } from './providerOrder';
import { quotaKindOf, quotaMessage, type QuotaKind } from './quota';
import { capToolResult, decisionKindOf, explicitDecision } from './toolPolicy';
import { buildSystemPrompt, isVoiceChannel } from './systemPrompt';
import { askedToConfirm, pureYesNo, stripRepeatedGreeting } from './style';
import { createClaudeProvider } from './providers/claude';
import { createGeminiProvider } from './providers/gemini';
import { createOpenRouterProvider, createGroqProvider } from './providers/openrouter';
import { errorCode, type ProviderCall, type ProviderSession, type ProviderToolResult, type TextProvider } from './providers/types';

// ErpTextAgent — TextAgent'ning haqiqiy amalga oshirilishi (llm-provider.md):
//  Gemini (asosiy) → OpenRouter (zaxira) → ixtiyoriy Claude (faqat kalit bo'lsa va tanlansa, birinchi).
//  • AI faqat AI_VOICE_ENABLED + firma sozlamasi + tarif bo'lsa ishlaydi (aks holda model chaqirilmaydi);
//  • ≤5 tool raund, har so'rovga AbortSignal vaqt chegarasi, umumiy chegara;
//  • tool'lar FAQAT executeTool orqali (RBAC, tasdiq, audit, redaksiya); yozuv tool'lariga
//    idempotencyKey — provayder almashsa ham amal ikki marta bajarilmaydi;
//  • sarf recordTextUsage bilan har navbatda hisoblanadi;
//  • "muvaffaqiyat" da'vosi qo'riqchisi: yozuv tool'i status=ok qaytarmagan bo'lsa, modelning
//    "yaratildi/yuborildi" kabi so'zlari server tomonidagi haqiqiy natija bilan almashtiriladi.

const MSG = {
  disabled: { uz: "AI yordamchi o'chirilgan yoki siz uchun mavjud emas.", ru: 'AI-помощник отключён или недоступен для вас.' },
  notReady: { uz: "AI yordamchi hali sozlanmagan. Keyinroq urinib ko'ring.", ru: 'AI-помощник ещё не настроен. Попробуйте позже.' },
  budget: { uz: 'AI limiti tugagan. Rahbaringizga murojaat qiling.', ru: 'Лимит AI исчерпан. Обратитесь к руководителю.' },
  failed: { uz: "Kechirasiz, AI yordamchi hozir javob bera olmayapti. Birozdan keyin qayta urinib ko'ring.", ru: 'Извините, AI-помощник сейчас не может ответить. Попробуйте чуть позже.' },
  rounds: { uz: "So'rov juda ko'p bosqich talab qildi — iltimos, aniqroq qilib so'rang.", ru: 'Запрос потребовал слишком много шагов — уточните, пожалуйста.' },
  refusal: { uz: "Kechirasiz, bu so'rov bo'yicha yordam bera olmayman.", ru: 'Извините, с этим запросом я помочь не могу.' },
  noAction: { uz: 'Hech qanday amal bajarilmadi.', ru: 'Никакое действие не выполнено.' },
  confirm: { uz: "Tasdiqlash kerak — pastdagi tugmani bosing yoki «ha» deb yozing. Hali bajarilmadi", ru: 'Нужно подтверждение — нажмите кнопку ниже или напишите «да». Ещё не выполнено' },
  confirmVoice: { uz: "Tasdiqlash kerak — «ha» yoki «yo'q» deng. Hali bajarilmadi", ru: 'Нужно подтверждение — скажите «да» или «нет». Ещё не выполнено' },
  noPending: { uz: "Tasdiq kutayotgan amal yo'q yoki muddati o'tgan.", ru: 'Нет действия, ожидающего подтверждения, или срок истёк.' },
  spokenOnly: {
    uz: "Tasdiq uchun foydalanuvchining aniq «ha» yoki «yo'q» javobi kerak. Bajarilmadi — so'rang.",
    ru: 'Для подтверждения нужен явный ответ «да» или «нет». Не выполнено — спросите.',
  },
  badArgs: { uz: "Tool argumentlari noto'g'ri (JSON emas) — amal bajarilmadi.", ru: 'Неверные аргументы инструмента (не JSON) — действие не выполнено.' },
  unknownTool: { uz: "Bunday tool yo'q yoki ruxsat etilmagan.", ru: 'Такого инструмента нет или он не разрешён.' },
  perRound: { uz: "Bir navbatda juda ko'p tool chaqirildi — qolganlari bajarilmadi.", ru: 'Слишком много вызовов за один шаг — остальные не выполнены.' },
  needExplicit: {
    uz: "Bu qaror uchun foydalanuvchining aniq buyrug'i kerak (masalan: \"tasdiqla\" yoki \"rad et\"). Bajarilmadi — foydalanuvchidan so'rang.",
    ru: 'Для этого решения нужна явная команда пользователя («утверди» или «отклони»). Не выполнено — спросите пользователя.',
  },
};
type Lang = 'uz' | 'ru';
const m = (k: keyof typeof MSG, lang: Lang) => MSG[k][lang];

/** Yozuv amali muvaffaqiyatini bildiruvchi so'zlar (uz/ru). */
export const SUCCESS_CLAIM_RE = /\b(yaratildi|yuborildi|saqlandi|bajarildi|o['ʻ’`]?chirildi|bekor qilindi|o['ʻ’`]?zgartirildi|yangilandi|qo['ʻ’`]?shildi|qo['ʻ’`]?yildi|belgilandi)\b|создан|отправлен|сохранен|сохранён|выполнен|отменен|отменён|изменен|изменён|обновлен|обновлён|удален|удалён|добавлен|поставлен/i;

const MAX_CALLS_PER_ROUND = 8;
/** Matnli "ha" faqat shu oynadagi (yangi) tasdiqqa tegishli. */
const QUICK_CONFIRM_WINDOW_MS = 15 * 60_000;

export interface ErpTextAgentDeps {
  /** Provayderlarni almashtirish (testlar: soxta Gemini mijozi / soxta fetch). */
  providers?: Partial<Record<TextProviderName, TextProvider>>;
  /** Qaysi provayderlar sozlangan (standart — env'dan). */
  env?: { gemini: boolean; openrouter: boolean; claude: boolean; groq?: boolean };
  /** Butun run() uchun vaqt chegarasi (ms). */
  totalTimeoutMs?: number;
}

interface RunState {
  toolCalls: TextAgentOutput['toolCalls'];
  pendingActions: PendingActionInfo[];
  writeStatuses: { name: string; status: ToolStatus; message: string }[];
  /** Provayder kvotasi (eng og'iri: daily > minute) — hamma provayder yiqilsa foydalanuvchiga aytiladi. */
  quota: QuotaKind | null;
  userText: string;
  history: { role: 'user' | 'assistant'; text: string }[];
  channel: ToolCtx['channel'];
  usage: { tokensIn: number; tokensOut: number; costUsdMicros: number; model: string; provider: TextProviderName | 'none' };
}

export class ErpTextAgent implements TextAgent {
  private providers: Partial<Record<TextProviderName, TextProvider>>;
  constructor(private deps: ErpTextAgentDeps = {}) {
    this.providers = {
      gemini: deps.providers?.gemini || createGeminiProvider(),
      groq: deps.providers?.groq || createGroqProvider(),
      openrouter: deps.providers?.openrouter || createOpenRouterProvider(),
      claude: deps.providers?.claude || createClaudeProvider(),
    };
  }

  async run(input: TextAgentInput): Promise<TextAgentOutput> {
    const lang: Lang = input?.ctx?.lang === 'ru' ? 'ru' : 'uz';
    const st: RunState = {
      toolCalls: [], pendingActions: [], writeStatuses: [], quota: null, userText: '', history: [], channel: input?.ctx?.channel || 'web',
      usage: { tokensIn: 0, tokensOut: 0, costUsdMicros: 0, model: 'none', provider: 'none' },
    };
    const reply = (text: string): TextAgentOutput => ({
      text, toolCalls: st.toolCalls, pendingActions: st.pendingActions,
      usage: { model: st.usage.model, tokensIn: st.usage.tokensIn, tokensOut: st.usage.tokensOut, provider: st.usage.provider, costUsdMicros: st.usage.costUsdMicros },
    });

    const ctx0 = input?.ctx;
    const userText = typeof input?.userText === 'string' ? input.userText.trim().slice(0, 4000) : '';
    if (!ctx0?.userId) return reply(m('disabled', lang));
    // Firmasiz kontekst — faqat dasturchi (platforma rejimi: umumiy yordamchi + platforma holati)
    if (!isObjectIdString(ctx0.companyId)) return this.runPlatform(input, userText, st, lang, reply);
    // AI o'chiq bo'lsa — model ham, tool ham chaqirilmaydi
    if (!(await isAiActive(ctx0.companyId))) return reply(m('disabled', lang));
    const ac = await checkActor(ctx0.userId, ctx0.companyId);
    if (!ac.ok) return reply(m('disabled', lang));
    if (!userText) return reply(m('failed', lang));
    st.userText = userText;
    st.history = Array.isArray(input.history) ? input.history : [];
    if (await budgetExceeded(ctx0.companyId)) return reply(m('budget', lang));

    registerErpTools();                                         // idempotent
    const settings = await getSettings(ctx0.companyId);
    const order = resolveTextProviderOrder(settings.brain, this.deps.env);
    if (!order.length) return reply(m('notReady', lang));

    const actor = ac.actor;
    const ctx: ToolCtx = {
      ...ctx0, role: (actor.isOwner ? 'direktor' : actor.role) as ToolCtx['role'], isOwner: actor.isOwner, tz: 'Asia/Tashkent', lang,
    };
    // #4: sof "ha"/"yo'q" — AI so'ragan tasdiqni SHU joyning o'zida hal qiladi (model chaqirilmaydi)
    const yn = pureYesNo(userText);
    if (yn !== null) {
      const quick = await this.quickConfirm(ctx, yn, st, lang);
      if (quick) return reply(quick);
    }
    const allowed = effectiveToolNames(settings, actor.role, actor.isOwner, { channel: ctx.channel, purpose: ctx.purpose });
    const tools = toolDeclarations(allowed, lang);
    const [company, objects] = await Promise.all([
      getCompanyAiState(ctx.companyId),
      promptObjects(ctx).catch(() => ({ names: [] as string[], total: 0 })),
    ]);
    const now = zonedParts(new Date());
    const system = buildSystemPrompt({
      lang, companyName: company.name, userName: actor.name, role: actor.role, isOwner: actor.isOwner,
      channel: ctx.channel, today: now.date, weekday: now.isoWeekday, time: now.hhmm,
      objects: objects.names, objectsTotal: objects.total, toolNames: allowed,
      persona: settings.persona, voiceName: settings.voiceName,
    });

    return this.drive(order, { system, tools, ctx, allowed, input, userText, settings }, st, lang, reply);
  }

  /** Dasturchi (firmasiz): faqat umumiy tool'lar, platforma prompti, platforma chegaralari. */
  private async runPlatform(
    input: TextAgentInput, userText: string, st: RunState, lang: Lang, reply: (t: string) => TextAgentOutput,
  ): Promise<TextAgentOutput> {
    const ctx0 = input.ctx;
    const dev = await loadDeveloperActor(ctx0.userId);
    if (!dev || !aiConfig.enabled) return reply(m('disabled', lang));
    if (!userText) return reply(m('failed', lang));
    st.userText = userText;
    st.history = Array.isArray(input.history) ? input.history : [];
    registerErpTools();
    const settings = platformSettings();
    const order = resolveTextProviderOrder(settings.brain, this.deps.env);
    if (!order.length) return reply(m('notReady', lang));
    const ctx: ToolCtx = { ...ctx0, companyId: PLATFORM_SCOPE, role: 'dasturchi' as ToolCtx['role'], isOwner: false, tz: 'Asia/Tashkent', lang };
    const allowed = generalToolNames({ channel: ctx.channel, purpose: ctx.purpose });
    const tools = toolDeclarations(allowed, lang);
    const now = zonedParts(new Date());
    const status = await platformStatus().catch(() => ({ aiEnabled: aiConfig.enabled, companiesWithAi: 0, account: 'unknown', workerOnline: false }));
    const system = buildPlatformSystemPrompt({ lang, userName: dev.name, today: now.date, time: now.hhmm, status, channel: ctx.channel });
    return this.drive(order, { system, tools, ctx, allowed, input, userText, settings }, st, lang, reply);
  }

  /** Provayderlar zanjiri (asosiy → zaxira): tool raundlari, kvota va himoya. */
  private async drive(
    order: TextProviderName[],
    a: { system: string; tools: ReturnType<typeof toolDeclarations>; ctx: ToolCtx; allowed: string[]; input: TextAgentInput; userText: string; settings: { brain: any; provider: any } },
    st: RunState, lang: Lang, reply: (t: string) => TextAgentOutput,
  ): Promise<TextAgentOutput> {
    const { system, tools, ctx, allowed, input, userText, settings } = a;
    const runId = randomUUID();
    const maxRounds = Math.max(0, Math.min(5, input.maxToolRounds ?? 5));
    const deadline = AbortSignal.timeout(this.deps.totalTimeoutMs ?? 90_000);
    const outer = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;

    for (const name of order) {
      const provider = this.providers[name];
      if (!provider) continue;
      if (outer.aborted) break;
      try {
        const session = provider.start({ system, history: input.history || [], userText, tools, effort: settings.brain.effort, model: settings.provider.textModel });
        const text = await this.loop(provider, session, ctx, allowed, runId, maxRounds, outer, st, lang);
        return reply(this.guard(text, st, lang));
      } catch (e) {
        if (input.signal?.aborted) break;
        const qk = quotaKindOf(e);
        if (qk && st.quota !== 'daily') st.quota = qk;
        console.warn(`[aiVoice] matn provayderi ${name} xatosi: ${errorCode(e)} — keyingisiga o'tiladi`);
      }
    }
    const base = st.quota ? quotaMessage(st.quota, lang) : m('failed', lang);
    return reply(st.writeStatuses.length ? `${base}\n${this.factual(st, lang)}` : base);
  }

  /**
   * Matnli/ovozli kaskaddagi sof "ha"/"yo'q": AI oxirgi javobida tasdiq so'ragan bo'lsa — SHU kanaldagi
   * eng yangi kutilayotgan amal (shu foydalanuvchi, ≤15 daqiqa; sessiya bo'lsa — shu sessiya) hal qilinadi.
   * Bu foydalanuvchining O'Z matni (model emas) — B3 bilan mos. Mos amal bo'lmasa null (oddiy suhbat).
   */
  private async quickConfirm(ctx: ToolCtx, accept: boolean, st: RunState, lang: Lang): Promise<string | null> {
    const lastAi = [...st.history].reverse().find((h) => h?.role === 'assistant');
    if (!lastAi || !askedToConfirm(lastAi.text)) return null;
    const now = Date.now();
    const filter: Record<string, unknown> = {
      companyId: String(ctx.companyId), actorUserId: String(ctx.userId), status: 'needs_confirmation',
      'pending.channel': ctx.channel === 'telegram_call' ? 'bot' : ctx.channel,
      'pending.expiresAt': { $gt: new Date(now) }, createdAt: { $gt: new Date(now - QUICK_CONFIRM_WINDOW_MS) },
    };
    if (ctx.sessionId) filter.sessionId = ctx.sessionId;
    const row: any = await AiActionAudit.findOne(filter).sort({ createdAt: -1 }).select('_id').lean().catch(() => null);
    if (!row) return null;
    const out = await confirmPendingAction({
      pendingActionId: String(row._id), actorUserId: ctx.userId, companyId: ctx.companyId, channel: ctx.channel, accept, lang,
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    });
    const r = out.result;
    st.toolCalls.push({ name: 'confirm', status: r.status, message: r.message });
    if (r.status === 'ok') return accept ? `✅ ${r.message}` : r.message;
    return r.message || m('noPending', lang);
  }

  private async loop(
    provider: TextProvider, session: ProviderSession, ctx: ToolCtx, allowed: string[], runId: string,
    maxRounds: number, outer: AbortSignal, st: RunState, lang: Lang,
  ): Promise<string> {
    for (let round = 0; ; round++) {
      const signal = AbortSignal.any([outer, AbortSignal.timeout(provider.requestTimeoutMs)]);
      const turn = await session.next(signal);
      await this.meter(provider.name, ctx, turn.model, turn.usage, st);
      if (turn.refusal) return m('refusal', lang);
      if (!turn.calls.length) return turn.text || (turn.truncated ? m('failed', lang) : '');
      if (round >= maxRounds) return turn.text ? `${turn.text}\n${m('rounds', lang)}` : m('rounds', lang);

      // Tezlik: o'qish tool'lari parallel; yozuvlar ketma-ket (tartib va idempotentlik uchun).
      // Natijalar har doim modelning chaqiruv tartibida yoziladi.
      const done = new Map<number, ToolResult>();
      const calls = turn.calls.slice(0, MAX_CALLS_PER_ROUND);
      const isRead = (c: ProviderCall) => !c.argsError && getTool(c.name)?.kind === 'read' && allowed.includes(c.name);
      await Promise.all(calls.map(async (c, i) => { if (isRead(c)) done.set(i, await this.execOne(c, ctx, allowed, runId, st, lang)); }));
      for (const [i, c] of calls.entries()) if (!done.has(i)) done.set(i, await this.execOne(c, ctx, allowed, runId, st, lang));
      const results: ProviderToolResult[] = turn.calls.map((call, i) => ({
        id: call.id, name: call.name,
        result: capToolResult(done.get(i) ?? { status: 'error' as const, message: m('perRound', lang), retryable: false }),
      }));
      for (const [i, call] of turn.calls.entries()) {
        const r = results[i].result;
        st.toolCalls.push({ name: call.name.slice(0, 64), status: r.status, message: r.message });
      }
      session.addToolResults(results);
    }
  }

  private async execOne(call: ProviderCall, ctx: ToolCtx, allowed: string[], runId: string, st: RunState, lang: Lang): Promise<ToolResult> {
    let result: ToolResult;
    let outcome: ExecuteOutcome | undefined;
    const def = getTool(call.name);
    const decision = decisionKindOf(call.name);
    if (call.argsError) result = { status: 'error', message: m('badArgs', lang), retryable: false };
    else if (!def || !allowed.includes(call.name)) result = { status: 'denied', message: m('unknownTool', lang), retryable: false };
    else if (def.ownDecision && (!decision || !explicitDecision(decision, st.userText, st.history))) {
      result = { status: 'error', message: m('needExplicit', lang), retryable: false };
    } else if (def.spokenConfirm && pureYesNo(st.userText) !== ((call.args as any)?.accept === true)) {
      // Kaskadda foydalanuvchining so'zi bor — model "ha"ni o'zi to'qiy olmaydi
      result = { status: 'error', message: m('spokenOnly', lang), retryable: false };
    } else {
      const explicitUserDecision = !!def.ownDecision;      // yuqorida tekshirildi
      // Yozuvlar uchun idempotentlik: shu run ichida bir xil chaqiruv (yoki provayder almashganda) — bir marta
      const idempotencyKey = def.kind === 'write'
        ? `aiv:${runId}:${sha256Hex(`${call.name}|${JSON.stringify(call.args)}`).slice(0, 24)}` : undefined;
      try {
        outcome = await executeTool(ctx, call.name, call.args, { idempotencyKey, explicitUserDecision });
        result = outcome.result;
      } catch (e) {
        console.error(`[aiVoice] executeTool ${call.name} kutilmagan xato:`, (e as Error)?.message);
        result = { status: 'error', message: m('failed', lang), retryable: false };
      }
    }
    if (outcome?.pending && !st.pendingActions.some((p) => p.pendingActionId === outcome!.pending!.pendingActionId)) {
      st.pendingActions.push(outcome.pending);
    }
    if (def?.kind === 'write' || call.argsError) st.writeStatuses.push({ name: call.name, status: result.status, message: result.message });
    return result;
  }

  private async meter(provider: TextProviderName, ctx: ToolCtx, model: string, u: { tokensIn: number; tokensOut: number; cacheReadTokens?: number; costUsd?: number }, st: RunState) {
    st.usage.tokensIn += u.tokensIn || 0;
    st.usage.tokensOut += u.tokensOut || 0;
    st.usage.model = model;
    st.usage.provider = provider;
    st.usage.costUsdMicros += typeof u.costUsd === 'number'
      ? costFromUsd(u.costUsd)
      : costUsdMicros(model, { tokensIn: u.tokensIn, tokensOut: u.tokensOut, cacheReadTokens: u.cacheReadTokens });
    await recordTextUsage(
      { companyId: ctx.companyId, userId: ctx.userId, provider, model },
      { tokensIn: u.tokensIn, tokensOut: u.tokensOut, cacheReadTokens: u.cacheReadTokens, costUsd: u.costUsd },
    ).catch(() => undefined);
  }

  /** Server tomonidagi haqiqiy natijalar (model so'zi emas). */
  private factual(st: RunState, lang: Lang): string {
    if (!st.writeStatuses.length) return m('noAction', lang);
    return st.writeStatuses.map((w) => {
      if (w.status === 'ok') return `✅ ${w.message}`;
      if (w.status === 'needs_confirmation') return `⏳ ${this.confirmHint(st, lang)}.`;
      return `❌ ${w.message}`;
    }).join('\n');
  }

  /** Muvaffaqiyat da'vosi qo'riqchisi + tasdiq eslatmasi (A7/B3: model natijadan oldin "bajarildi" demasin). */
  private guard(text: string, st: RunState, lang: Lang): string {
    const anyOk = st.writeStatuses.some((w) => w.status === 'ok');
    const anyNotOk = st.writeStatuses.some((w) => w.status !== 'ok');
    let out = (text || '').trim();
    if (out && SUCCESS_CLAIM_RE.test(out) && (!anyOk || anyNotOk)) out = this.factual(st, lang);
    if (!out) out = st.writeStatuses.length ? this.factual(st, lang) : m('failed', lang);
    // #1: salom suhbat boshida bir marta (bot/qo'ng'iroq kirishi yoki tarixda AI javobi bor bo'lsa — takrorlanmaydi)
    if (st.channel !== 'web' || st.history.some((h) => h?.role === 'assistant')) out = stripRepeatedGreeting(out, st.userText);
    if (st.pendingActions.length && !/tasdiq|подтвер/i.test(out)) out += `\n⏳ ${this.confirmHint(st, lang)}.`;
    return out;
  }

  private confirmHint(st: RunState, lang: Lang): string {
    return m(isVoiceChannel(st.channel) ? 'confirmVoice' : 'confirm', lang);
  }
}
