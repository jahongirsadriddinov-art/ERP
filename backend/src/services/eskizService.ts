// Eskiz.uz SMS shlyuzi bilan ishlash — LOGIN OTP shu servis orqali yuboriladi.
// Rasmiy Postman docs sahifasi (documenter.getpostman.com/view/663428/RzfmES4z)
// JS orqali render qilinadi va to'g'ridan-to'g'ri o'qib bo'lmaydi — shuning
// uchun endpoint/format bir nechta mustaqil, ochiq-manba Eskiz klientlari
// (Go: realtemirov/eskizuz, PHP: professor93/eskiz-sms-client) manba kodidan
// tasdiqlangan: JSON body, POST /auth/login {email,password} -> data.token,
// POST /message/sms/send {mobile_phone,message,from} + Bearer token -> {id,status,message}.
import { ESKIZ_TEST_MESSAGES, otpSmsText } from '../config/smsTemplates';

const BASE_URL = 'https://notify.eskiz.uz/api';

let cachedToken: string | null = null;
let tokenExpiresAt = 0; // epoch ms

async function login(): Promise<string> {
  const email = process.env.ESKIZ_EMAIL;
  const password = process.env.ESKIZ_PASSWORD;
  if (!email || !password) {
    throw new Error('ESKIZ_EMAIL / ESKIZ_PASSWORD .env da sozlanmagan');
  }
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.data?.token) {
    // Eskiz email/parolni HECH QACHON logga chiqarmaymiz — faqat status/xabar.
    console.error('[eskiz] login failed:', res.status, data?.message || '(no message)');
    throw new Error('Eskiz autentifikatsiyasi muvaffaqiyatsiz');
  }
  const token: string = data.data.token;
  cachedToken = token;
  // Eskiz tokeni odatda uzoq muddat (~30 kun) amal qiladi — xavfsiz tomondan
  // 25 kunda o'zimiz yangilaymiz; shuningdek 401 kelsa ham darhol qayta login
  // qilinadi (pastda, sendOtpSms ichida).
  tokenExpiresAt = Date.now() + 25 * 24 * 60 * 60 * 1000;
  return token;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  return login();
}

async function sendRaw(token: string, mobilePhone: string, message: string): Promise<{ res: Response; data: any }> {
  const res = await fetch(`${BASE_URL}/message/sms/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mobile_phone: mobilePhone,
      message,
      from: process.env.ESKIZ_FROM || '4546',
    }),
  });
  const data: any = await res.json().catch(() => ({}));
  return { res, data };
}

const isTestMode = () => (process.env.ESKIZ_TEST_MODE || '').toLowerCase() === 'true';

export interface SendSmsResult {
  ok: boolean;
  id?: string;
  status?: string;
  error?: string;
}

// Login OTP SMS yuboradi. Production matni HAR DOIM tayyorlanadi (otpSmsText) —
// ESKIZ_TEST_MODE=true bo'lsagina, haqiqiy so'rov jo'natilayotganda, Eskiz test
// akkountlari uchun majburiy bo'lgan qat'iy matnlardan biriga almashtiriladi
// (aks holda Eskiz o'zi so'rovni rad etadi). ESKIZ_TEST_MODE=false bo'lganda
// bu funksiyaning boshqa hech narsasini o'zgartirish shart emas.
export async function sendOtpSms(phone: string, code: string): Promise<SendSmsResult> {
  const message = isTestMode() ? ESKIZ_TEST_MESSAGES[1] : otpSmsText(code);
  // Eskiz mobile_phone maydoni "+" siz kutadi (masalan "998901234567").
  const mobilePhone = phone.replace(/^\+/, '');

  try {
    let token = await getToken();
    let { res, data } = await sendRaw(token, mobilePhone, message);
    if (res.status === 401) {
      // Token yaroqsiz/muddati tugagan bo'lishi mumkin — bir marta qayta login qilib ko'ramiz.
      token = await login();
      ({ res, data } = await sendRaw(token, mobilePhone, message));
    }
    if (!res.ok) {
      console.error('[eskiz] send failed:', res.status, data?.message || data);
      return { ok: false, error: data?.message || `Eskiz xatosi (${res.status})` };
    }
    return { ok: true, id: data?.id ?? data?.data?.id, status: data?.status };
  } catch (err: any) {
    console.error('[eskiz] send error:', err?.message);
    return { ok: false, error: "SMS yuborib bo'lmadi" };
  }
}
