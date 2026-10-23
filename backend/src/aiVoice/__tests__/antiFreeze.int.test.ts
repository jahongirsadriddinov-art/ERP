// Anti-freeze (owner 2026-10-23): AI Telegram akkauntlari muzlatilmoqda. Worker yuborgan holat (frozen / spam_limited /
// banned / unauthorized) bazaga yoziladi, holat O'ZGARGANDA dasturchiga bitta xabar (atomar), cheklangan/chegarasi
// to'lgan akkaunt qo'ng'iroq uchun tanlanmaydi, yuk — shu xodim bilan gaplashgan akkaunt, keyin LRU.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';

const notifyDeveloper = vi.fn(async (_t: string, _o?: unknown) => undefined);
vi.mock('../../services/bot', () => ({ notifyDeveloper }));

import AiCallSession from '../../models/AiCallSession';
import AiChannelConnection from '../../models/AiChannelConnection';
import AiTgAccount from '../../models/AiTgAccount';
import {
  applyAccountHealth, applyPlatformHealth, healthBlocked, healthMessage, profileCooldownSec, sanitizeHealth, sanitizeUsage,
} from '../telegram/antiFreeze';
import { handleAccountHealthEvent, limitAccount, listPoolAccounts, markSessionAccount, pickPoolAccount, poolHasLiveAccount, recordAccountsHealth } from '../telegram/companyAccounts';
import { ensurePlatformConnection } from '../lib/workerLease';
import { startMongo, stopMongo } from './helpers';

let mongo: MongoMemoryServer;
const fresh = () => ({ status: 'connected', lastHealthAt: new Date() });
const DAY = 24 * 3600_000;

beforeAll(async () => { mongo = await startMongo(); }, 120_000);
afterEach(async () => {
  notifyDeveloper.mockClear();
  await AiTgAccount.deleteMany({});
  await AiCallSession.deleteMany({});
  await AiChannelConnection.deleteMany({});
});
afterAll(async () => { await stopMongo(mongo); });

describe('holatni tozalash va matnlar', () => {
  it('sanitizeHealth / sanitizeUsage — faqat ruxsat etilgan maydonlar', () => {
    expect(sanitizeHealth({ state: 'frozen', until: 5000, appealUrl: 'https://t.me/spambot', reason: 'account_frozen', x: 1 }))
      .toEqual({ state: 'frozen', until: 5000, appealUrl: 'https://t.me/spambot', reason: 'account_frozen' });
    expect(sanitizeHealth({ state: 'frozen', appealUrl: 'javascript:alert(1)' })).toEqual({ state: 'frozen' });
    expect(sanitizeHealth({ state: 'hacked' })).toBeNull();
    expect(sanitizeHealth({ state: 'ok', until: 5 })).toEqual({ state: 'ok' });
    expect(sanitizeUsage({ warmup: true, warmupUntil: 9, call: { hour: 1, day: 2, capHour: 3, capDay: 10 }, dm: { hour: 'x' }, evil: {} }))
      .toEqual({ warmup: true, warmupUntil: 9, call: { hour: 1, day: 2, capHour: 3, capDay: 10 } });
  });

  it('healthBlocked: muddati o\'tgan muzlatish/spam — amalda emas; ban — doim', () => {
    const now = new Date();
    expect(healthBlocked(undefined, now)).toBe(false);
    expect(healthBlocked({ state: 'ok' }, now)).toBe(false);
    expect(healthBlocked({ state: 'frozen', until: new Date(now.getTime() + 1000) }, now)).toBe(true);
    expect(healthBlocked({ state: 'frozen', until: new Date(now.getTime() - 1000) }, now)).toBe(false);
    expect(healthBlocked({ state: 'banned' }, now)).toBe(true);
  });

  it("o'zbekcha yo'riqnoma: @SpamBot va apellyatsiya havolasi", () => {
    const t = healthMessage('Jasur', { state: 'frozen', until: Date.UTC(2026, 11, 1, 7, 0), appealUrl: 'https://t.me/spambot?start=x' });
    expect(t).toMatch(/MUZLATILDI/);
    expect(t).toMatch(/@SpamBot/);
    expect(t).toContain('https://t.me/spambot?start=x');
    expect(t).toContain('2026-12-01 12:00 (Toshkent)');
    expect(healthMessage('Jasur', { state: 'spam_limited' })).toMatch(/PEER_FLOOD/);
    expect(healthMessage('Jasur', { state: 'banned' })).toMatch(/recover@telegram\.org/);
    expect(healthMessage('Jasur', { state: 'ok' }, 'frozen')).toMatch(/yana ishlayapti/);
  });

  it('profil: kuniga 1 marta', () => {
    const now = new Date();
    expect(profileCooldownSec(undefined, now)).toBe(0);
    expect(profileCooldownSec(new Date(now.getTime() - 3600_000), now)).toBe(23 * 3600);
    expect(profileCooldownSec(new Date(now.getTime() - DAY - 1), now)).toBe(0);
  });
});

