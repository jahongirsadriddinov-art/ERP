// Shaxsiy ma'lumotni yashirish (PII redaction).
//  • redact(value)          — log/AiCallEvent/audit uchun: sirlar o'chiriladi, matndagi telefonlar maskalanadi.
//  • redactToolOutput(v, me) — modelga ketadigan tool natijasi: chaqiruvchidan BOSHQA odamning
//    telefoni, maoshi va Telegram identifikatori olib tashlanadi — rahbarlar uchun ham (design §3.6).

/** Doim olib tashlanadigan maydonlar (kalit nomi bo'yicha, registrga qaramay). */
const SECRET_KEYS = new Set([
  'password', 'passwordhash', 'token', 'accesstoken', 'refreshtoken', 'secret', 'apikey', 'api_key',
  'authorization', 'cookie', 'pinhash', 'pinsalt', 'pinresetcodehash', 'twofactorcodehash',
  'telegramverificationcode', 'otp', 'verificationcode', 'session', 'stringsession', 'encryptedsession',
  'resumptionhandle', 'p256dh', 'privatekey',
]);

/** Chaqiruvchining o'ziga tegishli bo'lmasa olib tashlanadigan maydonlar. */
const PII_KEYS = new Set(['phone', 'phonenumber', 'basesalary', 'salary', 'telegramchatid', 'telegramuserid', 'email']);

const MAX_DEPTH = 8;
const MAX_ARRAY = 200;
const MAX_STRING = 2000;

// +998 90 123-45-67, 998901234567, (90) 123 45 67 ... — kamida 9 ta raqam
const PHONE_RE = /\+?\d[\d\s\-().]{7,}\d/g;

export function maskPhone(phone: string): string {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 5) return '***';
  return `+${digits.slice(0, 5)}***${digits.slice(-2)}`;
}

/** Matndagi telefon raqamlarini maskalaydi. */
export function redactText(s: string): string {
  return s.replace(PHONE_RE, (m) => (m.replace(/\D/g, '').length >= 9 ? `***${m.replace(/\D/g, '').slice(-2)}` : m));
}

function capString(s: string, max = MAX_STRING): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Umumiy redaksiya (loglar, voqealar, audit argumentlari). */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return capString(redactText(value));
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[binary ${value.length}B]`;
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const src = toPlain(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (SECRET_KEYS.has(k.toLowerCase())) continue;
      if (PII_KEYS.has(k.toLowerCase()) && (k.toLowerCase() === 'phone' || k.toLowerCase() === 'phonenumber')) {
        out[k] = typeof v === 'string' ? maskPhone(v) : undefined;
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

function toPlain(v: any): Record<string, unknown> {
  if (v && typeof v.toObject === 'function') return v.toObject();
  if (v && typeof v.toHexString === 'function') return { id: v.toHexString() };
  return v as Record<string, unknown>;
}

function identityOf(o: Record<string, unknown>): string | undefined {
  for (const k of ['_id', 'id', 'userId']) {
    const v = o[k];
    if (v !== undefined && v !== null) return String(v);
  }
  return undefined;
}

/**
 * Tool natijasi uchun: obyekt identifikatori (_id/id/userId) chaqiruvchiga teng bo'lmasa,
 * PII maydonlari olib tashlanadi va undagi matnlarda telefonlar maskalanadi.
 * Identifikatorsiz obyekt — "egasi noma'lum" deb hisoblanadi (PII olib tashlanadi).
 */
export function redactToolOutput(value: unknown, callerUserId: string, depth = 0, ownedByCaller = false): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return capString(ownedByCaller ? value : redactText(value));
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return undefined;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => redactToolOutput(v, callerUserId, depth + 1, ownedByCaller));
  if (typeof value === 'object') {
    const src = toPlain(value);
    const id = identityOf(src);
    const mine = id !== undefined ? id === String(callerUserId) : ownedByCaller;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      const lk = k.toLowerCase();
      if (SECRET_KEYS.has(lk)) continue;
      if (PII_KEYS.has(lk) && !mine) continue;
      const r = redactToolOutput(v, callerUserId, depth + 1, mine);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return undefined;
}
