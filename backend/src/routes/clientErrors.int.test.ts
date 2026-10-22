// Integratsion sinov: markaziy xato jurnali (services/errorTracker.ts + routes/clientErrors.ts) —
// guruhlash (fingerprint), maxfiy ma'lumotni tozalash, faqat dasturchi ko'radi, 5xx avtomatik yoziladi,
// yangi / qayta chiqqan xato uchun Telegram xabari.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../services/bot', () => ({ notifyDeveloper: vi.fn(async () => undefined) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import ErrorEvent from '../models/ErrorEvent';
import { requireAuth, optionalAuth, JWT_SECRET } from '../middleware/auth';
import clientErrorRoutes from './clientErrors';
import { errorCaptureMiddleware, hookConsoleError, markRequestError, setErrorNotifier, redact, captureError, normalizePath } from '../services/errorTracker';

let mongo: MongoMemoryServer;
const alerts: string[] = [];
const app = express();
hookConsoleError();
app.use(errorCaptureMiddleware());
app.use(express.json());
app.use('/api/errors', optionalAuth, clientErrorRoutes);
// Sinov marshrutlari: odatiy "catch → console.error → 500" va tashlangan xato (global handler)
app.get('/api/boom/:id', requireAuth, (_req, res) => {
  try { throw new Error('Cannot read properties of undefined (reading \'name\')'); } catch (e) { console.error('boom route', e); res.status(500).json({ error: 'Server xatoligi' }); }
});
app.post('/api/throw', (_req, _res) => { throw new Error('kutilmagan holat password=hunter2'); });
app.get('/api/maint', (_req, res) => { res.status(503).json({ maintenance: true }); });
app.use((err: any, _req: any, res: any, _next: any) => { markRequestError(res, err); res.status(500).json({ error: 'Server xatoligi' }); });

const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const waitFor = async (fn: () => Promise<boolean>) => { for (let i = 0; i < 50; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 40)); } throw new Error('timeout'); };
const C = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await ErrorEvent.init();
  setErrorNotifier(async (t) => { alerts.push(t); });
  ids.dev = String((await User.create({ firstName: 'Dev', phone: '+998900000091', role: 'dasturchi' }))._id);
  ids.boss = String((await User.create({ firstName: 'Boss', phone: '+998900000092', role: 'direktor', isOwner: true, companyId: C }))._id);
  ids.worker = String((await User.create({ firstName: 'Ishchi', phone: '+998900000093', role: 'ishchi', companyId: C }))._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => { alerts.length = 0; await ErrorEvent.deleteMany({}); });

describe('redact / normalizePath', () => {
  it('token, parol, telefon, email, JWT, ulanish satri tozalanadi', () => {
    const s = redact('fail password=hunter2 token: abc123 +998 90 123 45 67 a@b.uz Bearer abcdefghijkl eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl mongodb+srv://u:p@host/x 123456789:AAAbbbcccdddeeefffggghhhiiijjjkkk_l ?key=SECRET1&x=1');
    for (const bad of ['hunter2', 'abc123', '123 45 67', 'a@b.uz', 'abcdefghijkl', 'eyJhbGciOi', 'u:p@', 'AAAbbb', 'SECRET1']) expect(s).not.toContain(bad);
    expect(s).toContain('[phone]');
    expect(s).toContain('[email]');
  });
  it("yo'l shablonga aylanadi", () => {
    expect(normalizePath('https://x.uz/api/objects/65a1b2c3d4e5f6a7b8c9d0e1/items/42?token=abc')).toBe('/api/objects/:id/items/:n');
  });
});

describe('POST /api/errors/log (frontend)', () => {
  it('bir xil xato bitta yozuvga guruhlanadi, count va foydalanuvchilar soni oshadi; faqat birinchisida Telegram', async () => {
    const body = (n: number) => ({ message: `TypeError: x is undefined at row ${n}`, stack: 'TypeError: x\n    at Foo (https://site.uz/assets/index-AbC123xy.js:10:20)', url: 'https://site.uz/', screen: 'finance', action: 'tugma «Saqlash»', platform: 'web', appVersion: '1.2.3' });
    expect((await request(app).post('/api/errors/log').set('Authorization', tok('boss')).send(body(1))).status).toBe(200);
    await waitFor(async () => (await ErrorEvent.countDocuments()) === 1);
    await request(app).post('/api/errors/log').set('Authorization', tok('worker')).send(body(2));
    await waitFor(async () => ((await ErrorEvent.findOne().lean()) as any)?.count === 2);
    const ev: any = await ErrorEvent.findOne().lean();
    expect(await ErrorEvent.countDocuments()).toBe(1);
    expect(ev.source).toBe('client');
    expect(ev.userIds.sort()).toEqual([ids.boss, ids.worker].sort());
    expect(ev.page).toContain('finance');
    expect(ev.action).toContain('Saqlash');
    expect(ev.lastRole).toBe('ishchi');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('Yangi xato');
    expect(alerts[0]).toContain('finance');
  });

  it('xabar va stack ichidagi maxfiy ma\'lumot saqlanmaydi', async () => {
    await request(app).post('/api/errors/log').send({ message: 'Login failed for +998901234567 password=qwerty token=eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl', stack: 'Error\n at x (a.js:1:1) Bearer abcdefghijklmnop' });
    await waitFor(async () => (await ErrorEvent.countDocuments()) === 1);
    const ev: any = await ErrorEvent.findOne().lean();
    const all = JSON.stringify(ev) + alerts.join('\n');
    for (const bad of ['901234567', 'qwerty', 'eyJhbGciOi', 'abcdefghijklmnop']) expect(all).not.toContain(bad);
  });
});

