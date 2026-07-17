import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: string, keylen: number) => Promise<Buffer>;

// ─── Bir martalik tokenlar ───────────────────────────────────────────────────
// Kriptografik random 32 bayt token. Xom (raw) qiymat foydalanuvchiga beriladi,
// DB'da faqat HASH saqlanadi — shu tufayli baza o'g'irlansa ham token tiklanmaydi.
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Doimiy-vaqtli solishtirish (timing attack'dan himoya).
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ─── Parol hash (scrypt — built-in, bcrypt/argon2 dependency shart emas) ──────
// Format: scrypt$<saltHex>$<hashHex>
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const derived = (await scrypt(password, salt, 64)).toString('hex');
    return safeEqual(derived, hash);
  } catch {
    return false;
  }
}

// ─── Telefon (O'zbekiston) ───────────────────────────────────────────────────
// Faqat +998 va 9 ta raqam. Bo'sh joy/qavslar tozalanadi.
export function normalizePhone(raw: string): string {
  let p = (raw || '').replace(/[\s()-]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

export function isValidUzPhone(raw: string): boolean {
  const p = normalizePhone(raw);
  return /^\+998\d{9}$/.test(p);
}

// ─── Parol kuchliligi ────────────────────────────────────────────────────────
// Minimum 8 belgi.
export function isStrongPassword(pw: string): boolean {
  return typeof pw === 'string' && pw.length >= 8;
}
