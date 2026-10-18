import crypto from 'crypto';
import AiNonce from '../../models/AiNonce';
import { INSTANCE_ID, LIMITS } from '../config';
import { workerChallengeMessage, type WorkerAuthRequest, type WorkerChallenge } from '../contracts';

// Telegram worker autentifikatsiyasi — Ed25519 challenge-response (review A5; HMAC o'rniga).
// Backend faqat OCHIQ kalitni biladi (env AIV_WORKER_PUBKEY: PEM, base64 SPKI DER yoki 32 baytli
// xom kalit base64/hex). Server bir martalik nonce beradi (AiNonce), worker
// "aiv-worker\n<workerId>\n<nonce>" ni imzolaydi. Nonce faqat bir marta, muddati ichida va
// shu workerId uchun qabul qilinadi — replay rad etiladi. Ulanish ichidagi RPC'lar nonce emas,
// noyob requestId ishlatadi.

const CHALLENGE_PURPOSE = 'worker_challenge';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

let cached: { raw: string; key: crypto.KeyObject | null } | null = null;

export function parseEd25519PublicKey(raw: string): crypto.KeyObject | null {
  const s = (raw || '').trim();
  if (!s) return null;
  try {
    if (s.includes('BEGIN PUBLIC KEY')) {
      const k = crypto.createPublicKey(s.replace(/\\n/g, '\n'));
      return k.asymmetricKeyType === 'ed25519' ? k : null;
    }
    const bytes = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const der = bytes.length === 32 ? Buffer.concat([ED25519_SPKI_PREFIX, bytes]) : bytes;
    const k = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ed25519' ? k : null;
  } catch {
    return null;
  }
}

function publicKey(): crypto.KeyObject | null {
  const raw = process.env.AIV_WORKER_PUBKEY || '';
  if (!cached || cached.raw !== raw) cached = { raw, key: parseEd25519PublicKey(raw) };
  return cached.key;
}

export function workerAuthConfigured(): boolean { return !!publicKey(); }

/** Backend o'qigan ochiq kalitning boshi (32 bayt xom kalit base64, 12 belgi) — mos kelmaslikni topish uchun. Sir emas. */
export function configuredKeyHint(): string {
  const k = publicKey();
  if (!k) return '';
  try { return (k.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('base64').slice(0, 12); } catch { return ''; }
}

const WORKER_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

/** Ulanish boshida workerga yuboriladigan challenge. */
export async function issueWorkerChallenge(workerId: string, now: Date = new Date()): Promise<WorkerChallenge> {
  if (!WORKER_ID_RE.test(workerId || '')) throw new Error('BAD_WORKER_ID');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + LIMITS.workerChallengeTtlMs);
  await AiNonce.create({ nonce, purpose: CHALLENGE_PURPOSE, subject: workerId, usedAt: null, expiresAt });
  return { nonce, expiresAt: expiresAt.getTime(), instanceId: INSTANCE_ID };
}

export type WorkerAuthResult =
  | { ok: true; workerId: string }
  | { ok: false; error: 'not_configured' | 'bad_request' | 'bad_signature' | 'replayed_or_expired' };

/** Imzoni tekshiradi, keyin nonce'ni ATOMIK ravishda "ishlatilgan" qiladi. */
export async function verifyWorkerAuth(req: WorkerAuthRequest, now: Date = new Date()): Promise<WorkerAuthResult> {
  const key = publicKey();
  if (!key) return { ok: false, error: 'not_configured' };
  const workerId = typeof req?.workerId === 'string' ? req.workerId : '';
  const nonce = typeof req?.nonce === 'string' ? req.nonce : '';
  const sigB64 = typeof req?.signature === 'string' ? req.signature : '';
  if (!WORKER_ID_RE.test(workerId) || !/^[A-Za-z0-9_-]{20,100}$/.test(nonce) || !sigB64 || sigB64.length > 200) {
    return { ok: false, error: 'bad_request' };
  }
  let sigOk = false;
  try {
    const sig = Buffer.from(sigB64, 'base64');
    sigOk = sig.length === 64 && crypto.verify(null, Buffer.from(workerChallengeMessage(workerId, nonce), 'utf8'), key, sig);
  } catch { sigOk = false; }
  if (!sigOk) return { ok: false, error: 'bad_signature' };

  const used = await AiNonce.findOneAndUpdate(
    { nonce, purpose: CHALLENGE_PURPOSE, subject: workerId, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { returnDocument: 'after' },
  ).lean();
  if (!used) return { ok: false, error: 'replayed_or_expired' };
  return { ok: true, workerId };
}

/** Testlar uchun: kalit keshini tozalash. */
export function __resetWorkerAuthCacheForTests() { cached = null; }
