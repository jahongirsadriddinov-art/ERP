import crypto from 'crypto';
import AiChannelConnection from '../../models/AiChannelConnection';
import { LIMITS } from '../config';
import type { LeaseAck } from '../contracts';

// Worker fencing lease (review A4) — bitta Telegram sessiyasi HECH QACHON ikki jarayonda
// ishlamasligi uchun (AUTH_KEY_DUPLICATED). Qoidalar:
//  • lease {leaseId, leaseUntil} 30 s, har 10 s yangilanadi;
//  • yangi worker eski lease tugaganidan keyin yana +10 s kutadi;
//  • muddati o'tgan lease'ni yangilab bo'lmaydi ('lost') — worker darhol Telethon'ni uzadi.
// Holat AiChannelConnection (platform/telegram_user) hujjatida saqlanadi.

const PLATFORM_TG = { scope: 'platform' as const, companyId: null, type: 'telegram_user' as const };

export async function ensurePlatformConnection(): Promise<void> {
  try {
    await AiChannelConnection.updateOne(PLATFORM_TG, { $setOnInsert: { ...PLATFORM_TG, status: 'disconnected' } }, { upsert: true });
  } catch (e: any) {
    if (e?.code !== 11000) throw e; // parallel upsert — hujjat allaqachon bor
  }
}

export interface LeaseOwner { workerId: string; workerVersion?: string; instanceId: string }

export async function acquireWorkerLease(owner: LeaseOwner, now: Date = new Date()): Promise<LeaseAck> {
  await ensurePlatformConnection();
  const leaseId = crypto.randomUUID();
  const leaseUntil = new Date(now.getTime() + LIMITS.workerLeaseTtlMs);
  const freeBefore = new Date(now.getTime() - LIMITS.workerLeaseGraceMs);
  const doc: any = await AiChannelConnection.findOneAndUpdate(
    { ...PLATFORM_TG, $or: [{ leaseId: null }, { leaseUntil: null }, { leaseUntil: { $lte: freeBefore } }] },
    { $set: { leaseId, leaseUntil, workerId: owner.workerId, workerVersion: owner.workerVersion, workerInstanceId: owner.instanceId } },
    { returnDocument: 'after' },
  ).lean();
  if (doc) return { ok: true, leaseId, leaseUntil: leaseUntil.getTime(), renewEveryMs: LIMITS.workerLeaseRenewMs };
  const cur: any = await AiChannelConnection.findOne(PLATFORM_TG).select('leaseUntil').lean();
  const until = cur?.leaseUntil ? new Date(cur.leaseUntil).getTime() : now.getTime();
  return { ok: false, reason: 'held', retryAfterMs: Math.max(1000, until + LIMITS.workerLeaseGraceMs - now.getTime()) };
}

export async function renewWorkerLease(leaseId: string, now: Date = new Date()): Promise<LeaseAck> {
  if (typeof leaseId !== 'string' || !leaseId) return { ok: false, reason: 'lost' };
  const leaseUntil = new Date(now.getTime() + LIMITS.workerLeaseTtlMs);
  const r = await AiChannelConnection.updateOne(
    { ...PLATFORM_TG, leaseId, leaseUntil: { $gt: now } },
    { $set: { leaseUntil } },
  );
  if (r.matchedCount !== 1) return { ok: false, reason: 'lost' };
  return { ok: true, leaseId, leaseUntil: leaseUntil.getTime(), renewEveryMs: LIMITS.workerLeaseRenewMs };
}

/** Worker Telethon'ni uzgandan KEYIN chaqiradi — keyingi worker darhol olishi mumkin. */
export async function releaseWorkerLease(leaseId: string): Promise<boolean> {
  if (typeof leaseId !== 'string' || !leaseId) return false;
  const r = await AiChannelConnection.updateOne({ ...PLATFORM_TG, leaseId }, { $set: { leaseId: null, leaseUntil: null } });
  return r.modifiedCount === 1;
}

/** Hozir lease kimda (requires:'worker' ishlarini qaysi instansiya olishini bilish uchun). */
export async function currentWorkerLease(now: Date = new Date()): Promise<{ leaseId: string; workerInstanceId?: string; leaseUntil: Date } | null> {
  const doc: any = await AiChannelConnection.findOne({ ...PLATFORM_TG, leaseUntil: { $gt: now } }).select('leaseId leaseUntil workerInstanceId').lean();
  if (!doc?.leaseId) return null;
  return { leaseId: doc.leaseId, workerInstanceId: doc.workerInstanceId, leaseUntil: doc.leaseUntil };
}
