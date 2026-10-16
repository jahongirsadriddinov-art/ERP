import { describe, it, expect } from 'vitest';
import { resolveTextProviderOrder } from '../providerOrder';
import { createGroqProvider, GROQ_URL } from '../providers/openrouter';

describe('Groq zaxira', () => {
  it("navbat: gemini → groq → openrouter; fallback='none' bo'lsa zaxira yo'q", () => {
    const env = { gemini: true, groq: true, openrouter: true, claude: false };
    expect(resolveTextProviderOrder({ provider: 'gemini', fallback: 'openrouter' } as any, env)).toEqual(['gemini', 'groq', 'openrouter']);
    expect(resolveTextProviderOrder({ provider: 'gemini', fallback: 'none' } as any, env)).toEqual(['gemini']);
    expect(resolveTextProviderOrder({ provider: 'gemini', fallback: 'openrouter' } as any, { ...env, groq: false })).toEqual(['gemini', 'openrouter']);
  });
  it("Groq OpenAI-mos so'rov yuboradi (models massivisiz) va javobni o'qiydi", async () => {
    let seen: any = null;
    const p = createGroqProvider({
      apiKey: 'test-key', models: ['m1', 'm2'],
      fetchImpl: async (url, init) => { seen = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return { ok: true, status: 200, json: async () => ({ model: 'm1', choices: [{ message: { content: 'Salom' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }), text: async () => '' }; },
    });
    const s = p.start({ system: 'sys', history: [], userText: 'salom', tools: [] } as any);
    const turn = await s.next(new AbortController().signal);
    expect(seen.url).toBe(GROQ_URL);
    expect(seen.body.model).toBe('m1');
    expect(seen.body.models).toBeUndefined();
    expect(seen.auth).toBe('Bearer test-key');
    expect(turn.text).toBe('Salom');
  });
});
