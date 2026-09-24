import { GoogleGenerativeAI } from '@google/generative-ai';

// Gemini bilan qisqa OVOZ (audio) xabarini tahlil qilish — Telegram botdagi
// "Chiqim qo'shish" uchun (ovozli xabarni matnga aylantirib, summa/tavsif/
// obyektni ajratadi). smetaParser.ts'dagi bilan bir xil kalit ro'yxati
// (GEMINI_API_KEYS vergul bilan yoki GEMINI_API_KEY), kvota tugaganda
// keyingi kalitga o'tadi. Audio inlineData sifatida yuboriladi (qisqa ovozli
// xabar uchun fayl yuklash shart emas).
const KEYS: string[] = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(',').map(k => k.trim()).filter(Boolean);
let keyIdx = 0;

export const geminiConfigured = () => KEYS.length > 0;

const isQuota = (e: any) => /RESOURCE_EXHAUSTED|429|quota|rate limit/i.test(String(e?.message || e));
const isTransient = (e: any) => /503|502|high demand|overloaded|unavailable/i.test(String(e?.message || e));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function geminiAudioToJson(audio: Buffer, mimeType: string, prompt: string): Promise<any> {
  if (!KEYS.length) throw new Error('GEMINI_API_KEY sozlanmagan');
  const tried = new Set<number>();
  let transient = 0;
  while (true) {
    if (tried.has(keyIdx)) throw new Error("Barcha Gemini kalitlari limitga to'ldi");
    tried.add(keyIdx);
    try {
      const model = new GoogleGenerativeAI(KEYS[keyIdx]).getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: 1024, temperature: 0, responseMimeType: 'application/json' },
      });
      const res = await model.generateContent([prompt, { inlineData: { mimeType, data: audio.toString('base64') } }]);
      return JSON.parse(res.response.text().trim());
    } catch (err: any) {
      if (isQuota(err) && KEYS.length > 1) { keyIdx = (keyIdx + 1) % KEYS.length; continue; }
      if (isTransient(err) && transient < 2) { transient++; tried.delete(keyIdx); await sleep(transient * 2000); continue; }
      throw err;
    }
  }
}
