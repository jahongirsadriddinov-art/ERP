// Owner 2026-10-17: foydalanuvchi qo'ng'iroqlari cheklovlari (voice/callLimits).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiCallSession from '../../models/AiCallSession';
import { callLimitMessage, checkUserCallLimit, workerCooldownSec } from '../voice/callLimits';
import { startMongo, stopMongo } from './helpers';

let mongo: MongoMemoryServer;
const C = '64b000000000000000000001';
const E = '64b000000000000000000002';
const base = { userSessionsPerHour: 6, companyMinutesPerDay: 120, monthlyBudgetUsd: 20, hardStop: true, botMsgsPer10Min: 20, toolCallsPerSession: 30 };
let n = 0;

async function session(p: { answeredMinAgo?: number; endedMinAgo?: number; direction?: 'inbound' | 'outbound'; now: number }) {
  const created = new Date(p.now - ((p.answeredMinAgo ?? 1) + 0.1) * 60_000);
  await AiCallSession.collection.insertOne({
    companyId: C, employeeId: E, correlationId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, purpose: 'assistant',
    channel: 'inapp_call', direction: p.direction || 'inbound', status: 'completed', isActive: false, attemptNo: 1,
    ...(p.answeredMinAgo !== undefined ? { answeredAt: new Date(p.now - p.answeredMinAgo * 60_000) } : {}),
    endedAt: new Date(p.now - (p.endedMinAgo ?? 0) * 60_000), createdAt: created, updatedAt: created,
  } as any);
}

beforeAll(async () => { mongo = await startMongo(); }, 60_000);
afterAll(async () => { await stopMongo(mongo); });
beforeEach(async () => { await AiCallSession.deleteMany({}); });

describe('checkUserCallLimit', () => {
  it("dasturchi/direktor/o'rinbosar — hech qachon cheklanmaydi", async () => {
    const now = Date.now();
    for (let i = 0; i < 8; i++) await session({ answeredMinAgo: i + 0.5, endedMinAgo: i, now });
    for (const role of ['dasturchi', 'direktor', 'orinbosar']) {
      expect(await checkUserCallLimit({ companyId: C, employeeId: E, role, settings: { limits: { ...base, userSessionsPerHour: 1 } }, now: new Date(now) })).toEqual({ ok: true });
    }
  });

  it("ishchi: tanaffus faqat ULANGAN qo'ng'iroqdan keyin; ulanmaganlar va AI qo'ng'iroqlari sanalmaydi", async () => {
    const now = Date.now();
    const s = { limits: { ...base, workerCallCooldownSec: 90 } };
    await session({ endedMinAgo: 0, now });                                    // ulanmagan
    await session({ answeredMinAgo: 1, endedMinAgo: 0.1, direction: 'outbound', now });  // AI qo'ng'iroq qildi
    expect(await checkUserCallLimit({ companyId: C, employeeId: E, role: 'ishchi', settings: s, now: new Date(now) })).toEqual({ ok: true });
    await session({ answeredMinAgo: 1, endedMinAgo: 0.5, now });               // 30 s oldin tugagan
    const r = await checkUserCallLimit({ companyId: C, employeeId: E, role: 'ishchi', settings: s, now: new Date(now) });
    expect(r).toMatchObject({ ok: false, code: 'cooldown' });
    if (!r.ok) {
      expect(r.retryAfterSec).toBeGreaterThanOrEqual(59);
      expect(r.retryAfterSec).toBeLessThanOrEqual(61);
      expect(callLimitMessage('uz', r)).toMatch(/^Keyingi qo'ng'iroq \d+ soniyadan keyin mumkin/);
    }
    expect(await checkUserCallLimit({ companyId: C, employeeId: E, role: 'ishchi', settings: s, now: new Date(now + 61_000) })).toEqual({ ok: true });
  });

  it('ishchi: soatlik (sirpanuvchi) — eng eski ulangan qo\'ng\'iroq oynadan chiqquncha; 0 — cheklanmaydi', async () => {
    const now = Date.now();
    await session({ answeredMinAgo: 50, endedMinAgo: 49, now });
    await session({ answeredMinAgo: 10, endedMinAgo: 9, now });
    const s = (h: number) => ({ limits: { ...base, userSessionsPerHour: h, workerCallCooldownSec: 0 } });
    const r = await checkUserCallLimit({ companyId: C, employeeId: E, role: 'prorab', settings: s(2), now: new Date(now) });
    expect(r).toMatchObject({ ok: false, code: 'hourly' });
    if (!r.ok) expect(Math.round(r.retryAfterSec / 60)).toBe(10);
    expect(await checkUserCallLimit({ companyId: C, employeeId: E, role: 'prorab', settings: s(3), now: new Date(now) })).toEqual({ ok: true });
    expect(await checkUserCallLimit({ companyId: C, employeeId: E, role: 'prorab', settings: s(0), now: new Date(now) })).toEqual({ ok: true });
  });

  it('workerCooldownSec: standart 90, 0..600 oralig\'ida', () => {
    expect(workerCooldownSec({ limits: base })).toBe(90);
    expect(workerCooldownSec({ limits: { ...base, workerCallCooldownSec: 5000 } })).toBe(600);
    expect(workerCooldownSec({ limits: { ...base, workerCallCooldownSec: 0 } })).toBe(0);
  });
});
