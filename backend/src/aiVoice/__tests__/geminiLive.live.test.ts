// HAQIQIY Gemini Live sinovi — faqat RUN_LIVE_TESTS=1 va Gemini kaliti bo'lsa (CI'da o'tkazib yuboriladi).
// Ishga tushirish: RUN_LIVE_TESTS=1 GEMINI_API_KEY=... AI_LIVE_MODEL=... npx vitest run geminiLive.live
// Tekshiradi: setupComplete, matnli navbatga 24 kHz audio javob, chiqish transkripti, BLOCKING tool chaqiruvi.
import { describe, it, expect } from 'vitest';
import { aiConfig } from '../config';
import { geminiConfigured } from '../lib/geminiKeys';
import { GeminiLiveProvider } from '../voice/geminiLive';

const RUN = process.env.RUN_LIVE_TESTS === '1' && geminiConfigured();

describe.skipIf(!RUN)('Gemini Live (jonli)', () => {
  it('ulanadi, o\'zbekcha javob beradi (audio + transkript) va tool chaqiradi', async () => {
    const p = new GeminiLiveProvider({ setupTimeoutMs: 10_000 });
    const s = await p.open({
      model: aiConfig.models.live,
      systemInstruction: "Siz qisqa javob beradigan o'zbek tilidagi yordamchisiz. Vazifalar so'ralsa getMyTasks tool'ini chaqiring.",
      tools: [{ name: 'getMyTasks', description: 'Foydalanuvchi vazifalari', behavior: 'BLOCKING', parameters: { type: 'object', properties: {} } }],
      lang: 'uz', voiceName: 'Kore', ptt: false,
    });
    let audioBytes = 0;
    const transcripts: string[] = [];
    const calls: string[] = [];
    s.on('audioOut', (b) => { audioBytes += b.length; });
    s.on('transcript', (t) => { if (t.final && t.role === 'assistant') transcripts.push(t.text); });
    s.on('toolCall', (c) => {
      calls.push(c.name);
      s.toolResponse([{ id: c.id, name: c.name, result: { status: 'ok', message: '2 ta vazifa: beton quyish, armatura', retryable: false } }]);
    });
    s.sendText("Salom! Bugungi vazifalarim qanday?");
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline && !(audioBytes > 24_000 && transcripts.length)) await new Promise((r) => setTimeout(r, 250));
    await s.close('test_done');
    expect(audioBytes).toBeGreaterThan(24_000);
    expect(transcripts.join(' ').length).toBeGreaterThan(0);
    expect(calls).toContain('getMyTasks');
  }, 40_000);
});
