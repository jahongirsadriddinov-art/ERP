import { GoogleGenAI } from '@google/genai';
import { geminiConfigured, withGeminiKey } from '../aiVoice/lib/geminiKeys';
import { fetchChannelPosts, parsePost, getChannels } from './priceChannels';

// "AI o'zi qidirsin" — narx e'lon qiladigan ochiq Telegram kanallarini topish
// (owner 2026-10-30: "qayerdan qidirishi belgilash uchun bo'lim och, qo'lda
// yoki AI qidiradi").
//
// MUHIM: AI faqat NOMZOD taklif qiladi, qaror qilmaydi. Har bir nomzod
// SHU YERDA TEKSHIRILADI — kanalning ochiq sahifasi o'qiladi va mavjud
// tahlilchi bilan haqiqatan narx chiqadimi, sanaladi. Natijada ro'yxatga
// faqat ISHLAYDIGAN kanallar tushadi.
//
// Nega shunday: model kanal nomlarini o'ylab topishi mumkin (yo'q kanal,
// yopiq kanal, narx yozmaydigan kanal). Tekshirmasdan qo'shish — qidiruvni
// yana bo'sh qoldiradi, ya'ni muammoni takrorlaydi.

const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
const TIMEOUT_MS = 20_000;
/** Shuncha nomzoddan ko'pi tekshirilmaydi (har biri tashqi so'rov). */
const MAX_CANDIDATES = 10;
/** Bir vaqtda shuncha kanal tekshiriladi (ketma-ket tekshirish so'rov vaqtini tugatardi). */
const CONCURRENCY = 5;
/** Butun amal uchun umumiy muddat — so'rov tarmoq darajasida uzilib ketmasin. */
const DEADLINE_MS = 40_000;
/** Kanal "ishlaydi" deyilishi uchun kamida shuncha narx chiqishi kerak. */
const MIN_PRICES = 2;

export interface ChannelCandidate {
  channel: string;
  /** Tekshiruvda topilgan narxlar soni (0 — yaramaydi). */
  prices: number;
  posts: number;
  /** Misol uchun topilgan birinchi narx — odam ko'zi bilan baholashi uchun. */
  sample?: string;
  already: boolean;
}

export interface SuggestResult {
  candidates: ChannelCandidate[];
  checked: number;
  /** AI ishlamasa ham zaxira ro'yxat tekshiriladi — shuning uchun natija baribir bo'ladi. */
  aiUsed: boolean;
  error?: string;
}

/**
 * AI kalit yo'q yoki javob bermaganda ishlatiladigan zaxira ro'yxat.
 * Bular — qurilish/narx mavzusida tez-tez uchraydigan ochiq kanal nomlari;
 * baribir TEKSHIRILADI, ya'ni ishlamasa ro'yxatga tushmaydi.
 */
const FALLBACK = [
  'qurilish_mollari', 'qurilish_narxlari', 'stroymaterial_uz', 'qurilish_bozor',
  'sement_narxi', 'metall_narxlari', 'qurilish_uz', 'stroymaterialy_uzbekistan',
];

