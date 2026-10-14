import crypto from 'crypto';

// AES-256-GCM shifrlash, kalit versiyalash bilan. Kalit: env AI_SECRETS_KEY (32 bayt base64/hex
// yoki ixtiyoriy uzun satr — SHA-256 orqali 32 baytga keltiriladi). Rotatsiya: eski kalit
// AI_SECRETS_KEY_PREV'ga ko'chiriladi — eski shifrlar o'qilaveradi, yangilari yangi kalit bilan.
// v = kalit identifikatori (kalit SHA-256'ining birinchi 8 hex belgisi), kalitning o'zi emas.
export interface EncryptedBlob { v: string; iv: string; tag: string; ct: string }

interface KeyEntry { id: string; key: Buffer }

function parseKey(raw: string): Buffer {
  const s = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(s)) {
    const b = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (b.length === 32) return b;
  }
  return crypto.createHash('sha256').update(s, 'utf8').digest();
}
const keyIdOf = (key: Buffer) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);

let cache: { rawCur: string; rawPrev: string; cur: KeyEntry; prev?: KeyEntry } | null = null;
let ephemeral: KeyEntry | null = null;
let warned = false;

function keys(): { cur: KeyEntry; prev?: KeyEntry } {
  const rawCur = process.env.AI_SECRETS_KEY || '';
  const rawPrev = process.env.AI_SECRETS_KEY_PREV || '';
  if (cache && cache.rawCur === rawCur && cache.rawPrev === rawPrev) return cache;
  let cur: KeyEntry;
  if (rawCur) {
    const k = parseKey(rawCur);
    cur = { id: keyIdOf(k), key: k };
  } else {
    // Kalit sozlanmagan — jarayon ichidagi vaqtinchalik kalit (faqat qisqa muddatli
    // pending amallar uchun yetarli; qayta ishga tushganda ular "muddati o'tgan" bo'ladi).
    if (!ephemeral) { const k = crypto.randomBytes(32); ephemeral = { id: 'eph' + keyIdOf(k).slice(0, 5), key: k }; }
    if (!warned) { warned = true; console.warn('[aiVoice] AI_SECRETS_KEY sozlanmagan — vaqtinchalik kalit ishlatilmoqda'); }
    cur = ephemeral;
  }
  let prev: KeyEntry | undefined;
  if (rawPrev) { const k = parseKey(rawPrev); prev = { id: keyIdOf(k), key: k }; }
  cache = { rawCur, rawPrev, cur, prev };
  return cache;
}

export function secretsKeyConfigured(): boolean {
  return !!process.env.AI_SECRETS_KEY;
}

export function encryptString(plain: string, aad?: string): EncryptedBlob {
  const { cur } = keys();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cur.key, iv);
  if (aad) c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { v: cur.id, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

/** Buzilgan/noma'lum kalit/noto'g'ri AAD — xato tashlaydi. */
export function decryptString(blob: EncryptedBlob, aad?: string): string {
  if (!blob || typeof blob !== 'object' || !blob.v || !blob.iv || !blob.tag || typeof blob.ct !== 'string') throw new Error('BAD_BLOB');
  const { cur, prev } = keys();
  const entry = blob.v === cur.id ? cur : prev && blob.v === prev.id ? prev : null;
  if (!entry) throw new Error('UNKNOWN_KEY_VERSION');
  const d = crypto.createDecipheriv('aes-256-gcm', entry.key, Buffer.from(blob.iv, 'base64'));
  if (aad) d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(blob.ct, 'base64')), d.final()]).toString('utf8');
}

export function encryptJson(value: unknown, aad?: string): EncryptedBlob {
  return encryptString(JSON.stringify(value ?? null), aad);
}
export function decryptJson<T = unknown>(blob: EncryptedBlob, aad?: string): T {
  return JSON.parse(decryptString(blob, aad)) as T;
}

/** Eski kalit bilan shifrlangan bo'lsa — joriy kalit bilan qayta shifrlaydi (aks holda null). */
export function reencryptIfStale(blob: EncryptedBlob, aad?: string): EncryptedBlob | null {
  if (blob.v === keys().cur.id) return null;
  return encryptString(decryptString(blob, aad), aad);
}

/** Token/kod xeshi (bazada faqat shu saqlanadi). */
export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Vaqtga bog'liq bo'lmagan taqqoslash. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Faqat testlar uchun: keshni tozalash (env o'zgartirilgandan keyin). */
export function __resetCryptoCacheForTests() { cache = null; }
