// Integratsion sinov: socket.io signal relay xavfsizligi — haqiqiy http server +
// socket.io + socket.io-client + xotiradagi MongoDB. Soxta `from`, firmalararo
// qo'ng'iroq, guruhga a'zo bo'lmagan relay, bloklangan/bekor qilingan sessiya,
// push dublikati va presence'ning firma bo'yicha cheklanishi tekshiriladi.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';

vi.mock('./push', () => ({ sendPushToUser: vi.fn(() => Promise.resolve()) }));

import { initSocket } from './socket';
import { sendPushToUser } from './push';
import { JWT_SECRET } from '../middleware/auth';
import User from '../models/User';
import Group from '../models/Group';
import Session from '../models/Session';

const pushMock = vi.mocked(sendPushToUser);

let mongo: MongoMemoryServer;
let server: http.Server;
let url = '';
const CA = new mongoose.Types.ObjectId().toString();
const CB = new mongoose.Types.ObjectId().toString();
const CC = new mongoose.Types.ObjectId().toString();
const ids: Record<string, string> = {};
let groupG = '';
const clients: ClientSocket[] = [];

const token = (key: string, jti?: string) =>
  jwt.sign({ userId: ids[key], role: 'x', ...(jti ? { jti } : {}) }, JWT_SECRET, { expiresIn: '1h' });

function connect(tok: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioc(url, { auth: { token: tok }, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
  });
}
const as = (key: string) => connect(token(key));

