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
const isTransient = (e: any) => /503|502|500|high demand|overloaded|unavailable|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(e?.message || e));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// XATO TUZATILDI ("ovozli chiqimni bot tushunmadim deyapti"):
//  1) gemini-2.5-flash "o'ylash" (thinking) tokenlarini ham maxOutputTokens hisobidan sarflaydi — 1024 limitda
//     javob JSON'i ba'zan kesilib/bo'sh qolardi (JSON.parse xatosi → "tushunmadim"). Endi thinking o'chirilgan.
//  2) Kalitlardan biri uchun model "404 no longer available" qaytarsa (yoki kvota tugab keyIdx shunday kalitga
//     o'tib qolsa) — BARCHA keyingi so'rovlar yiqilardi. Endi har kalit × model kombinatsiyasi sinab ko'riladi.
//  3) "503 high demand" tez-tez bo'lmoqda — har modelga 3 tagacha urinish, keyin keyingi modelga o'tiladi.
const MODELS = (process.env.GEMINI_AUDIO_MODELS || 'gemini-2.5-flash,gemini-flash-latest,gemini-3-flash-preview,gemini-flash-lite-latest')
  .split(',').map(m => m.trim()).filter(Boolean);

function parseJsonLoose(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('BAD_JSON');
}

export async function geminiAudioToJson(audio: Buffer, mimeType: string, prompt: string): Promise<any> {
  if (!KEYS.length) throw new Error('GEMINI_API_KEY sozlanmagan');
  let lastErr: any = null;
  for (let k = 0; k < KEYS.length; k++) {
    const ki = (keyIdx + k) % KEYS.length;
    for (const modelName of MODELS) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const model = new GoogleGenerativeAI(KEYS[ki]).getGenerativeModel({
            model: modelName,
            generationConfig: {
              maxOutputTokens: 2048, temperature: 0, responseMimeType: 'application/json',
              ...(modelName.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            } as any,
          });
          const res = await model.generateContent([prompt, { inlineData: { mimeType, data: audio.toString('base64') } }]);
          const out = parseJsonLoose(res.response.text());
          keyIdx = ki; // ishlagan kalitda qolamiz
          return out;
        } catch (err: any) {
          lastErr = err;
          console.warn(`[gemini audio] key#${ki} ${modelName} try${attempt + 1}:`, String(err?.message || err).slice(0, 160));
          if (isTransient(err) || (err as Error)?.message === 'BAD_JSON') { if (attempt < 2) { await sleep(1500 * (attempt + 1)); continue; } }
          break; // kvota / 404 / ruxsat — keyingi modelga (yoki kalitga)
        }
      }
      if (lastErr && isQuota(lastErr)) break; // bu kalitning kvotasi tugagan — keyingi kalit
    }
  }
  throw lastErr || new Error('Gemini javob bermadi');
}