describe('holat yozilishi va dasturchiga xabar', () => {
  it("holat o'zgarganda bitta xabar; o'sha holat — qayta xabar yo'q; parallel yozuvchilar — bitta xabar; tiklanish", async () => {
    const a = await AiTgAccount.create({ label: 'Jasur', ...fresh() });
    const id = String(a._id);
    const until = Date.now() + 10 * DAY;
    const res = await Promise.all([1, 2, 3].map(() => applyAccountHealth(id, { state: 'frozen', until, appealUrl: 'https://t.me/spambot' })));
    expect(res.filter(Boolean)).toHaveLength(1);
    expect(notifyDeveloper).toHaveBeenCalledTimes(1);
    expect(notifyDeveloper.mock.calls[0][0]).toMatch(/"Jasur"/);
    const d: any = await AiTgAccount.findById(id).lean();
    expect(d.health).toMatchObject({ state: 'frozen', appealUrl: 'https://t.me/spambot' });
    expect(new Date(d.health.until).getTime()).toBe(until);

    expect(await applyAccountHealth(id, { state: 'frozen', until: until + 1000 })).toBe(false);
    expect(notifyDeveloper).toHaveBeenCalledTimes(1);
    expect(new Date(((await AiTgAccount.findById(id).lean()) as any).health.until).getTime()).toBe(until + 1000);

    expect(await applyAccountHealth(id, { state: 'ok' })).toBe(true);
    expect(notifyDeveloper).toHaveBeenCalledTimes(2);
    expect(notifyDeveloper.mock.calls[1][0]).toMatch(/yana ishlayapti/);
    // Yangi akkaunt "ok" — xabar yo'q
    const b = await AiTgAccount.create(fresh());
    expect(await applyAccountHealth(String(b._id), { state: 'ok' })).toBe(false);
    expect(notifyDeveloper).toHaveBeenCalledTimes(2);
  });

  it("worker health'i: usage/qurilma/proksi saqlanadi, holat yoziladi; account.health voqeasi; platforma akkaunti", async () => {
    const a = await AiTgAccount.create({ label: 'Sarvar', ...fresh() });
    const id = String(a._id);
    await recordAccountsHealth([{
      id, connected: true, activeCalls: 0, health: { state: 'spam_limited', until: Date.now() + DAY },
      usage: { warmup: true, call: { hour: 1, day: 3, capHour: 3, capDay: 10 } }, device: 'MS-7C02 · Windows 10 x64 · TDesktop 6.2.4 x64', proxy: 'socks5 h:1080',
    } as any]);
    const list = await listPoolAccounts();
    expect(list[0]).toMatchObject({
      id, health: { state: 'spam_limited', active: true }, device: 'MS-7C02 · Windows 10 x64 · TDesktop 6.2.4 x64', proxy: 'socks5 h:1080',
      usage: { warmup: true, call: { day: 3, capDay: 10 } },
    });
    expect(notifyDeveloper).toHaveBeenCalledTimes(1);
    expect(await handleAccountHealthEvent({ account: id, health: { state: 'banned' } })).toBe(true);
    expect(((await AiTgAccount.findById(id).lean()) as any).health.state).toBe('banned');

    await ensurePlatformConnection();
    expect(await handleAccountHealthEvent({ health: { state: 'frozen', until: Date.now() + DAY } })).toBe(true);
    expect(((await AiChannelConnection.findOne({ scope: 'platform' }).lean()) as any).health.state).toBe('frozen');
    expect(notifyDeveloper.mock.calls.at(-1)![0]).toMatch(/platforma akkaunti/);
    expect(await applyPlatformHealth({ state: 'frozen', until: Date.now() + 2 * DAY })).toBe(false);
  });
});

