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
const MODELS = (process.env.GEMINI_AUDIO_MODELS || 'gemini-3.8-flash,gemini-3.5-flash,gemini-2.5-flash,gemini-flash-latest')
  .split(',').map(m => m.trim()).filter(Boolean);

function parseJsonLoose(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('BAD_JSON');
}

/** Faqat matn (ovozsiz) — masalan botga yozilgan kunlik hisobot. */
export async function geminiTextToJson(prompt: string, opts?: GeminiOpts): Promise<any> {
  return geminiAudioToJson(null, '', prompt, opts);
}

export interface GeminiOpts {
  /**
   * Tezkor rejim (owner 2026-10-23: "ovozli chiqim juda sekin"): "o'ylash" o'chiq (2.5 — thinkingBudget 0,
   * 3.x — thinkingLevel "minimal"), qisqa javob limiti, urinishlar orasida qisqa kutish, so'rov uchun 25 s chegara.
   * Nom/obyekt tanlash baribir serverdagi fuzzy-moslashtiruvchida aniqlanadi — modelga chuqur "o'ylash" kerak emas.
   */
  fast?: boolean;
  /** Model ro'yxati (standart — MODELS; tezkor rejimda GEMINI_FAST_MODELS bo'lsa o'sha). */
  models?: string[];
}

// Ishlamaydigan model (404 "not found"/"no longer available" yoki 400 — bu sozlamani qabul qilmaydi) har so'rovda
// qayta sinalmasin: har biri bir necha yuz ms yo'qotish edi. 30 daqiqa o'tkazib yuboriladi.
const deadModels = new Map<string, number>();
const DEAD_MS = 30 * 60_000;
const isDeadModelErr = (e: any) => /\b404\b|not found|no longer available|is not supported|unknown name|thinking_?(budget|level|config)/i.test(String(e?.message || e));
export function _resetGeminiDeadModels() { deadModels.clear(); }

const FAST_MODELS = (process.env.GEMINI_FAST_MODELS || '').split(',').map(m => m.trim()).filter(Boolean);

function thinkingFor(modelName: string, fast: boolean): Record<string, unknown> {
  if (fast) {
    if (/2\.5-flash/.test(modelName)) return { thinkingConfig: { thinkingBudget: 0 } };
    if (/gemini-[3-9]/.test(modelName)) return { thinkingConfig: { thinkingLevel: 'minimal' } };
    return {};
  }
  // Biroz "o'ylash" o'zbekcha nutqni (raqamlar, nomlar) aniqroq tushunishga yordam beradi; javob uchun joy yetarli qoldiriladi
  return modelName.includes('2.5') ? { thinkingConfig: { thinkingBudget: 768 } } : {};
}

export async function geminiAudioToJson(audio: Buffer | null, mimeType: string, prompt: string, opts: GeminiOpts = {}): Promise<any> {
  if (!KEYS.length) throw new Error('GEMINI_API_KEY sozlanmagan');
  const fast = !!opts.fast;
  const models = opts.models?.length ? opts.models : (fast && FAST_MODELS.length ? FAST_MODELS : MODELS);
  const tries = fast ? 2 : 3;
  let lastErr: any = null;
  for (let k = 0; k < KEYS.length; k++) {
    const ki = (keyIdx + k) % KEYS.length;
    for (const modelName of models) {
      const deadKey = `${ki}|${modelName}|${fast ? 'f' : 'n'}`;
      const deadAt = deadModels.get(deadKey);
      if (deadAt && Date.now() - deadAt < DEAD_MS) continue;
      for (let attempt = 0; attempt < tries; attempt++) {
        try {
          const model = new GoogleGenerativeAI(KEYS[ki]).getGenerativeModel({
            model: modelName,
            generationConfig: {
              maxOutputTokens: fast ? 2048 : 6144, temperature: 0, responseMimeType: 'application/json',
              ...thinkingFor(modelName, fast),
            } as any,
          }, fast ? { timeout: 25_000 } : undefined);
          const res = await model.generateContent(audio ? [prompt, { inlineData: { mimeType, data: audio.toString('base64') } }] : [prompt]);
          const out = parseJsonLoose(res.response.text());
          keyIdx = ki; // ishlagan kalitda qolamiz
          return out;
        } catch (err: any) {
          lastErr = err;
          console.warn(`[gemini audio] key#${ki} ${modelName}${fast ? ' fast' : ''} try${attempt + 1}:`, String(err?.message || err).slice(0, 160));
          if (!isQuota(err) && !isTransient(err) && isDeadModelErr(err)) { deadModels.set(deadKey, Date.now()); break; }
          if (isTransient(err) || (err as Error)?.message === 'BAD_JSON') { if (attempt < tries - 1) { await sleep((fast ? 500 : 1500) * (attempt + 1)); continue; } }
          break; // kvota / 404 / ruxsat — keyingi modelga (yoki kalitga)
        }
      }
      if (lastErr && isQuota(lastErr)) break; // bu kalitning kvotasi tugagan — keyingi kalit
    }
  }
  throw lastErr || new Error('Gemini javob bermadi');
}
