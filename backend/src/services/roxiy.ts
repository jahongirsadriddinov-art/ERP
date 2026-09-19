// OX Pay / Roxiy (pay.roxiy.uz) — Click, Payme, Paynet orqali to'lov qabul
// qilish uchun. Hujjatlashtirilmagan javob shaklini haqiqiy so'rov bilan
// tekshirib aniqlangan (2026-09-19):
//   POST https://pay.roxiy.uz/api/create
//   headers: X-API-Key
//   body:    { amount, callback_url, note }
//   javob:   { ok, status, order_id, order_hash, amount, note, pay_url,
//              providers: [{ code, name, url }], paid_at, created_at }
import { getBackendUrl } from '../utils/backendUrl';

const ROXIY_API_URL = process.env.ROXIY_API_URL || 'https://pay.roxiy.uz/api/create';
const ROXIY_API_KEY = process.env.ROXIY_API_KEY || '';

// routes/payments.ts shu yo'lda routerni ro'yxatdan o'tkazadi — callback_url
// qurish bilan BIR XIL yo'lga tayanadi, shu sabab bitta joyda.
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

// Roxiy webhook'i imzosiz (hujjatida HMAC/signature ko'rsatilmagan). Bunga
// qarshi bitta UMUMIY (butun sayt uchun bitta) maxfiy tokenni ishlatish
// (avvalgi yondashuv) xavfli edi: agar bu token biror yo'l bilan sizib
// chiqsa (masalan callback_url haqiqatda foydalanuvchi brauzeriga qaytish
// manzili ham bo'lib chiqsa — Roxiy buni aniq hujjatlashtirmagan), o'sha
// TOKENNI bilgan har kim BOSHQA istalgan (hali to'lanmagan) buyurtmani
// ham "to'landi" deb belgilab, uning obunasini bepul faollashtira olardi.
//
// Shu sabab endi HAR BIR TO'LOV UCHUN ALOHIDA, tasodifiy token
// ishlatiladi (webhookToken, generatsiya: subscriptionPayments.ts,
// saqlanadi: Payment.webhookToken). Bitta to'lovning tokeni sizib chiqsa
// ham, u FAQAT o'sha (allaqachon 'paid' bo'lib bo'lgan, demak qayta
// ishlatib bo'lmaydigan) bitta yozuvga taalluqli — boshqa hech qanday
// buyurtmaga ta'sir qilolmaydi.
export function buildRoxiyCallbackUrl(webhookToken: string): string {
  const url = new URL(`${getBackendUrl()}${ROXIY_WEBHOOK_PATH}`);
  url.searchParams.set('wt', webhookToken);
  return url.toString();
}

export async function createRoxiyOrder(amount: number, note: string, webhookToken: string): Promise<RoxiyOrder> {
  if (!ROXIY_API_KEY) throw new Error('ROXIY_API_KEY sozlanmagan (.env)');

  let res: Response;
  try {
    // AbortSignal.timeout — pay.roxiy.uz osilib qolsa Express handler'ni
    // abadiy band qilib qo'ymaslik uchun (currency.ts'dagi bilan bir xil idiom).
    res = await fetch(ROXIY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': ROXIY_API_KEY },
      body: JSON.stringify({ amount, callback_url: buildRoxiyCallbackUrl(webhookToken), note }),
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
