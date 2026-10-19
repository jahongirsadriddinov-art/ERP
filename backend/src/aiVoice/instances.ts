import AiInstance from '../models/AiInstance';
import { INSTANCE_ID, LIMITS } from './config';

// Instansiya heartbeat'i (bootstrap har ~15 s chaqiradi). Realtime bitta instansiyaga mo'ljallangan
// (config.ts) — boshqa tirik instansiya ko'rinsa ogohlantirish yoziladi (deploy overlap, C3).

let lastWarnAt = 0;
const firstSeen = new Map<string, number>();
const OVERLAP_WARN_MS = 2 * 60_000;

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
  // Deploy paytida eski va yangi instansiya bir necha soniya birga ishlaydi (Render) — bu normal. Ogohlantirish
  // faqat boshqa instansiya 2 daqiqadan ko'proq birga tirik bo'lsa (haqiqiy ikki nusxa) yoziladi.
  const t = now.getTime();
  for (const id of [...firstSeen.keys()]) if (!ids.includes(id)) firstSeen.delete(id);
  for (const id of ids) if (!firstSeen.has(id)) firstSeen.set(id, t);
  const lasting = ids.filter((id) => t - (firstSeen.get(id) || t) >= OVERLAP_WARN_MS);
  if (lasting.length && Date.now() - lastWarnAt > 5 * 60_000) {
    lastWarnAt = Date.now();
    console.warn(`[aiVoice] DIQQAT: ${lasting.length + 1} ta instansiya 2 daqiqadan ko'proq bir vaqtda ishlamoqda (realtime bitta instansiyaga mo'ljallangan): ${[INSTANCE_ID, ...lasting].join(', ')}`);
  }
  return { others: ids };
}

export async function removeInstance(): Promise<void> {
  await AiInstance.deleteOne({ instanceId: INSTANCE_ID }).catch(() => undefined);
}
