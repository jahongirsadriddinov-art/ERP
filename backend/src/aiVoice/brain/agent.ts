import { randomUUID } from 'crypto';
import type {
  PendingActionInfo, TextAgent, TextAgentInput, TextAgentOutput, TextProviderName, ToolCtx, ToolResult, ToolStatus,
} from '../contracts';
import { checkActor } from '../actor';
import { sha256Hex } from '../lib/crypto';
import { zonedParts } from '../lib/zonedTime';
import { costFromUsd, costUsdMicros } from '../pricing';
import { getCompanyAiState, getSettings, isAiActive } from '../settings';
import { budgetExceeded, recordTextUsage } from '../usage';
import { executeTool, type ExecuteOutcome } from '../tools/executor';
import { effectiveToolNames } from '../tools/rbac';
import { getTool, toolDeclarations } from '../tools/registry';
import { registerErpTools } from '../tools/erp';
import { resolveTextProviderOrder } from './providerOrder';
import { buildSystemPrompt } from './systemPrompt';
import { createClaudeProvider } from './providers/claude';
import { createGeminiProvider } from './providers/gemini';
import { createOpenRouterProvider } from './providers/openrouter';
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
  confirm: { uz: 'Tasdiqlash kerak — tugmani bosing. Hali bajarilmadi', ru: 'Нужно подтверждение — нажмите кнопку. Ещё не выполнено' },
  badArgs: { uz: "Tool argumentlari noto'g'ri (JSON emas) — amal bajarilmadi.", ru: 'Неверные аргументы инструмента (не JSON) — действие не выполнено.' },
  unknownTool: { uz: "Bunday tool yo'q yoki ruxsat etilmagan.", ru: 'Такого инструмента нет или он не разрешён.' },
  perRound: { uz: "Bir navbatda juda ko'p tool chaqirildi — qolganlari bajarilmadi.", ru: 'Слишком много вызовов за один шаг — остальные не выполнены.' },
};
type Lang = 'uz' | 'ru';
const m = (k: keyof typeof MSG, lang: Lang) => MSG[k][lang];

