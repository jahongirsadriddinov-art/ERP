// OX Pay / Roxiy (pay.roxiy.uz) — Click, Payme, Paynet orqali to'lov qabul
// qilish uchun. Hujjatlashtirilmagan javob shaklini haqiqiy so'rov bilan
// tekshirib aniqlangan (2026-09-19):
//   POST https://pay.roxiy.uz/api/create
//   headers: X-API-Key
//   body:    { amount, callback_url, note }
//   javob:   { ok, status, order_id, order_hash, amount, note, pay_url,
//              providers: [{ code, name, url }], paid_at, created_at }
import { createHash, timingSafeEqual } from 'crypto';
import { getBackendUrl } from '../utils/backendUrl';

const ROXIY_API_URL = process.env.ROXIY_API_URL || 'https://pay.roxiy.uz/api/create';
const ROXIY_API_KEY = process.env.ROXIY_API_KEY || '';
const ROXIY_WEBHOOK_SECRET = process.env.ROXIY_WEBHOOK_SECRET || '';

// routes/subscriptions.ts (callback_url quradi) va routes/payments.ts
// (shu yo'lda routerni ro'yxatdan o'tkazadi) BIR XIL yo'lga tayanadi — shu
// sabab bitta joyda.
export const ROXIY_WEBHOOK_PATH = '/api/payments/roxiy/webhook';

export interface RoxiyProvider {
  code: string; // 'click' | 'payme' | 'paynet'
  name: string;
  url: string;
}

export interface RoxiyOrder {
  ok: boolean;
  status: string; // 'pending' | 'paid' | ...
  order_id: number;
  order_hash: string;
  amount: number;
  note: string;
  pay_url: string;
  providers: RoxiyProvider[];
  paid_at: string | null;
  created_at: string;
}

// Roxiy webhook'i imzosiz (hujjatida HMAC/signature ko'rsatilmagan) — buni
// o'zimiz generatsiya qilgan maxfiy token bilan qoplaymiz: callback_url'ga
// shu tokenni qo'shib yuboramiz, webhookda esa token mos kelmasa so'rov
// butunlay e'tiborga olinmaydi. Shu token bo'lmasa, order_hash'ni bilgan
// (masalan o'zining pending buyurtmasi orqali) HAR QANDAY foydalanuvchi
// haqiqatda to'lamasdan turib o'z obunasini faollashtira olardi.
export function buildRoxiyCallbackUrl(): string {
  if (!ROXIY_WEBHOOK_SECRET) throw new Error('ROXIY_WEBHOOK_SECRET sozlanmagan (.env)');
  const url = new URL(`${getBackendUrl()}${ROXIY_WEBHOOK_PATH}`);
  url.searchParams.set('secret', ROXIY_WEBHOOK_SECRET);
  return url.toString();
}

export function isValidRoxiyWebhookSecret(secret: unknown): boolean {
  if (typeof secret !== 'string' || !ROXIY_WEBHOOK_SECRET) return false;
  // timingSafeEqual — bu token webhookning YAGONA himoyasi (Roxiy imzo
  // qo'shmagan) bo'lgani uchun oddiy `===` o'rniga: qat'iy uzunlikdagi
  // (SHA-256) xesh'larni solishtiramiz — shu bilan uzunlik/mos kelgan
  // belgilar soni orqali vaqt farqidan (timing) token taxmin qilinishining
  // oldi olinadi.
  const a = createHash('sha256').update(secret).digest();
  const b = createHash('sha256').update(ROXIY_WEBHOOK_SECRET).digest();
  return timingSafeEqual(a, b);
}

export async function createRoxiyOrder(amount: number, note: string): Promise<RoxiyOrder> {
  if (!ROXIY_API_KEY) throw new Error('ROXIY_API_KEY sozlanmagan (.env)');

  let res: Response;
  try {
    // AbortSignal.timeout — pay.roxiy.uz osilib qolsa Express handler'ni
    // abadiy band qilib qo'ymaslik uchun (currency.ts'dagi bilan bir xil idiom).
    res = await fetch(ROXIY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': ROXIY_API_KEY },
      body: JSON.stringify({ amount, callback_url: buildRoxiyCallbackUrl(), note }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error("Roxiy so'rovi vaqti tugadi (15s)");
    throw err;
  }
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Roxiy create so'rovi muvaffaqiyatsiz (HTTP ${res.status})`);
  }
  return data as RoxiyOrder;
}
