// Worker autentifikatsiyasi (Ed25519 challenge-response, review A5) va fencing lease (A4).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiNonce from '../../models/AiNonce';
import AiChannelConnection from '../../models/AiChannelConnection';
import { workerChallengeMessage } from '../contracts';
import { LIMITS } from '../config';
import {
  __resetWorkerAuthCacheForTests, issueWorkerChallenge, parseEd25519PublicKey, verifyWorkerAuth, workerAuthConfigured,
} from '../lib/workerAuth';
import { acquireWorkerLease, currentWorkerLease, releaseWorkerLease, renewWorkerLease } from '../lib/workerLease';
import { startMongo, stopMongo } from './helpers';

let mongo: MongoMemoryServer;
const savedPub = process.env.AIV_WORKER_PUBKEY;
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const other = crypto.generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const rawPub = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(12);

const sign = (workerId: string, nonce: string, key: crypto.KeyObject = privateKey) =>
  crypto.sign(null, Buffer.from(workerChallengeMessage(workerId, nonce), 'utf8'), key).toString('base64');

const setPub = (v?: string) => {
  if (v === undefined) delete process.env.AIV_WORKER_PUBKEY; else process.env.AIV_WORKER_PUBKEY = v;
  __resetWorkerAuthCacheForTests();
};

beforeAll(async () => { mongo = await startMongo(); }, 120_000);
afterAll(async () => { setPub(savedPub); await stopMongo(mongo); });
beforeEach(() => setPub(pubPem));

