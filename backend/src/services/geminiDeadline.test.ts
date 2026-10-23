// Gemini chaqiruvining umumiy muddati — chek skaneri kabi foydalanuvchi kutayotgan so'rovlar osilib qolmasin.
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => { process.env.GEMINI_API_KEYS = 'k1,k2'; process.env.GEMINI_AUDIO_MODELS = 'm1,m2'; });
const gen = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent: gen.fn }; } },
}));

import { geminiAudioToJson, GEMINI_TIMEOUT } from './gemini';

describe('geminiAudioToJson deadline', () => {
  it('a hanging model call is cut at the deadline with GEMINI_TIMEOUT', async () => {
    gen.fn.mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    await expect(geminiAudioToJson(Buffer.from('x'), 'image/jpeg', 'p', { deadlineMs: 800 })).rejects.toThrow(GEMINI_TIMEOUT);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('transient errors stop retrying once the deadline is spent', async () => {
    gen.fn.mockReset();
    gen.fn.mockRejectedValue(new Error('503 high demand'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t0 = Date.now();
    await expect(geminiAudioToJson(Buffer.from('x'), 'image/jpeg', 'p', { deadlineMs: 1200 })).rejects.toThrow(GEMINI_TIMEOUT);
    expect(Date.now() - t0).toBeLessThan(3500);
  });

  it('passes the per-request timeout and returns parsed JSON in time', async () => {
    gen.fn.mockReset();
    gen.fn.mockResolvedValue({ response: { text: () => '{"amount":5}' } });
    await expect(geminiAudioToJson(Buffer.from('x'), 'image/jpeg', 'p', { deadlineMs: 5000 })).resolves.toEqual({ amount: 5 });
    expect(gen.fn.mock.calls[0][1].timeout).toBeGreaterThan(0);
  });
});
