import { GoogleGenAI } from '@google/genai';
import { geminiConfigured, withGeminiKey } from '../../lib/geminiKeys';
import { sanitizeForPrompt } from '../../lib/untrusted';
import type { AiToolDef } from '../types';
import { ALL_CHANNELS, ALL_ROLES, L, ok } from '../erp/common';
import { setTranslatorMode } from './translator';

// Umumiy bilim tool'lari (owner 2026-10-18: "dollar kursini so'rasam bilmayman deyapti, hamma narsani bilsin"):
//  • getExchangeRate — O'zbekiston Markaziy banki rasmiy kursi (cbu.uz, kalitsiz, 30 daqiqa kesh);
//  • searchWeb — Google qidiruvi bilan (Gemini "googleSearch" grounding) istalgan yangi/faktik savolga qisqa javob.
// Firma ma'lumotiga tegmaydi (general: true) — firmasiz dasturchi kontekstida ham ishlaydi.

const CBU_URL = 'https://cbu.uz/uz/arkhiv-kursov-valyut/json/';
const TIMEOUT_MS = 7_000;
const RATE_TTL_MS = 30 * 60_000;

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
let fetcher: Fetcher = (url, init) => fetch(url, init as RequestInit) as any;
let rateCache: { at: number; rows: any[] } | null = null;
/** Testlar uchun. */
export function setKnowledgeFetch(f: Fetcher | null): void { fetcher = f || ((url, init) => fetch(url, init as RequestInit) as any); rateCache = null; }

const ALIASES: Record<string, string> = {
  dollar: 'USD', dollor: 'USD', доллар: 'USD', usd: 'USD', '$': 'USD',
  yevro: 'EUR', evro: 'EUR', euro: 'EUR', евро: 'EUR', eur: 'EUR',
  rubl: 'RUB', рубль: 'RUB', rub: 'RUB',
  tenge: 'KZT', тенге: 'KZT', yuan: 'CNY', юань: 'CNY', lira: 'TRY', funt: 'GBP', dirham: 'AED',
};

export function currencyCode(q: string | undefined): string {
  const s = String(q || 'USD').trim().toLowerCase();
  if (/^[a-z]{3}$/i.test(s)) return s.toUpperCase();
  for (const [k, v] of Object.entries(ALIASES)) if (s.includes(k)) return v;
  return 'USD';
}

async function cbuRates(): Promise<any[]> {
  if (rateCache && Date.now() - rateCache.at < RATE_TTL_MS) return rateCache.rows;
  const r = await fetcher(CBU_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP_${r.status}`);
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error('EMPTY');
  rateCache = { at: Date.now(), rows };
  return rows;
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/ /g, ' ');

export const getExchangeRate: AiToolDef<{ currency?: string; amount?: number }> = {
  name: 'getExchangeRate',
  description: {
    uz: "Valyuta kursi (O'zbekiston Markaziy banki, bugungi rasmiy): dollar, yevro, rubl va h.k. amount berilsa — so'mga hisoblaydi.",
    ru: 'Курс валют (ЦБ Узбекистана, официальный на сегодня): доллар, евро, рубль и т.д. С amount — пересчёт в сумы.',
  },
  parameters: {
    type: 'object',
    properties: {
      currency: { type: 'string', maxLength: 20, description: 'USD, EUR, RUB ... yoki "dollar"' },
      amount: { type: 'number', minimum: 0, maximum: 1e12 },
    },
  },
  kind: 'read',
  confirm: 'never',
  general: true,
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ['assistant'],
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  handler: async (ctx, args) => {
    const code = currencyCode(args.currency);
    let rows: any[];
    try { rows = await cbuRates(); } catch (e) {
      // Sabab jim yutilmasin (owner 2026-10-29 jurnali: kurs ham takror xato bergan)
      console.warn('[aiVoice/getExchangeRate] CBU xatosi:', String((e as Error)?.message || e).slice(0, 200));
      return { status: 'error', message: L(ctx, "Markaziy bank kursini hozir olib bo'lmadi, birozdan keyin so'rang.", 'Не удалось получить курс ЦБ, попробуйте чуть позже.'), retryable: true };
    }
    const row = rows.find((x) => String(x?.Ccy).toUpperCase() === code);
    if (!row) return { status: 'not_found', message: L(ctx, `${code} kursi topilmadi.`, `Курс ${code} не найден.`), retryable: false };
    const nominal = Number(row.Nominal) || 1;
    const rate = Number(String(row.Rate).replace(',', '.')) / nominal;
    const diff = Number(String(row.Diff).replace(',', '.')) / nominal;
    const date = String(row.Date || '');
    const change = Number.isFinite(diff) && diff !== 0 ? L(ctx, ` (kechagidan ${diff > 0 ? '+' : ''}${fmt(diff)})`, ` (к вчера ${diff > 0 ? '+' : ''}${fmt(diff)})`) : '';
    let msg = L(ctx, `Markaziy bank kursi (${date}): 1 ${code} = ${fmt(rate)} so'm${change}.`, `Курс ЦБ (${date}): 1 ${code} = ${fmt(rate)} сум${change}.`);
    if (args.amount && Number.isFinite(args.amount)) {
      msg += L(ctx, ` ${fmt(args.amount)} ${code} = ${fmt(args.amount * rate)} so'm.`, ` ${fmt(args.amount)} ${code} = ${fmt(args.amount * rate)} сум.`);
    }
    return ok(msg, { code, rate, diff, date, ...(args.amount ? { amountUzs: args.amount * rate } : {}) });
  },
};