/** Yozuv amali muvaffaqiyatini bildiruvchi so'zlar (uz/ru). */
export const SUCCESS_CLAIM_RE = /\b(yaratildi|yuborildi|saqlandi|bajarildi|o['ʻ’`]?chirildi|bekor qilindi|o['ʻ’`]?zgartirildi|yangilandi|qo['ʻ’`]?shildi|qo['ʻ’`]?yildi|belgilandi)\b|создан|отправлен|сохранен|сохранён|выполнен|отменен|отменён|изменен|изменён|обновлен|обновлён|удален|удалён|добавлен|поставлен/i;

const MAX_CALLS_PER_ROUND = 8;

export interface ErpTextAgentDeps {
  /** Provayderlarni almashtirish (testlar: soxta Gemini mijozi / soxta fetch). */
  providers?: Partial<Record<TextProviderName, TextProvider>>;
  /** Qaysi provayderlar sozlangan (standart — env'dan). */
  env?: { gemini: boolean; openrouter: boolean; claude: boolean };
  /** Butun run() uchun vaqt chegarasi (ms). */
  totalTimeoutMs?: number;
}

interface RunState {
  toolCalls: TextAgentOutput['toolCalls'];
  pendingActions: PendingActionInfo[];
  writeStatuses: { name: string; status: ToolStatus; message: string }[];
  usage: { tokensIn: number; tokensOut: number; costUsdMicros: number; model: string; provider: TextProviderName | 'none' };
}

export class ErpTextAgent implements TextAgent {
  private providers: Partial<Record<TextProviderName, TextProvider>>;
  constructor(private deps: ErpTextAgentDeps = {}) {
    this.providers = {
      gemini: deps.providers?.gemini || createGeminiProvider(),
      openrouter: deps.providers?.openrouter || createOpenRouterProvider(),
      claude: deps.providers?.claude || createClaudeProvider(),
    };
  }

  async run(input: TextAgentInput): Promise<TextAgentOutput> {
    const lang: Lang = input?.ctx?.lang === 'ru' ? 'ru' : 'uz';
    const st: RunState = {
      toolCalls: [], pendingActions: [], writeStatuses: [],
      usage: { tokensIn: 0, tokensOut: 0, costUsdMicros: 0, model: 'none', provider: 'none' },
    };
    const reply = (text: string): TextAgentOutput => ({
      text, toolCalls: st.toolCalls, pendingActions: st.pendingActions,
      usage: { model: st.usage.model, tokensIn: st.usage.tokensIn, tokensOut: st.usage.tokensOut, provider: st.usage.provider, costUsdMicros: st.usage.costUsdMicros },
    });

    const ctx0 = input?.ctx;
    const userText = typeof input?.userText === 'string' ? input.userText.trim().slice(0, 4000) : '';
    // AI o'chiq bo'lsa — model ham, tool ham chaqirilmaydi
    if (!ctx0?.companyId || !ctx0?.userId || !(await isAiActive(ctx0.companyId))) return reply(m('disabled', lang));
    const ac = await checkActor(ctx0.userId, ctx0.companyId);
    if (!ac.ok) return reply(m('disabled', lang));
    if (!userText) return reply(m('failed', lang));
    if (await budgetExceeded(ctx0.companyId)) return reply(m('budget', lang));

    registerErpTools();                                         // idempotent
    const settings = await getSettings(ctx0.companyId);
    const order = resolveTextProviderOrder(settings.brain, this.deps.env);
    if (!order.length) return reply(m('notReady', lang));

    const actor = ac.actor;
    const ctx: ToolCtx = {
      ...ctx0, role: (actor.isOwner ? 'direktor' : actor.role) as ToolCtx['role'], isOwner: actor.isOwner, tz: 'Asia/Tashkent', lang,
    };
    const allowed = effectiveToolNames(settings, actor.role, actor.isOwner, { channel: ctx.channel, purpose: ctx.purpose });
    const tools = toolDeclarations(allowed, lang);
    const company = await getCompanyAiState(ctx.companyId);
    const now = zonedParts(new Date());
    const system = buildSystemPrompt({
      lang, companyName: company.name, userName: actor.name, role: actor.role, isOwner: actor.isOwner,
      channel: ctx.channel, today: now.date, weekday: now.isoWeekday,
    });

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
        console.warn(`[aiVoice] matn provayderi ${name} xatosi: ${errorCode(e)} — keyingisiga o'tiladi`);
      }
    }
    const base = m('failed', lang);
    return reply(st.writeStatuses.length ? `${base}\n${this.factual(st, lang)}` : base);
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

      const results: ProviderToolResult[] = [];
      for (const [i, call] of turn.calls.entries()) {
        const result = i < MAX_CALLS_PER_ROUND
          ? await this.execOne(call, ctx, allowed, runId, st, lang)
          : { status: 'error' as const, message: m('perRound', lang), retryable: false };
        results.push({ id: call.id, name: call.name, result });
      }
      session.addToolResults(results);
    }
  }

  private async execOne(call: ProviderCall, ctx: ToolCtx, allowed: string[], runId: string, st: RunState, lang: Lang): Promise<ToolResult> {
    let result: ToolResult;
    let outcome: ExecuteOutcome | undefined;
    const def = getTool(call.name);
    if (call.argsError) result = { status: 'error', message: m('badArgs', lang), retryable: false };
    else if (!def || !allowed.includes(call.name)) result = { status: 'denied', message: m('unknownTool', lang), retryable: false };
    else {
      // Yozuvlar uchun idempotentlik: shu run ichida bir xil chaqiruv (yoki provayder almashganda) — bir marta
      const idempotencyKey = def.kind === 'write'
        ? `aiv:${runId}:${sha256Hex(`${call.name}|${JSON.stringify(call.args)}`).slice(0, 24)}` : undefined;
      try {
        outcome = await executeTool(ctx, call.name, call.args, { idempotencyKey });
        result = outcome.result;
      } catch (e) {
        console.error(`[aiVoice] executeTool ${call.name} kutilmagan xato:`, (e as Error)?.message);
        result = { status: 'error', message: m('failed', lang), retryable: false };
      }
    }
    st.toolCalls.push({ name: call.name.slice(0, 64), status: result.status, message: result.message });
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
      if (w.status === 'needs_confirmation') return `⏳ ${m('confirm', lang)}.`;
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
    if (st.pendingActions.length && !/tasdiq|подтвер/i.test(out)) out += `\n⏳ ${m('confirm', lang)}.`;
    return out;
  }
}