describe('ochiq kalit formatlari', () => {
  it('PEM, xom 32 bayt base64/hex, SPKI DER base64 qabul qilinadi; boshqa tur — yo\'q', () => {
    expect(parseEd25519PublicKey(pubPem)).not.toBeNull();
    expect(parseEd25519PublicKey(pubPem.replace(/\n/g, '\\n'))).not.toBeNull(); // env'da \n
    expect(parseEd25519PublicKey(rawPub.toString('base64'))).not.toBeNull();
    expect(parseEd25519PublicKey(rawPub.toString('hex'))).not.toBeNull();
    expect(parseEd25519PublicKey((publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64'))).not.toBeNull();
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(parseEd25519PublicKey(rsa)).toBeNull();
    expect(parseEd25519PublicKey('garbage')).toBeNull();
    expect(parseEd25519PublicKey('')).toBeNull();
  });
});

describe('challenge-response', () => {
  it('to\'g\'ri imzo bir marta qabul qilinadi; takror (replay) rad etiladi', async () => {
    const ch = await issueWorkerChallenge('worker-1');
    const req = { workerId: 'worker-1', nonce: ch.nonce, signature: sign('worker-1', ch.nonce) };
    expect(await verifyWorkerAuth(req)).toEqual({ ok: true, workerId: 'worker-1' });
    expect(await verifyWorkerAuth(req)).toEqual({ ok: false, error: 'replayed_or_expired' });
  });

  it('parallel ikki marta yuborilgan bir xil javob — faqat bittasi o\'tadi', async () => {
    const ch = await issueWorkerChallenge('worker-1');
    const req = { workerId: 'worker-1', nonce: ch.nonce, signature: sign('worker-1', ch.nonce) };
    const rs = await Promise.all([verifyWorkerAuth(req), verifyWorkerAuth(req), verifyWorkerAuth(req)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });

  it('boshqa kalit bilan imzo, buzilgan imzo — bad_signature', async () => {
    const ch = await issueWorkerChallenge('worker-1');
    expect(await verifyWorkerAuth({ workerId: 'worker-1', nonce: ch.nonce, signature: sign('worker-1', ch.nonce, other.privateKey) }))
      .toEqual({ ok: false, error: 'bad_signature' });
    const sig = Buffer.from(sign('worker-1', ch.nonce), 'base64'); sig[5] ^= 1;
    expect(await verifyWorkerAuth({ workerId: 'worker-1', nonce: ch.nonce, signature: sig.toString('base64') }))
      .toEqual({ ok: false, error: 'bad_signature' });
    // muvaffaqiyatsiz urinish nonce'ni yoqib yubormaydi — haqiqiy worker hali ham kira oladi
    expect((await verifyWorkerAuth({ workerId: 'worker-1', nonce: ch.nonce, signature: sign('worker-1', ch.nonce) })).ok).toBe(true);
  });

  it('nonce boshqa workerId uchun berilgan — rad', async () => {
    const ch = await issueWorkerChallenge('worker-1');
    const r = await verifyWorkerAuth({ workerId: 'worker-2', nonce: ch.nonce, signature: sign('worker-2', ch.nonce) });
    expect(r).toEqual({ ok: false, error: 'replayed_or_expired' });
  });

  it('server bermagan (o\'zi o\'ylab topilgan) nonce — rad', async () => {
    const nonce = crypto.randomBytes(32).toString('base64url');
    expect(await verifyWorkerAuth({ workerId: 'worker-1', nonce, signature: sign('worker-1', nonce) }))
      .toEqual({ ok: false, error: 'replayed_or_expired' });
  });

  it('muddati o\'tgan challenge — rad', async () => {
    const past = new Date(Date.now() - LIMITS.workerChallengeTtlMs - 5_000);
    const ch = await issueWorkerChallenge('worker-1', past);
    expect(await verifyWorkerAuth({ workerId: 'worker-1', nonce: ch.nonce, signature: sign('worker-1', ch.nonce) }))
      .toEqual({ ok: false, error: 'replayed_or_expired' });
  });

  it('noto\'g\'ri so\'rov shakli va kalit sozlanmagan holat', async () => {
    expect(await verifyWorkerAuth({ workerId: 'bad id!', nonce: 'x', signature: 'y' } as any)).toEqual({ ok: false, error: 'bad_request' });
    expect(await verifyWorkerAuth(null as any)).toEqual({ ok: false, error: 'bad_request' });
    await expect(issueWorkerChallenge('bad id!')).rejects.toThrow('BAD_WORKER_ID');
    setPub(undefined);
    expect(workerAuthConfigured()).toBe(false);
    const ch = await issueWorkerChallenge('worker-1');
    expect(await verifyWorkerAuth({ workerId: 'worker-1', nonce: ch.nonce, signature: sign('worker-1', ch.nonce) }))
      .toEqual({ ok: false, error: 'not_configured' });
  });

  it('nonce TTL bilan saqlanadi, ishlatilgach usedAt qo\'yiladi', async () => {
    const ch = await issueWorkerChallenge('worker-9');
    await verifyWorkerAuth({ workerId: 'worker-9', nonce: ch.nonce, signature: sign('worker-9', ch.nonce) });
    const n: any = await AiNonce.findOne({ nonce: ch.nonce }).lean();
    expect(n.usedAt).toBeInstanceOf(Date);
    expect(n.expiresAt.getTime()).toBe(ch.expiresAt);
  });
});

describe('fencing lease (A4)', () => {
  beforeEach(async () => { await AiChannelConnection.deleteMany({}); });

  it('ikkinchi worker lease tugab +10 s o\'tmaguncha ololmaydi', async () => {
    const t0 = new Date('2026-10-13T03:00:00Z');
    const a = await acquireWorkerLease({ workerId: 'w-old', instanceId: 'inst-A' }, t0);
    expect(a.ok).toBe(true);
    const b = await acquireWorkerLease({ workerId: 'w-new', instanceId: 'inst-B' }, new Date(t0.getTime() + 5_000));
    expect(b).toMatchObject({ ok: false, reason: 'held' });
    // lease tugagan, lekin grace (10 s) hali o'tmagan
    const justAfter = new Date(t0.getTime() + LIMITS.workerLeaseTtlMs + 1_000);
    expect((await acquireWorkerLease({ workerId: 'w-new', instanceId: 'inst-B' }, justAfter)).ok).toBe(false);
    // eski worker endi yangilay olmaydi — o'zini to'xtatishi kerak
    expect(await renewWorkerLease((a as any).leaseId, justAfter)).toEqual({ ok: false, reason: 'lost' });
    const later = new Date(t0.getTime() + LIMITS.workerLeaseTtlMs + LIMITS.workerLeaseGraceMs + 1_000);
    const c = await acquireWorkerLease({ workerId: 'w-new', instanceId: 'inst-B' }, later);
    expect(c.ok).toBe(true);
    const cur = await currentWorkerLease(later);
    expect(cur?.workerInstanceId).toBe('inst-B');
  });

  it('yangilash lease\'ni uzaytiradi; release darhol bo\'shatadi; begona leaseId ta\'sir qilmaydi', async () => {
    const t0 = new Date();
    const a: any = await acquireWorkerLease({ workerId: 'w1', instanceId: 'i1' }, t0);
    const r: any = await renewWorkerLease(a.leaseId, new Date(t0.getTime() + 10_000));
    expect(r.ok).toBe(true);
    expect(r.leaseUntil).toBe(t0.getTime() + 10_000 + LIMITS.workerLeaseTtlMs);
    expect(await renewWorkerLease('not-mine', t0)).toEqual({ ok: false, reason: 'lost' });
    expect(await releaseWorkerLease('not-mine')).toBe(false);
    expect(await releaseWorkerLease(a.leaseId)).toBe(true);
    expect((await acquireWorkerLease({ workerId: 'w2', instanceId: 'i2' }, t0)).ok).toBe(true);
  });

  it('bir vaqtda ikki worker — faqat bittasi lease oladi', async () => {
    const now = new Date();
    const rs = await Promise.all([1, 2, 3].map((i) => acquireWorkerLease({ workerId: `w${i}`, instanceId: `i${i}` }, now)));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });
});
