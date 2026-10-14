import crypto from 'crypto';
import mongoose from 'mongoose';

// Identifikatorlar: correlationId (UUID v4 — audio kadr sarlavhasiga 16 bayt bo'lib kiradi),
// tugma tokenlari (base62, callback_data ≤64 bayt), ObjectId tekshiruvi.

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Kriptografik tasodifiy base62 satr (modulo og'ishisiz — rejection sampling). */
export function randomBase62(len: number): string {
  let out = '';
  while (out.length < len) {
    const buf = crypto.randomBytes(len * 2);
    for (const b of buf) {
      if (b < 248) out += B62[b % 62]; // 248 = 62*4 — og'ishsiz
      if (out.length === len) break;
    }
  }
  return out;
}

/** Bot tugmasi tokeni (masalan ai:a:<token>:c) — 10 belgi ≈ 59 bit. */
export function newButtonToken(): string { return randomBase62(10); }

/** Tasdiq tokeni (ai:x:<token>) — 22 belgi ≈ 131 bit. */
export function newConfirmToken(): string { return randomBase62(22); }

/** Bir martalik bog'lash kodi, masalan "AI-4821". */
export function newBindingCode(): string {
  return 'AI-' + String(crypto.randomInt(1000, 10000));
}

export function isObjectIdString(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v) && mongoose.Types.ObjectId.isValid(v);
}

export function newRequestId(): string { return crypto.randomUUID(); }
