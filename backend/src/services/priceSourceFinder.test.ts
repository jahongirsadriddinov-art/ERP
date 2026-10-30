import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../aiVoice/lib/geminiKeys', () => ({
  geminiConfigured: () => false,            // AI yo'q — zaxira ro'yxat ishlatiladi
  withGeminiKey: async () => { throw new Error('no key'); },
}));
vi.mock('./priceChannels', async (orig) => ({
  ...(await orig<any>()),
  getChannels: async () => ['qurilish_mollari'],
}));

import { probeChannel, suggestChannels, workingOnes } from './priceSourceFinder';

const page = (lines: string[]) =>
  lines.map((t) => `<div class="tgme_widget_message_text">${t}</div>`).join('');

const fakeFetch = (byChannel: Record<string, string[]>) =>
  (async (url: string) => {
    const ch = String(url).split('/s/')[1] || '';
    const posts = byChannel[ch];
    if (!posts) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => page(posts) };
  }) as unknown as typeof fetch;

describe('probeChannel', () => {
  it('kanalda narx bo\u2018lsa — sanaydi va misol ko\u2018rsatadi', async () => {
    const f = fakeFetch({ test_kanal: ["Sement M400 — 52 000 so'm/qop", "G'isht M100 1 200 so'm dona"] });
    const r = await probeChannel('test_kanal', f);
    expect(r.prices).toBeGreaterThanOrEqual(2);
    expect(r.sample).toContain("so'm");
  });

  it('narx yozmaydigan kanal — nol', async () => {
    const f = fakeFetch({ bosh_kanal: ['Bugun ob-havo yaxshi', 'Salom hammaga'] });
    expect((await probeChannel('bosh_kanal', f)).prices).toBe(0);
  });

  it('kanal topilmasa yoki nomi xato bo\u2018lsa — jim nol qaytaradi', async () => {
    const f = fakeFetch({});
    expect((await probeChannel('yoq_kanal', f)).prices).toBe(0);
    expect((await probeChannel('@@', f)).prices).toBe(0);   // nomi yaroqsiz — tashqariga chiqilmaydi
    expect((await probeChannel('', f)).prices).toBe(0);
  });

  it("@ va to'liq havola bir xil tushuniladi", async () => {
    const f = fakeFetch({ test_kanal: ["Qum 180 000 so'm kub"] });
    for (const v of ['@test_kanal', 'https://t.me/test_kanal', 'test_kanal']) {
      expect((await probeChannel(v, f)).channel).toBe('test_kanal');
    }
  });
});

describe('suggestChannels', () => {
  it('AI ishlamasa ham zaxira ro\u2018yxat tekshiriladi, natija bo\u2018sh qolmaydi', async () => {
    const f = fakeFetch({ qurilish_mollari: ["Sement 52 000 so'm/qop"], sement_narxi: ["Sement M500 56 000 so'm qop", "Armatura 9 500 000 so'm tonna"] });
    const r = await suggestChannels({ fetchImpl: f });
    expect(r.aiUsed).toBe(false);
    expect(r.checked).toBeGreaterThan(0);
    // Eng ko'p narx chiqqani birinchi turadi
    expect(r.candidates[0].channel).toBe('sement_narxi');
  });

  it('allaqachon ulangan kanal belgilanadi va taklifga tushmaydi', async () => {
    const f = fakeFetch({ qurilish_mollari: ["Sement 52 000 so'm/qop", "Qum 180 000 so'm kub"] });
    const r = await suggestChannels({ fetchImpl: f });
    expect(r.candidates.find((c) => c.channel === 'qurilish_mollari')?.already).toBe(true);
    expect(workingOnes(r)).not.toContain('qurilish_mollari');
  });

  it('narx chiqmagan kanal "ishlaydi" deb taklif qilinmaydi', async () => {
    const f = fakeFetch({ sement_narxi: ['shunchaki matn'] });
    const r = await suggestChannels({ fetchImpl: f });
    expect(workingOnes(r)).toHaveLength(0);
  });
});