// ── searchWeb ──
const SEARCH_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
const SEARCH_TIMEOUT_MS = 15_000;
type SearchFn = (query: string, lang: 'uz' | 'ru') => Promise<{ text: string; sources: string[] }>;

const defaultSearch: SearchFn = async (query, lang) => {
  const prompt = `${lang === 'ru' ? 'Ответь кратко (2–4 предложения) на русском' : "Qisqa (2–4 jumla) o'zbek tilida (lotin) javob ber"}, `
    + `${lang === 'ru' ? 'используя поиск Google. Только факты, с цифрами и датой, без markdown.' : "Google qidiruvidan foydalan. Faqat faktlar, raqam va sana bilan, markdown'siz."}\nSavol: ${query}`;
  let last: unknown = null;
  for (const model of SEARCH_MODELS) {
    try {
      return await withGeminiKey(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const r: any = await ai.models.generateContent({
          model, contents: prompt,
          config: { tools: [{ googleSearch: {} }], abortSignal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) } as any,
        });
        const text = String(r?.text || '').trim();
        if (!text) throw new Error('EMPTY');
        const chunks = r?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sources = chunks.map((c: any) => String(c?.web?.title || '')).filter(Boolean).slice(0, 3);
        return { text, sources };
      }, { scope: `search:${model}` });
    } catch (e) { last = e; }
  }
  throw last || new Error('SEARCH_FAILED');
};
let searchFn: SearchFn = defaultSearch;
/** Testlar uchun. */
export function setSearchFn(f: SearchFn | null): void { searchFn = f || defaultSearch; }

export const searchWeb: AiToolDef<{ query: string }> = {
  name: 'searchWeb',
  description: {
    uz: "Internetdan (Google) qidirish: yangiliklar, narxlar, sport, qonunlar, manzillar, ish vaqti, umumiy faktlar — o'z bilimingiz yetmagan yoki yangi ma'lumot kerak bo'lgan har qanday savol. Firma ma'lumoti uchun EMAS.",
    ru: 'Поиск в интернете (Google): новости, цены, спорт, законы, адреса, режим работы, общие факты — любой вопрос, где нужны свежие данные. НЕ для данных фирмы.',
  },
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', minLength: 2, maxLength: 200, description: "Qidiruv so'rovi (to'liq savol)" } },
    required: ['query'],
  },
  kind: 'read',
  confirm: 'never',
  general: true,
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ['assistant'],
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: ['answer', 'sources'],
  handler: async (ctx, args) => {
    if (!geminiConfigured() && searchFn === defaultSearch) {
      return { status: 'error', message: L(ctx, "Internet qidiruvi sozlanmagan.", 'Поиск не настроен.'), retryable: false };
    }
    const lang = ctx.lang === 'ru' ? 'ru' : 'uz';
    try {
      const r = await searchFn(String(args.query || '').slice(0, 200), lang);
      const answer = sanitizeForPrompt(r.text, 900);
      return ok(L(ctx, 'Internetdan topildi.', 'Найдено в интернете.'), { answer, sources: r.sources });
    } catch (e) {
      // Owner 2026-10-29: jurnalda searchWeb HAR SAFAR "Xato" bergan, lekin sababi
      // hech qayerda yozilmasdi — xato jim yutilardi. Endi aniq sabab logga tushadi
      // (model nomi eskirganmi, kvota tugaganmi, grounding ruxsat berilmaganmi).
      console.warn('[aiVoice/searchWeb] xato:', String((e as Error)?.message || e).slice(0, 200));
      return { status: 'error', message: L(ctx, "Internetdan hozir topib bo'lmadi, birozdan keyin so'rang.", 'Сейчас не удалось найти в интернете, попробуйте позже.'), retryable: true };
    }
  },
};

export const KNOWLEDGE_TOOLS: AiToolDef[] = [getExchangeRate, searchWeb, setTranslatorMode];
