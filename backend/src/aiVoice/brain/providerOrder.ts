import { aiConfig } from '../config';
import type { AiBrainSettings, TextProviderName } from '../contracts';
import { geminiConfigured } from '../lib/geminiKeys';

/**
 * Provayderlar navbati (llm-provider.md, owner 2026-10-13):
 *  • brain.provider='claude' va ANTHROPIC_API_KEY bor → claude, keyin gemini (Claude xatosida Gemini);
 *  • aks holda gemini (kalit bo'lsa);
 *  • GROQ_API_KEY bor → groq (tez zaxira; owner 2026-10-16);
 *  • brain.fallback='openrouter' va OPENROUTER_API_KEY bor → oxirida openrouter.
 * Sozlanmagan provayder ro'yxatga kirmaydi (startup'da xato/log yo'q). Bo'sh ro'yxat — "sozlanmagan".
 * (textAgent.ts qayta eksport qiladi — imzo P1'da muzlatilgan.)
 */
export function resolveTextProviderOrder(
  brain: Pick<AiBrainSettings, 'provider' | 'fallback'>,
  env: { gemini: boolean; openrouter: boolean; claude: boolean; groq?: boolean } = {
    gemini: geminiConfigured(), groq: aiConfig.brain.groqConfigured, openrouter: aiConfig.brain.openRouterConfigured, claude: aiConfig.brain.claudeConfigured,
  },
): TextProviderName[] {
  const out: TextProviderName[] = [];
  if (brain?.provider === 'claude' && env.claude) out.push('claude');
  if (env.gemini) out.push('gemini');
  if (brain?.fallback !== 'none' && env.groq) out.push('groq');
  if (brain?.fallback === 'openrouter' && env.openrouter) out.push('openrouter');
  return out;
}
