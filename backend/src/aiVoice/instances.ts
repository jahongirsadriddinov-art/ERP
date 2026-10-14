import AiInstance from '../models/AiInstance';
import { INSTANCE_ID, LIMITS } from './config';

// Instansiya heartbeat'i (bootstrap har ~15 s chaqiradi). Realtime bitta instansiyaga mo'ljallangan
// (config.ts) — boshqa tirik instansiya ko'rinsa ogohlantirish yoziladi (deploy overlap, C3).

let lastWarnAt = 0;

export async function beatInstance(opts: { hasWorker: boolean; version?: string }, now: Date = new Date()): Promise<{ others: string[] }> {
  await AiInstance.updateOne(
    { instanceId: INSTANCE_ID },
    {
      $set: { lastBeatAt: now, hasWorker: opts.hasWorker, version: opts.version, expiresAt: new Date(now.getTime() + 10 * 60_000) },
      $setOnInsert: { startedAt: now },
    },
    { upsert: true },
  );
  const others: any[] = await AiInstance.find({
    instanceId: { $ne: INSTANCE_ID },
    lastBeatAt: { $gt: new Date(now.getTime() - LIMITS.instanceStaleMs) },
  }).select('instanceId hasWorker').lean();
  const ids = others.map((o) => o.instanceId);
  if (ids.length && Date.now() - lastWarnAt > 5 * 60_000) {
    lastWarnAt = Date.now();
    console.warn(`[aiVoice] DIQQAT: ${ids.length + 1} ta instansiya bir vaqtda ishlamoqda (realtime bitta instansiyaga mo'ljallangan): ${[INSTANCE_ID, ...ids].join(', ')}`);
  }
  return { others: ids };
}

export async function removeInstance(): Promise<void> {
  await AiInstance.deleteOne({ instanceId: INSTANCE_ID }).catch(() => undefined);
}
