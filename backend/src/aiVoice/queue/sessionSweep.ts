import AiCallSession from '../../models/AiCallSession';
import { LIMITS } from '../config';
import { emitSessionsEnded, type EndedSession } from '../sessions';

// Osilib qolgan sessiyalar tozalovchisi (review C4). Jarayon qulasa AiCallSession.isActive:true
// qoladi va partial unique indeks xodimni abadiy "band" qilib qo'yardi. Sessiya menejeri updatedAt'ni
// har 15 s yangilaydi; updatedAt < now − (maxDuration + ringTimeout + 60 s) bo'lsa — 'interrupted'.
// Har yangilash shartli (updatedAt o'zgarmagan bo'lsa) — tirik sessiyaga tegmaydi.

export const SESSION_SWEEP_JOB = 'session.sweep';

export async function sweepStaleSessions(now: Date = new Date()): Promise<EndedSession[]> {
  const graceMs = LIMITS.sessionSweepGraceSec * 1000;
  const candidates: any[] = await AiCallSession.find({ isActive: true, updatedAt: { $lt: new Date(now.getTime() - graceMs) } })
    .select('correlationId companyId employeeId channel purpose confirmationId attemptKey limits updatedAt answeredAt')
    .limit(500).lean();
  const ended: EndedSession[] = [];
  for (const d of candidates) {
    const maxDur = Number(d.limits?.maxDurationSec) || 120;
    const ring = Number(d.limits?.ringTimeoutSec) || 45;
    const staleBefore = now.getTime() - (maxDur + ring + LIMITS.sessionSweepGraceSec) * 1000;
    if (new Date(d.updatedAt).getTime() >= staleBefore) continue;
    const set: Record<string, unknown> = { isActive: false, status: 'interrupted', endedAt: now, endReason: 'stale_sweep' };
    if (d.answeredAt) set.durationSec = Math.max(0, Math.round((new Date(d.updatedAt).getTime() - new Date(d.answeredAt).getTime()) / 1000));
    const r = await AiCallSession.updateOne({ _id: d._id, isActive: true, updatedAt: d.updatedAt }, { $set: set });
    if (r.modifiedCount !== 1) continue;
    ended.push({
      sessionId: String(d._id), correlationId: d.correlationId, companyId: d.companyId, employeeId: d.employeeId,
      channel: d.channel, purpose: d.purpose, confirmationId: d.confirmationId, attemptKey: d.attemptKey,
      status: 'interrupted', reason: 'stale_sweep',
    });
  }
  if (ended.length) console.warn(`[aiVoice] ${ended.length} ta osilgan sessiya 'interrupted' qilindi`);
  await emitSessionsEnded(ended);
  return ended;
}
