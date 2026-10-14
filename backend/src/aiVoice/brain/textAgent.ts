import type { TextAgent, TextAgentInput, TextAgentOutput } from '../contracts';
import { ErpTextAgent } from './agent';

// TextAgent kirish nuqtasi (imzolar P1'da muzlatilgan). P2: standart fabrika endi haqiqiy agent —
// ErpTextAgent (Gemini asosiy → OpenRouter zaxira → ixtiyoriy Claude; ≤5 tool raund; tool'lar FAQAT
// tools/executor.ts orqali). AI o'chiq bo'lsa (AI_VOICE_ENABLED yoki firma sozlamasi) agent model
// chaqirmaydi — muloyim "o'chirilgan" javob qaytaradi. P5 kaskad va P4 bot /ai rejimi agentni
// createTextAgent() orqali oladi (DI); testlar setTextAgentFactory() bilan soxtasini qo'yadi.

export { resolveTextProviderOrder } from './providerOrder';

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

let factory: () => TextAgent = () => new ErpTextAgent();

/** Agent fabrikasini almashtirish (testlar soxtasini, kelajakda boshqa amalga oshirish). */
export function setTextAgentFactory(f: () => TextAgent): void {
  factory = f;
}

export function createTextAgent(): TextAgent {
  return factory();
}