describe("akkaunt tanlash: cheklanganlar chetda, chegaralar, LRU va 'tanish' akkaunt", () => {
  it('muzlatilgan / spam / ban / chegarasi to\'lgan / limitedUntil akkaunt tanlanmaydi; muddati o\'tgani — qaytadi', async () => {
    const now = new Date();
    const frozen = await AiTgAccount.create({ label: 'F', ...fresh(), health: { state: 'frozen', until: new Date(now.getTime() + DAY) } });
    const banned = await AiTgAccount.create({ label: 'B', ...fresh(), health: { state: 'banned' } });
    const capped = await AiTgAccount.create({ label: 'C', ...fresh(), usage: { call: { hour: 0, day: 10, capHour: 3, capDay: 10 } } });
    const limited = await AiTgAccount.create({ label: 'L', ...fresh() });
    await limitAccount(String(limited._id), 300, now);
    expect(await pickPoolAccount(now)).toBeNull();
    expect(await poolHasLiveAccount(now)).toBe(false);
    // Muzlatish muddati o'tdi — akkaunt yana ishlatiladi
    await AiTgAccount.updateOne({ _id: frozen._id }, { $set: { 'health.until': new Date(now.getTime() - 1000) } });
    expect((await pickPoolAccount(now))?.id).toBe(String(frozen._id));
    expect(await poolHasLiveAccount(now)).toBe(true);
    void banned; void capped;
  });

  it("yuk taqsimoti: eng uzoq ishlatilmagan (LRU); shu xodim bilan gaplashgan akkaunt afzal", async () => {
    const a1 = await AiTgAccount.create({ label: 'A1', ...fresh() });
    const a2 = await AiTgAccount.create({ label: 'A2', ...fresh() });
    const a3 = await AiTgAccount.create({ label: 'A3', ...fresh() });
    await AiTgAccount.updateOne({ _id: a1._id }, { $set: { lastUsedAt: new Date(Date.now() - 1000) } });
    await AiTgAccount.updateOne({ _id: a3._id }, { $set: { lastUsedAt: new Date(Date.now() - 5000) } });
    expect((await pickPoolAccount())?.id).toBe(String(a2._id));          // hech ishlatilmagan
    const emp = String(new Types.ObjectId());
    const s = await AiCallSession.create({ companyId: 'c1', employeeId: emp, correlationId: 'x', purpose: 'attendance', channel: 'telegram_call', isActive: false });
    await markSessionAccount(String(s._id), String(a1._id));
    expect(((await AiTgAccount.findById(a1._id).lean()) as any).lastUsedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
    // Shu xodimga a1 (dialog bor) — LRU'dan qat'i nazar
    expect((await pickPoolAccount(new Date(), { employeeId: emp }))?.id).toBe(String(a1._id));
    // a1 cheklangan bo'lsa — boshqasi
    await AiTgAccount.updateOne({ _id: a1._id }, { $set: { health: { state: 'spam_limited', until: new Date(Date.now() + DAY) } } });
    expect((await pickPoolAccount(new Date(), { employeeId: emp }))?.id).toBe(String(a2._id));
  });
});
