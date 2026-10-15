// AI ovozli yo'llar ulanishi (P1, review F): alohida prefikslar — /me auth talab qiladi (dasturchiga yopiq,
// smenasi yopiq ishchiga ochiq — workGate ALLOW), /platform faqat dasturchi, /admin dasturchini bloklaydi.
// Shu bilan bootstrap: AI o'chiq bo'lsa startAiVoice va socket ilgaklari haqiqiy no-op.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../../models/User';
import AiInstance from '../../models/AiInstance';
import { JWT_SECRET } from '../../middleware/auth';
import { mountAiVoiceRoutes, startAiVoice, getAiVoiceRuntime } from '../bootstrap';
import { listChannels, clearChannels } from '../channels/registry';
import { getSharedQueue } from '../queue/jobQueue';
import { registerAiVoiceSocket } from '../socket/inAppSocket';
import { registerAiWorkerNamespace, workerConnectedHere } from '../telegram/workerNamespace';
import { startMongo, stopMongo } from './helpers';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
mountAiVoiceRoutes(app);

const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const get = (path: string, k?: string) => {
  const r = request(app).get(path);
  return k ? r.set('Authorization', tok(k)) : r;
};

const ENV = process.env.AI_VOICE_ENABLED;
afterEach(() => { if (ENV === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = ENV; });

beforeAll(async () => {
  mongo = await startMongo();
  const C = '665f1c2e9b1e8a00000000d1';
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('dir', { firstName: 'Direktor', phone: '+998900007001', role: 'direktor', isOwner: true, companyId: C });
  await mk('ish', { firstName: 'Ishchi', phone: '+998900007002', role: 'ishchi', companyId: C }); // bugun check-in yo'q
  await mk('dev', { firstName: 'Dev', phone: '+998900007099', role: 'dasturchi' });
  await mk('blk', { firstName: 'Blok', phone: '+998900007003', role: 'direktor', companyId: C, isBlocked: true });
}, 120_000);
afterAll(async () => { await stopMongo(mongo); });

describe("/api/ai-voice yo'llari", () => {
  it('tokensiz — hammasi 401', async () => {
    for (const p of ['/api/ai-voice/me', '/api/ai-voice/admin/settings', '/api/ai-voice/platform/telegram-account']) {
      expect((await get(p)).status).toBe(401);
    }
  });
  it('bloklangan foydalanuvchi — 403', async () => {
    expect((await get('/api/ai-voice/me', 'blk')).status).toBe(403);
  });
  it('/me — firma foydalanuvchisiga ochiq (P3: AI holati bilan), dasturchiga yopiq', async () => {
    const r = await get('/api/ai-voice/me', 'dir');
    expect(r.status).toBe(200);
    expect(r.body.status.aiActive).toBe(false);
    expect((await get('/api/ai-voice/me', 'dev')).status).toBe(403);
  });
  it("/me — smenasi yopiq ishchiga ham ochiq (workGate ALLOW), /admin esa 423", async () => {
    expect((await get('/api/ai-voice/me', 'ish')).status).toBe(200);
    // workGate o'tkazdi (423 emas); AI o'chiq — /me ichidagi o'z javobi
    const rem = await get('/api/ai-voice/me/reminders', 'ish');
    expect(rem.status).toBe(403);
    expect(rem.body.error).toBe('ai_disabled');
    expect((await get('/api/ai-voice/admin/settings', 'ish')).status).toBe(423);
  });
  it('/platform — faqat dasturchi, no-store', async () => {
    expect((await get('/api/ai-voice/platform/telegram-account', 'dir')).status).toBe(403);
    const r = await get('/api/ai-voice/platform/telegram-account', 'dev');
    expect(r.status).toBe(200);   // P6: stub (501) o'rniga haqiqiy holat
    expect(r.headers['cache-control']).toBe('no-store');
  });
  it('/admin — dasturchini bloklaydi; firma/tarif topilmasa rahbarga ham yopiq (fail-closed, P8)', async () => {
    expect((await get('/api/ai-voice/admin/settings', 'dev')).status).toBe(403);
    expect((await get('/api/ai-voice/admin/settings', 'dir')).body.error).toBe('feature');
  });
});

describe("bootstrap / socket ilgaklari", () => {
  it("AI o'chiq — startAiVoice hech narsa qilmaydi (SIGTERM tinglovchisi, navbat, kanal yo'q)", () => {
    delete process.env.AI_VOICE_ENABLED;
    clearChannels();
    const before = process.listenerCount('SIGTERM');
    expect(startAiVoice()).toBeNull();
    expect(process.listenerCount('SIGTERM')).toBe(before);
    expect(getSharedQueue()).toBeNull();
    expect(listChannels()).toHaveLength(0);
  });
  it("AI o'chiq — socket/worker ilgaklari tinglovchi qo'shmaydi", () => {
    delete process.env.AI_VOICE_ENABLED;
    const socket = { on: vi.fn(), use: vi.fn(), onAny: vi.fn() };
    registerAiVoiceSocket(socket as any);
    expect(socket.on).not.toHaveBeenCalled();
    const io = { of: vi.fn(), use: vi.fn(), on: vi.fn() };
    registerAiWorkerNamespace(io as any);
    expect(io.of).not.toHaveBeenCalled();
    expect(workerConnectedHere()).toBe(false);
  });
  it('AI yoqilgan — navbat, 5 ta stub kanal, heartbeat; stop() drain qilib tozalaydi', async () => {
    process.env.AI_VOICE_ENABLED = 'true';
    clearChannels();
    const before = process.listenerCount('SIGTERM');
    const rt = startAiVoice({ installSignalHandlers: false })!;
    expect(rt).toBeTruthy();
    expect(startAiVoice({ installSignalHandlers: false })).toBe(rt); // takroriy chaqiruv — o'sha runtime
    expect(process.listenerCount('SIGTERM')).toBe(before);
    expect(getSharedQueue()).toBe(rt.queue);
    expect(rt.queue.registeredTypes()).toContain('session.sweep');
    const chans = listChannels();
    expect(chans.map((c) => c.name).sort()).toEqual(['bot_message', 'inapp_call', 'notify_manager', 'push', 'telegram_call']);
    for (const c of chans) {
      expect(await c.attempt({} as any, { kind: 'test' })).toMatchObject({ outcome: 'unavailable' });
      expect((await c.isAvailable({} as any)).ok).toBe(false);
    }
    await vi.waitFor(async () => expect(await AiInstance.countDocuments({})).toBe(1), { timeout: 5_000 });
    await rt.stop(3_000);
    expect(getSharedQueue()).toBeNull();
    expect(getAiVoiceRuntime()).toBeNull();
    expect(await AiInstance.countDocuments({})).toBe(0);
    clearChannels();
  });
});