// Hodisani kutadi; kelmasa null (manfiy tekshiruvlar uchun).
function next(s: ClientSocket, event: string, ms = 600): Promise<any> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { s.off(event, h); resolve(null); }, ms);
    const h = (d: any) => { clearTimeout(t); resolve(d); };
    s.once(event, h);
  });
}
function collect(s: ClientSocket, event: string): any[] {
  const out: any[] = [];
  s.on(event, (d: any) => out.push(d));
  return out;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const mk = async (key: string, doc: any) => {
    const u: any = await User.create({ phone: `+99890${String(Object.keys(ids).length).padStart(7, '0')}`, ...doc });
    ids[key] = String(u._id);
  };
  await mk('a1', { firstName: 'Ali', lastName: 'Valiyev', role: 'direktor', companyId: CA });
  await mk('a2', { firstName: 'Bobur', role: 'ishchi', companyId: CA });
  await mk('a3', { firstName: 'Sardor', role: 'ishchi', companyId: CA });
  await mk('b1', { firstName: 'Begzod', role: 'direktor', companyId: CB });
  await mk('c1', { firstName: 'Charos', role: 'direktor', companyId: CC });
  await mk('dev', { firstName: 'Dasturchi', role: 'dasturchi' });
  await mk('blocked', { firstName: 'Blok', role: 'ishchi', companyId: CA, isBlocked: true });
  await mk('rev', { firstName: 'Rev', role: 'ishchi', companyId: CA });
  const g: any = await Group.create({ name: 'Brigada', memberIds: [ids.a1, ids.a2], createdBy: ids.a1, companyId: CA });
  groupG = String(g._id);
  // a1 (CA) va c1 (CC) bitta devSupport guruhida — qoida bo'yicha bir-biriga yeta oladi
  await Group.create({ name: '🛠 Dasturchi', devSupport: true, memberIds: [ids.dev, ids.a1, ids.c1], createdBy: ids.dev, companyId: CA });

  server = http.createServer();
  initSocket(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  clients.forEach((c) => c.disconnect());
  await new Promise<void>((r) => server?.close(() => r()));
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(() => {
  clients.splice(0).forEach((c) => c.disconnect());
  pushMock.mockClear();
});

describe('handshake', () => {
  it('bloklangan foydalanuvchi ulanolmaydi', async () => {
    await expect(as('blocked')).rejects.toThrow(/unauthorized/);
  });
  it('bekor qilingan sessiya (jti) ulanolmaydi, faol sessiya ulanadi', async () => {
    await Session.create({ userId: ids.rev, jti: 'jti-revoked', deviceLabel: 't', revoked: true });
    await Session.create({ userId: ids.rev, jti: 'jti-ok', deviceLabel: 't' });
    await expect(connect(token('rev', 'jti-revoked'))).rejects.toThrow(/unauthorized/);
    await expect(connect(token('rev', 'jti-missing'))).rejects.toThrow(/unauthorized/);
    const s = await connect(token('rev', 'jti-ok'));
    expect(s.connected).toBe(true);
  });
});

describe('signal relay', () => {
  it("soxta from/fromName serverdagi qiymat bilan almashtiriladi, payload shakli saqlanadi", async () => {
    const a1 = await as('a1'); const a2 = await as('a2');
    const got = next(a2, 'call:offer');
    a1.emit('call:offer', { to: ids.a2, from: ids.dev, fromName: 'Dasturchi', mode: 'video', sdp: { type: 'offer', sdp: 'x' } });
    const d = await got;
    expect(d).toMatchObject({ to: ids.a2, from: ids.a1, fromName: 'Ali Valiyev', mode: 'video', sdp: { type: 'offer', sdp: 'x' } });
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0]).toBe(ids.a2);
    expect(pushMock.mock.calls[0][1].body).toContain('Ali Valiyev');
  });

  it('tartib saqlanadi (offer → ice)', async () => {
    const a1 = await as('a1'); const a2 = await as('a2');
    const seen: string[] = [];
    a2.on('call:offer', () => seen.push('offer'));
    a2.on('call:ice', (d: any) => seen.push(`ice${d.candidate.n}`));
    a1.emit('call:offer', { to: ids.a2, sdp: {} });
    for (let n = 0; n < 4; n++) a1.emit('call:ice', { to: ids.a2, candidate: { n } });
    await wait(400);
    expect(seen).toEqual(['offer', 'ice0', 'ice1', 'ice2', 'ice3']);
  });

  it('boshqa firmadagi odamga signal va push yuborilmaydi', async () => {
    const a1 = await as('a1'); const b1 = await as('b1');
    const got = next(b1, 'call:offer');
    const gotEnd = next(b1, 'call:end');
    a1.emit('call:offer', { to: ids.b1, mode: 'voice', sdp: {} });
    a1.emit('call:end', { to: [ids.b1] });
    expect(await got).toBeNull();
    expect(await gotEnd).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("massivdagi `to` — faqat ruxsat etilganlarga", async () => {
    const a1 = await as('a1'); const a2 = await as('a2'); const b1 = await as('b1');
    const ga = next(a2, 'call:state'); const gb = next(b1, 'call:state');
    a1.emit('call:state', { to: [ids.a2, ids.b1, 'not-an-id'], cam: true, mic: false });
    expect(await ga).toMatchObject({ from: ids.a1, cam: true, mic: false });
    expect(await gb).toBeNull();
  });

  it('dasturchi boshqa firma bilan gaplasha oladi (dev-support), ikki tomonga ham', async () => {
    const dev = await as('dev'); const b1 = await as('b1');
    const g1 = next(b1, 'call:offer');
    dev.emit('call:offer', { to: ids.b1, sdp: {} });
    expect(await g1).toMatchObject({ from: ids.dev });
    const g2 = next(dev, 'call:answer');
    b1.emit('call:answer', { to: ids.dev, sdp: {} });
    expect(await g2).toMatchObject({ from: ids.b1 });
  });

  it('umumiy devSupport guruhi a\'zolari firmalararo yeta oladi', async () => {
    const a1 = await as('a1'); const c1 = await as('c1');
    const g = next(c1, 'call:ice');
    a1.emit('call:ice', { to: ids.c1, candidate: { c: 1 } });
    expect(await g).toMatchObject({ from: ids.a1, candidate: { c: 1 } });
  });

  it("guruh relay: a'zo bo'lmagan yuboruvchi tashlanadi, a'zo o'tadi", async () => {
    const a1 = await as('a1'); const a2 = await as('a2'); const a3 = await as('a3'); const b1 = await as('b1');
    a2.emit('join:group', groupG);
    a3.emit('join:group', groupG); // a'zo emas — qo'shilmaydi
    await wait(200);
    // a'zo bo'lmaganlar (boshqa firma va hatto o'z firmasidan) — guruh xonasiga ham, `to` bilan ham yo'q
    const none1 = next(a2, 'call:join', 500);
    b1.emit('call:join', { groupId: groupG, from: ids.a1 });
    a3.emit('call:join', { groupId: groupG });
    expect(await none1).toBeNull();
    const none2 = next(a2, 'call:offer', 500);
    a3.emit('call:offer', { to: ids.a2, groupId: groupG, sdp: {} });
    expect(await none2).toBeNull();
    // a'zo — o'tadi
    const ok = next(a2, 'call:join');
    a1.emit('call:join', { groupId: groupG, from: 'spoof' });
    expect(await ok).toMatchObject({ groupId: groupG, from: ids.a1 });
    const ok2 = next(a2, 'call:offer');
    a1.emit('call:offer', { to: ids.a2, groupId: groupG, mode: 'video', sdp: {} });
    expect(await ok2).toMatchObject({ groupId: groupG, from: ids.a1 });
  });
});

describe("qo'ng'iroq push dublikati", () => {
  it('bir (from,to) juftligiga 60 s ichida faqat bitta push (ICE-restart qayta offer)', async () => {
    const a3 = await as('a3'); const a2 = await as('a2');
    const g1 = next(a2, 'call:offer');
    a3.emit('call:offer', { to: ids.a2, mode: 'voice', sdp: {} });
    await g1;
    const g2 = next(a2, 'call:offer');
    a3.emit('call:offer', { to: ids.a2, mode: 'voice', sdp: {} }); // ICE restart
    expect(await g2).not.toBeNull(); // signal baribir yetadi
    await wait(100);
    expect(pushMock).toHaveBeenCalledTimes(1);
    // teskari yo'nalish — alohida juftlik
    const g3 = next(a3, 'call:offer');
    a2.emit('call:offer', { to: ids.a3, mode: 'voice', sdp: {} });
    await g3; await wait(100);
    expect(pushMock).toHaveBeenCalledTimes(2);
  });
});

describe('presence', () => {
  it("firma faqat o'z a'zolari (+ dasturchi) holatini oladi, dasturchi hammasini", async () => {
    const b1 = await as('b1');
    const bSeen = collect(b1, 'presence');
    const dev = await as('dev');
    const devSeen = collect(dev, 'presence');
    const a2 = await as('a2');
    const aNext = next(a2, 'presence');
    await as('a1');
    const aList = (await aNext)?.online || [];
    await wait(200);
    expect(aList).toEqual(expect.arrayContaining([ids.a1, ids.a2, ids.dev]));
    expect(aList).not.toContain(ids.b1);
    // b1 hech qachon CA a'zolarini ko'rmaydi, lekin dasturchini ko'radi
    const bAll = bSeen.flatMap((p) => p.online);
    expect(bAll).not.toContain(ids.a1);
    expect(bAll).not.toContain(ids.a2);
    expect(bAll).toContain(ids.dev);
    // dasturchi hamma onlayn foydalanuvchini ko'radi
    const devLast = devSeen[devSeen.length - 1]?.online || [];
    expect(devLast).toEqual(expect.arrayContaining([ids.a1, ids.a2, ids.b1, ids.dev]));
  });
});