const CLEAN = (s: unknown): string => String(s || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '').split(/[/?#]/)[0];
const VALID = (s: string): boolean => /^[A-Za-z0-9_]{4,32}$/.test(s);

/** Modeldan kanal nomlarini so'raydi. Xato bo'lsa — bo'sh ro'yxat (zaxira ishlatiladi). */
async function askModel(extra: string): Promise<string[]> {
  if (!geminiConfigured()) return [];
  const prompt = "O'zbekistonda qurilish materiallari NARXINI e'lon qiladigan OCHIQ Telegram kanallarini top"
    + (extra ? ` (ayniqsa: ${extra})` : '')
    + '. Google qidiruvidan foydalan.'
    + ' Faqat kanal foydalanuvchi nomlarini qaytar, har biri yangi qatorda, @ belgisisiz, boshqa hech qanday matnsiz.'
    + ' Yopiq guruh, bot yoki shaxsiy akkauntni kiritma. Ko\'pi bilan 15 ta.';
  let last: unknown = null;
  for (const model of MODELS) {
    try {
      return await withGeminiKey(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const r: any = await ai.models.generateContent({
          model, contents: prompt,
          config: { tools: [{ googleSearch: {} }], abortSignal: AbortSignal.timeout(TIMEOUT_MS) } as any,
        });
        const text = String(r?.text || '');
        if (!text.trim()) throw new Error('EMPTY');
        return text.split(/[\s,;]+/).map(CLEAN).filter(VALID);
      }, { scope: `pricech:${model}` });
    } catch (e) { last = e; }
  }
  if (last) console.warn('[narx/manba] AI qidiruvi ishlamadi:', String((last as Error)?.message || last).slice(0, 120));
  return [];
}

/** Bitta kanalni haqiqatan sinab ko'radi: sahifasini o'qiydi va narx chiqadimi, sanaydi. */
export async function probeChannel(channel: string, fetchImpl: typeof fetch = fetch): Promise<ChannelCandidate> {
  const ch = CLEAN(channel);
  const out: ChannelCandidate = { channel: ch, prices: 0, posts: 0, already: false };
  if (!VALID(ch)) return out;
  try {
    const posts = await fetchChannelPosts(ch, fetchImpl);
    out.posts = posts.length;
    for (const text of posts) {
      for (const p of parsePost(text)) {
        out.prices++;
        if (!out.sample) out.sample = `${p.name} — ${p.price.toLocaleString('uz-UZ')} so'm/${p.unit}`;
      }
    }
  } catch { /* tashqi sahifa — xatosi natijani buzmasin */ }
  return out;
}

/**
 * Nomzodlarni topadi va HAR BIRINI tekshiradi. Faqat narx chiqqanlari
 * "ishlaydi" deb belgilanadi; qolganlari ham qaytadi (admin o'zi ko'rsin),
 * lekin tartibda pastda turadi.
 */
export async function suggestChannels(opts: { query?: string; fetchImpl?: typeof fetch } = {}): Promise<SuggestResult> {
  const fetchImpl = opts.fetchImpl || fetch;
  const fromAi = await askModel(String(opts.query || '').slice(0, 80));
  const aiUsed = fromAi.length > 0;
  const existing = new Set((await getChannels().catch(() => [])).map((c) => c.toLowerCase()));

  const names: string[] = [];
  for (const n of [...fromAi, ...FALLBACK]) {
    const c = CLEAN(n);
    if (VALID(c) && !names.some((x) => x.toLowerCase() === c.toLowerCase())) names.push(c);
    if (names.length >= MAX_CANDIDATES) break;
  }

  // Owner 2026-10-30 xatosi: "API javob bermadi (tarmoq)". Sabab — kanallar
  // KETMA-KET tekshirilardi (har biri 12 s gacha + tanaffus), 10 tasi uchun
  // bir daqiqadan oshib ketardi va so'rov tarmoqda uzilardi. Endi bir nechtasi
  // BARAVARIGA tekshiriladi va umumiy muddat qo'yilgan: muddat tugasa,
  // tekshirib ulgurilganlari qaytadi — bo'sh xato emas.
  const deadline = Date.now() + DEADLINE_MS;
  const queue = [...names];
  const candidates: ChannelCandidate[] = [];
  const worker = async () => {
    for (;;) {
      const name = queue.shift();
      if (!name || Date.now() > deadline) return;
      const r = await probeChannel(name, fetchImpl);
      r.already = existing.has(name.toLowerCase());
      candidates.push(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker));
  candidates.sort((a, b) => b.prices - a.prices || b.posts - a.posts);
  return { candidates, checked: candidates.length, aiUsed };
}

/** Tekshiruvdan o'tgan (narx chiqqan) va hali qo'shilmagan kanallar. */
export const workingOnes = (r: SuggestResult): string[] =>
  r.candidates.filter((c) => c.prices >= MIN_PRICES && !c.already).map((c) => c.channel);
