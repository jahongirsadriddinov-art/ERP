import { describe, it, expect, vi, beforeAll } from 'vitest';

// Soxta Gemini SDK: qaysi model/sozlama bilan chaqirilganini yozib boradi
const calls: { model: string; cfg: any; timeout?: number }[] = [];
let behaviour: (model: string) => string = () => '{"ok":1}';
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(p: any, ro?: any) {
      return {
        generateContent: async () => {
          calls.push({ model: p.model, cfg: p.generationConfig, timeout: ro?.timeout });
          const out = behaviour(p.model);
          if (out.startsWith('ERR:')) throw new Error(out.slice(4));
          return { response: { text: () => out } };
        },
      };
    }
  },
}));

let g: typeof import('./gemini');
beforeAll(async () => {
  process.env.GEMINI_API_KEYS = 'k1';
  process.env.GEMINI_AUDIO_MODELS = 'm-gone,gemini-2.5-flash';
  g = await import('./gemini');
});

describe('geminiAudioToJson', () => {
  it('fast mode: thinking off for 2.5-flash, request timeout, gone model skipped next time', async () => {
    behaviour = (m) => (m === 'm-gone' ? 'ERR:[404 Not Found] model is no longer available' : '{"amount":5}');
    calls.length = 0;
    expect(await g.geminiAudioToJson(Buffer.from('a'), 'audio/ogg', 'p', { fast: true })).toEqual({ amount: 5 });
    expect(calls.map((c) => c.model)).toEqual(['m-gone', 'gemini-2.5-flash']);
    expect(calls[1].cfg.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(calls[1].timeout).toBe(25_000);
    calls.length = 0;
    await g.geminiAudioToJson(Buffer.from('a'), 'audio/ogg', 'p', { fast: true });
    expect(calls.map((c) => c.model)).toEqual(['gemini-2.5-flash']); // 404 model endi sinalmaydi
  });
  it('normal mode keeps the thinking budget', async () => {
    g._resetGeminiDeadModels();
    behaviour = (m) => (m === 'm-gone' ? 'ERR:404 not found' : '{"x":1}');
    calls.length = 0;
    await g.geminiTextToJson('p');
    expect(calls.at(-1)!.cfg.thinkingConfig).toEqual({ thinkingBudget: 768 });
    expect(calls.at(-1)!.timeout).toBeUndefined();
  });
});
