// Integratsion sinov (xavfsizlik audit 2026-10-22): jonli GPS (socket 'gps:update') faqat rahbarlarga boradi.
// HTTP'da /api/gps/latest allaqachon faqat direktor/o'rinbosar uchun edi, lekin socket firma xonasiga
// (barcha xodimlar) tarqatardi — oddiy ishchi direktor va hamkasblarini real vaqtda kuzata olardi.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';

vi.mock('../services/push', () => ({ sendPushToUser: vi.fn(() => Promise.resolve()) }));
vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));

import { initSocket } from '../services/socket';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import User from '../models/User';
import gpsRoutes from './gps';

let mongo: MongoMemoryServer;
let server: http.Server;
let url = '';
const CA = new mongoose.Types.ObjectId().toString();
const ids: Record<string, string> = {};
const clients: ClientSocket[] = [];
const app = express();
app.use(express.json());
app.use('/api/gps', requireAuth, gpsRoutes);

const token = (k: string) => jwt.sign({ userId: ids[k] }, JWT_SECRET, { expiresIn: '1h' });
function connect(k: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioc(url, { auth: { token: token(k) }, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
  });
}
function next(s: ClientSocket, event: string, ms = 700): Promise<any> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { s.off(event, h); resolve(null); }, ms);
    const h = (d: any) => { clearTimeout(t); resolve(d); };
    s.once(event, h);
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create({ phone: `+99893${String(Object.keys(ids).length).padStart(7, '0')}`, ...d }))._id); };
  await mk('boss', { firstName: 'Direktor', role: 'direktor', companyId: CA });
  await mk('orin', { firstName: 'Orin', role: 'orinbosar', companyId: CA });
  await mk('w1', { firstName: 'Ishchi1', role: 'ishchi', companyId: CA });
  await mk('w2', { firstName: 'Ishchi2', role: 'ishchi', companyId: CA });
  server = http.createServer(app);
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

describe("jonli GPS socket hodisasi", () => {
  it("rahbarlar oladi, boshqa ishchi olmaydi", async () => {
    const boss = await connect('boss'); const orin = await connect('orin'); const w2 = await connect('w2');
    const pBoss = next(boss, 'gps:update'); const pOrin = next(orin, 'gps:update'); const pW2 = next(w2, 'gps:update');
    const r = await request(server).post('/api/gps').set('Authorization', `Bearer ${token('w1')}`).send({ lat: 41.3, lng: 69.2 });
    expect(r.status).toBe(200);
    expect((await pBoss)?.userId).toBe(ids.w1);
    expect((await pOrin)?.userId).toBe(ids.w1);
    expect(await pW2).toBeNull();
  });
});
