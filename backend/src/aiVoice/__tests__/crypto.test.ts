// lib/crypto: AES-256-GCM aylanma, buzilishni aniqlash, AAD, kalit rotatsiyasi; lib/ids tokenlar.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import crypto from 'crypto';
import {
  __resetCryptoCacheForTests, decryptJson, decryptString, encryptJson, encryptString, reencryptIfStale,
  safeEqual, secretsKeyConfigured, sha256Hex,
} from '../lib/crypto';
import { isObjectIdString, newBindingCode, newButtonToken, newConfirmToken, newCorrelationId, randomBase62 } from '../lib/ids';

const KEY_A = crypto.randomBytes(32).toString('base64');
const KEY_B = crypto.randomBytes(32).toString('hex');
const saved = { cur: process.env.AI_SECRETS_KEY, prev: process.env.AI_SECRETS_KEY_PREV };

const setKeys = (cur?: string, prev?: string) => {
  if (cur === undefined) delete process.env.AI_SECRETS_KEY; else process.env.AI_SECRETS_KEY = cur;
  if (prev === undefined) delete process.env.AI_SECRETS_KEY_PREV; else process.env.AI_SECRETS_KEY_PREV = prev;
  __resetCryptoCacheForTests();
};

beforeEach(() => setKeys(KEY_A));
afterAll(() => setKeys(saved.cur, saved.prev));

describe('AES-256-GCM', () => {
  it('aylanma: matn va JSON', () => {
    const b = encryptString("salom, dunyo — привет");
    expect(b.ct).not.toContain('salom');
    expect(decryptString(b)).toBe("salom, dunyo — привет");
    const j = encryptJson({ userId: 'u1', n: 5, list: [1, 2] });
    expect(decryptJson(j)).toEqual({ userId: 'u1', n: 5, list: [1, 2] });
  });

  it('har shifrlash yangi IV (bir xil matn — har xil shifr)', () => {
    expect(encryptString('x').ct === encryptString('x').ct && encryptString('x').iv === encryptString('x').iv).toBe(false);
  });

  it('buzilgan ct / tag / iv — xato', () => {
    const b = encryptString('maxfiy');
    const flip = (s: string) => { const buf = Buffer.from(s, 'base64'); buf[0] ^= 1; return buf.toString('base64'); };
    expect(() => decryptString({ ...b, ct: flip(b.ct) })).toThrow();
    expect(() => decryptString({ ...b, tag: flip(b.tag) })).toThrow();
    expect(() => decryptString({ ...b, iv: flip(b.iv) })).toThrow();
    expect(() => decryptString({ ...b, ct: undefined as any })).toThrow('BAD_BLOB');
  });

  it('AAD bog\'lanishi: boshqa AAD bilan ochilmaydi', () => {
    const b = encryptString('args', 'aiv-pending:c1:u1:tool');
    expect(decryptString(b, 'aiv-pending:c1:u1:tool')).toBe('args');
    expect(() => decryptString(b, 'aiv-pending:c2:u1:tool')).toThrow();
    expect(() => decryptString(b)).toThrow();
  });

  it('kalit versiyasi: v kalitning o\'zi emas, 8 belgilik id', () => {
    const b = encryptString('x');
    expect(b.v).toMatch(/^[0-9a-f]{8}$/);
    expect(KEY_A).not.toContain(b.v);
  });

  it('rotatsiya: eski kalit PREV\'da — eski shifr ochiladi va qayta shifrlanadi', () => {
    const old = encryptString('rotate-me');
    setKeys(KEY_B, KEY_A);
    expect(decryptString(old)).toBe('rotate-me');
    const fresh = reencryptIfStale(old);
    expect(fresh).not.toBeNull();
    expect(fresh!.v).not.toBe(old.v);
    expect(decryptString(fresh!)).toBe('rotate-me');
    expect(reencryptIfStale(fresh!)).toBeNull();
    // PREV olib tashlangach eski shifr — noma'lum versiya
    setKeys(KEY_B);
    expect(() => decryptString(old)).toThrow('UNKNOWN_KEY_VERSION');
  });

  it('kalit sozlanmagan — vaqtinchalik kalit ishlaydi, lekin configured=false', () => {
    setKeys(undefined);
    expect(secretsKeyConfigured()).toBe(false);
    const b = encryptString('eph');
    expect(decryptString(b)).toBe('eph');
    setKeys(KEY_A);
    expect(secretsKeyConfigured()).toBe(true);
    expect(() => decryptString(b)).toThrow('UNKNOWN_KEY_VERSION');
  });

  it('ixtiyoriy uzunlikdagi parol kaliti ham 32 baytga keltiriladi', () => {
    setKeys('qisqa-parol');
    expect(decryptString(encryptString('ok'))).toBe('ok');
  });
});

describe('xesh va taqqoslash', () => {
  it('sha256Hex va safeEqual', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('lib/ids', () => {
  it('base62 tokenlar: uzunlik, alifbo, takrorlanmaslik', () => {
    const toks = new Set(Array.from({ length: 500 }, () => newButtonToken()));
    expect(toks.size).toBe(500);
    for (const t of toks) expect(t).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(newConfirmToken()).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(randomBase62(64)).toHaveLength(64);
    // callback_data ≤ 64 bayt: ai:x:<22>:y
    expect(Buffer.byteLength(`ai:x:${newConfirmToken()}:y`)).toBeLessThanOrEqual(64);
  });

  it('correlationId — UUID v4; bog\'lash kodi AI-NNNN; ObjectId tekshiruvi', () => {
    expect(newCorrelationId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newBindingCode()).toMatch(/^AI-\d{4}$/);
    expect(isObjectIdString('507f1f77bcf86cd799439011')).toBe(true);
    expect(isObjectIdString('507f1f77bcf86cd79943901')).toBe(false);
    expect(isObjectIdString({ $ne: null })).toBe(false);
  });
});
