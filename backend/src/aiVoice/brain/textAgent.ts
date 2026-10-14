import { aiConfig } from '../config';
import type { AiBrainSettings, TextAgent, TextAgentInput, TextAgentOutput, TextProviderName } from '../contracts';
import { geminiConfigured } from '../lib/geminiKeys';

// STUB (P1): TextAgent interfeysi muzlatilgan (contracts.ts). P2 haqiqiy agentni (Gemini asosiy →
// OpenRouter zaxira → ixtiyoriy Claude; ≤5 tool raund, 20 s AbortSignal, tool'lar FAQAT
// tools/executor.ts orqali) setTextAgentFactory() bilan ulaydi. P5 kaskad va P4 bot /ai rejimi
// agentni createTextAgent() orqali oladi (DI — P5 P2'ga to'g'ridan-to'g'ri bog'lanmaydi).

const NOT_READY = {
  uz: "AI yordamchi hali sozlanmagan. Keyinroq urinib ko'ring.",
  ru: 'AI-помощник ещё не настроен. Попробуйте позже.',
};

/** Hech qanday model chaqirmaydi va tool ishlatmaydi — "hali tayyor emas" deb javob beradi. */
export class NotConfiguredTextAgent implements TextAgent {
  async run(input: TextAgentInput): Promise<TextAgentOutput> {
    const lang = input?.ctx?.lang === 'ru' ? 'ru' : 'uz';
    return { text: NOT_READY[lang], toolCalls: [], pendingActions: [], usage: { model: 'none', tokensIn: 0, tokensOut: 0, provider: 'none' } };
  }
}

let factory: () => TextAgent = () => new NotConfiguredTextAgent();

/** P2 haqiqiy agentni shu yerda ulaydi (testlar soxtasini). */
export function setTextAgentFactory(f: () => TextAgent): void {
  factory = f;
}

export function createTextAgent(): TextAgent {
  return factory();
}

/**
 * Provayderlar navbati (llm-provider.md, owner 2026-10-13) — P2 shu tartibda urinadi:
 *  • brain.provider='claude' va ANTHROPIC_API_KEY bor → claude, keyin gemini (Claude xatosida Gemini);
 *  • aks holda gemini (kalit bo'lsa);
 *  • brain.fallback='openrouter' va OPENROUTER_API_KEY bor → oxirida openrouter.
 * Sozlanmagan provayder ro'yxatga kirmaydi (startup'da xato/log yo'q). Bo'sh ro'yxat — "sozlanmagan".
 */
export function resolveTextProviderOrder(
  brain: Pick<AiBrainSettings, 'provider' | 'fallback'>,
  env: { gemini: boolean; openrouter: boolean; claude: boolean } = {
    gemini: geminiConfigured(), openrouter: aiConfig.brain.openRouterConfigured, claude: aiConfig.brain.claudeConfigured,
  },
): TextProviderName[] {
  const out: TextProviderName[] = [];
  if (brain?.provider === 'claude' && env.claude) out.push('claude');
  if (env.gemini) out.push('gemini');
  if (brain?.fallback === 'openrouter' && env.openrouter) out.push('openrouter');
  return out;
}
