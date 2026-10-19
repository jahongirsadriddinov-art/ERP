import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyRoxiySignature } from './payments';

// Roxiy webhook imzosi (X-Rox-Signature) — formati hujjatlanmagan, keng tarqalgan HMAC-SHA256 variantlari qabul qilinadi.
const SECRET = 'whsec_' + Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const BODY = JSON.stringify({ order_hash: 'abc123', status: 'paid', amount: 150000 });
const hmac = (key: crypto.BinaryLike, msg: string) => crypto.createHmac('sha256', key).update(msg).digest();

describe('verifyRoxiySignature', () => {
  it('accepts hex, base64 and sha256= signatures of the raw body', () => {
    const d = hmac(SECRET, BODY);
    expect(verifyRoxiySignature(SECRET, d.toString('hex'), [BODY])).toBe(true);
    expect(verifyRoxiySignature(SECRET, d.toString('base64'), [BODY])).toBe(true);
    expect(verifyRoxiySignature(SECRET, `sha256=${d.toString('hex')}`, [BODY])).toBe(true);
  });
  it('accepts Stripe-style t=…,v1=… and base64-decoded whsec keys (Svix-style)', () => {
    const t = '1760000000';
    expect(verifyRoxiySignature(SECRET, `t=${t},v1=${hmac(SECRET, `${t}.${BODY}`).toString('hex')}`, [BODY])).toBe(true);
    const key = Buffer.from(SECRET.slice(6), 'base64');
    expect(verifyRoxiySignature(SECRET, `v1,${hmac(key, `${t}.${BODY}`).toString('base64')}`, [BODY], t)).toBe(true);
  });
  it('rejects a wrong signature, a tampered body or no secret', () => {
    const d = hmac(SECRET, BODY).toString('hex');
    expect(verifyRoxiySignature(SECRET, d, [BODY.replace('150000', '1')])).toBe(false);
    expect(verifyRoxiySignature(SECRET, 'deadbeef', [BODY])).toBe(false);
    expect(verifyRoxiySignature('', d, [BODY])).toBe(false);
    expect(verifyRoxiySignature('other_secret', d, [BODY])).toBe(false);
  });
});