describe('server 5xx avtomatik yoziladi', () => {
  it("catch → console.error → 500: marshrut, xato matni, kod joyi, kim", async () => {
    const r = await request(app).get('/api/boom/65a1b2c3d4e5f6a7b8c9d0e1').set('Authorization', tok('boss'));
    expect(r.status).toBe(500);
    await waitFor(async () => (await ErrorEvent.countDocuments({ source: 'server' })) === 1);
    const ev: any = await ErrorEvent.findOne({ source: 'server' }).lean();
    expect(ev.route).toBe('/api/boom/:id');
    expect(ev.method).toBe('GET');
    expect(ev.status).toBe(500);
    expect(ev.message).toContain("reading 'name'");
    expect(ev.topFrame).toMatch(/clientErrors\.int\.test\.ts:\d+/);
    expect(ev.lastCompanyId).toBe(C);
    expect(alerts[0]).toContain('GET /api/boom/:id');
  });

  it("tashlangan xato (global handler) ham yoziladi va tozalanadi; 503 texnik ishlar — yo'q", async () => {
    expect((await request(app).post('/api/throw')).status).toBe(500);
    expect((await request(app).get('/api/maint')).status).toBe(503);
    await waitFor(async () => (await ErrorEvent.countDocuments()) === 1);
    await new Promise((r) => setTimeout(r, 150));
    const evs: any[] = await ErrorEvent.find().lean();
    expect(evs).toHaveLength(1);
    expect(evs[0].message).toContain('kutilmagan holat');
    expect(evs[0].message).not.toContain('hunter2');
  });

  it('"Hal qilindi" dan keyin qayta chiqsa — ochiladi va yana xabar boradi', async () => {
    await captureError({ source: 'worker', kind: 'job:dead', message: 'Gemini timeout' });
    const ev: any = await ErrorEvent.findOne().lean();
    await request(app).patch(`/api/errors/events/${ev._id}`).set('Authorization', tok('dev')).send({ resolved: true }).expect(200);
    expect(((await ErrorEvent.findById(ev._id).lean()) as any).resolved).toBe(true);
    await captureError({ source: 'worker', kind: 'job:dead', message: 'Gemini timeout' });
    const after: any = await ErrorEvent.findById(ev._id).lean();
    expect(after.resolved).toBe(false);
    expect(after.reopenedCount).toBe(1);
    expect(after.count).toBe(2);
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toContain('yana chiqdi');
  });
});

describe('dasturchi API — faqat dasturchi', () => {
  it('tokensiz 401, direktor 403, dasturchi ro\'yxat/tafsilot/filtr', async () => {
    await captureError({ source: 'server', message: 'A xato', route: '/api/a', method: 'GET', status: 500 });
    await captureError({ source: 'client', message: 'B xato', page: 'dashboard' });
    expect((await request(app).get('/api/errors/events')).status).toBe(401);
    expect((await request(app).get('/api/errors/events').set('Authorization', tok('boss'))).status).toBe(403);
    const ev: any = await ErrorEvent.findOne({ source: 'server' }).lean();
    expect((await request(app).get(`/api/errors/events/${ev._id}`).set('Authorization', tok('boss'))).status).toBe(403);
    expect((await request(app).patch(`/api/errors/events/${ev._id}`).set('Authorization', tok('worker')).send({ resolved: true })).status).toBe(403);

    const all = await request(app).get('/api/errors/events').set('Authorization', tok('dev'));
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.open).toBe(2);
    expect(all.body.items[0].userIds).toBeUndefined();
    const srv = await request(app).get('/api/errors/events?source=server').set('Authorization', tok('dev'));
    expect(srv.body.items.map((i: any) => i.message)).toEqual(['A xato']);
    const one = await request(app).get(`/api/errors/events/${ev._id}`).set('Authorization', tok('dev'));
    expect(one.body.where).toBe('GET /api/a → 500');
    expect(one.body.occurrences).toHaveLength(1);
    await request(app).patch(`/api/errors/events/${ev._id}`).set('Authorization', tok('dev')).send({ resolved: true }).expect(200);
    const open = await request(app).get('/api/errors/events?status=open').set('Authorization', tok('dev'));
    expect(open.body.items.map((i: any) => i.message)).toEqual(['B xato']);
  });
});
