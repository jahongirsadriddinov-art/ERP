// AI ofis — boshqaruv markazi (owner 2026-10-22): agentlar ro'yxati (AgentProfile), buyruqlar (AgentTask), bajarish:
// code → GitHub repository_dispatch (soxta fetch) + qayta qo'ng'iroq (X-Agent-Secret, constant-time); content → Gemini
// (soxta runner); Yangi funksiya → spetsifikatsiya → tasdiq → dispatch; Boshliq → reja → tasdiq → bo'lak vazifalar;
// Hisobotchi → hisobot (AI'siz zaxira) va avtomatik hisobot; Telegram'ga yuborish faqat sozlangan bo'lsa. Faqat dasturchi.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AgentProfile from '../../models/AgentProfile';
import AgentTask from '../../models/AgentTask';
import AuditLog from '../../models/AuditLog';
import User from '../../models/User';
import { JWT_SECRET } from '../../middleware/auth';
import { mountAiVoiceRoutes } from '../bootstrap';
import { __resetOfficeCacheForTests } from '../office';
import {
  __drainAgentsForTests, __fireAutoReportForTests, __resetAgentsForTests, __setContentRunnerForTests, fallbackAgentDraft, plainReport, reportPeriod, SPAWN_RE,
} from '../agents/service';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany;
let devId: string;
const ENV_KEYS = ['AI_VOICE_ENABLED', 'AGENT_GITHUB_TOKEN', 'AGENT_GITHUB_REPO', 'AGENT_CALLBACK_SECRET', 'AGENT_CALLBACK_URL', 'AGENT_TG_CHANNEL_ID', 'DEVELOPER_CHAT_ID', 'TELEGRAM_BOT_TOKEN', 'RENDER_EXTERNAL_URL', 'BACKEND_URL'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

const app = express();
app.use(express.json());
mountAiVoiceRoutes(app);

const tok = (id: string) => `Bearer ${jwt.sign({ userId: id }, JWT_SECRET)}`;
const P = '/api/ai-voice/platform';
const get = (path: string, id = devId) => request(app).get(`${P}${path}`).set('Authorization', tok(id));
const post = (path: string, body: object = {}, id = devId) => request(app).post(`${P}${path}`).set('Authorization', tok(id)).send(body);
const callback = (body: object, secret?: string) => {
  const r = request(app).post('/api/ai-voice/agent-callback');
  return (secret === undefined ? r : r.set('X-Agent-Secret', secret)).send(body);
};
const settle = async () => { await __drainAgentsForTests(); };
const fetchMock = vi.fn();

function githubEnv() {
  process.env.AGENT_GITHUB_TOKEN = 'ghp_test_token_xyz';
  process.env.AGENT_GITHUB_REPO = 'acme/erp';
  process.env.AGENT_CALLBACK_SECRET = 'cb-secret-123';
  process.env.AGENT_CALLBACK_URL = 'https://api.example.uz/api/ai-voice/agent-callback';
}

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  mongo = await startMongo();
  A = await seedCompany('Agent');
  devId = String((await User.create({ firstName: 'Dev', phone: '+998900004321', role: 'dasturchi' } as any))._id);
}, 120_000);

beforeEach(async () => {
  for (const k of ENV_KEYS.slice(1)) delete process.env[k];
  __resetAgentsForTests();
  __resetOfficeCacheForTests();
  __setContentRunnerForTests(null);
  await AgentProfile.deleteMany({});
  await AgentTask.deleteMany({});
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await settle();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await stopMongo(mongo);
});

describe('agentlar ro\'yxati', () => {
  it('faqat dasturchi: firma egasi 403; callback sirsiz 401 / sozlanmagan 503', async () => {
    expect((await get('/agents', A.ownerId)).status).toBe(403);
    expect((await post('/agent-tasks', { agentKey: 'smm', text: 'x' }, A.ownerId)).status).toBe(403);
    expect((await request(app).get(`${P}/agent-tasks`)).status).toBe(401);
    expect((await callback({ taskId: 'x', status: 'done' }, 'abc')).status).toBe(503);
    githubEnv();
    expect((await callback({ taskId: 'x', status: 'done' })).status).toBe(401);
    expect((await callback({ taskId: 'x', status: 'done' }, 'wrong')).status).toBe(401);
  });

  it("standart ro'yxat + sozlash ro'yxati (qiymatlar qaytarilmaydi); nomini o'zgartirish va yangi agent", async () => {
    githubEnv();
    const r = await get('/agents');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const keys = r.body.agents.map((a: any) => a.key);
    for (const k of ['manager', 'backend', 'frontend', 'database', 'ai', 'mobile', 'designer', 'security', 'qa', 'devpanel', 'devbot', 'smm', 'marketing',
      'reporter', 'feature', 'windows', 'android', 'miniapp', 'erpbot', 'landing', 'payments', 'devops', 'tgworker', 'translator', 'perf', 'analytics',
      'support', 'docs', 'billing', 'role-direktor', 'finance', 'chat', 'gps', 'botdesign', 'notify', 'monitoring', 'office-designer']) expect(keys).toContain(k);
    expect(r.body.agents.find((a: any) => a.key === 'smm')).toMatchObject({ kind: 'content', team: 'growth', builtIn: true });
    expect(r.body.agents.find((a: any) => a.key === 'manager')).toMatchObject({ team: 'lead' });
    expect(r.body.setup.codeReady).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('ghp_test_token_xyz');
    expect(JSON.stringify(r.body)).not.toContain('cb-secret-123');

    const ren = await request(app).patch(`${P}/agents/backend`).set('Authorization', tok(devId)).send({ name: 'Bek', enabled: true });
    expect(ren.body.agent).toMatchObject({ key: 'backend', name: 'Bek' });
    const add = await post('/agents', { name: 'Yuridik', kind: 'content', description: 'Shartnomalar', team: 'growth' });
    expect(add.status).toBe(200);
    expect(add.body.agent).toMatchObject({ name: 'Yuridik', kind: 'content', team: 'growth', builtIn: false });
    expect(add.body.agent.key).toMatch(/^custom-[0-9a-f]{8}$/);
    expect((await post('/agents', { name: '', kind: 'code' })).status).toBe(400);
    // Seed qayta ishlaganda dasturchi bergan nom saqlanadi
    __resetAgentsForTests();
    expect((await get('/agents')).body.agents.find((a: any) => a.key === 'backend').name).toBe('Bek');
  });
});

describe('code agentlari — GitHub', () => {
  it("sozlanmagan: vazifa 'queued' qoladi, fetch chaqirilmaydi; rol agentiga buyruq berilmaydi", async () => {
    const r = await post('/agent-tasks', { agentKey: 'backend', text: 'Login sahifasini tezlashtir' });
    expect(r.status).toBe(200);
    await settle();
    const t = (await get(`/agent-tasks/${r.body.task.id}`)).body.task;
    expect(t.status).toBe('queued');
    expect(t.log.map((l: any) => l.text).join(' ')).toMatch(/sozlanmagan/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await post('/agent-tasks', { agentKey: 'role-direktor', text: 'x' })).status).toBe(400);
    expect((await post('/agent-tasks', { agentKey: 'nope', text: 'x' })).status).toBe(404);
  });

  it("dispatch → running; callback: running → done + PR havolasi; tugagandan keyin e'tiborsiz", async () => {
    githubEnv();
    const r = await post('/agent-tasks', { agentKey: 'frontend', text: 'Tugma rangini o\'zgartir' });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/acme/erp/dispatches');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer ghp_test_token_xyz');
    const body = JSON.parse(init.body);
    expect(body.event_type).toBe('agent-task');
    expect(body.client_payload).toMatchObject({ taskId: r.body.task.id, agentKey: 'frontend', agentName: 'Frontend', text: 'Tugma rangini o\'zgartir', callbackUrl: 'https://api.example.uz/api/ai-voice/agent-callback' });
    expect(body.client_payload.rolePrompt).toContain('Frontend');
    expect((await get(`/agent-tasks/${r.body.task.id}`)).body.task.status).toBe('running');

    const office = await get('/office');
    expect(office.body.agents.find((a: any) => a.id === 'frontend')).toMatchObject({ busy: true, activity: 'task', task: { status: 'running' } });

    expect((await callback({ taskId: r.body.task.id, status: 'running', log: 'Testlar ishlayapti' }, 'cb-secret-123')).status).toBe(200);
    const done = await callback({ taskId: r.body.task.id, status: 'done', prUrl: 'https://github.com/acme/erp/pull/42', runUrl: 'https://github.com/acme/erp/actions/runs/9', summary: 'Rang yangilandi' }, 'cb-secret-123');
    expect(done.status).toBe(200);
    const t = (await get(`/agent-tasks/${r.body.task.id}`)).body.task;
    expect(t).toMatchObject({ status: 'done', summary: 'Rang yangilandi' });
    expect(t.links).toEqual([{ label: 'Pull request', url: 'https://github.com/acme/erp/pull/42' }, { label: 'GitHub Actions', url: 'https://github.com/acme/erp/actions/runs/9' }]);
    expect(t.finishedAt).toBeTruthy();
    // Tugagan vazifa qayta ochilmaydi; begona havola qabul qilinmaydi
    const again = await callback({ taskId: r.body.task.id, status: 'failed', prUrl: 'https://evil.example/x' }, 'cb-secret-123');
    expect(again.body.note).toBe('ignored');
    expect((await get(`/agent-tasks/${r.body.task.id}`)).body.task.status).toBe('done');
  });

  it("GitHub rad etsa — failed (token xatoga qo'shilmaydi); bekor qilingan vazifa callbackni e'tiborsiz qoldiradi", async () => {
    githubEnv();
    fetchMock.mockResolvedValueOnce(new Response('{"message":"Bad credentials"}', { status: 401 }));
    const r = await post('/agent-tasks', { agentKey: 'qa', text: 'e2e test yoz' });
    await settle();
    const t = (await get(`/agent-tasks/${r.body.task.id}`)).body.task;
    expect(t).toMatchObject({ status: 'failed', error: 'github_401' });
    expect(JSON.stringify(t)).not.toContain('ghp_');

    const r2 = await post('/agent-tasks', { agentKey: 'qa', text: 'yana' });
    await settle();
    expect((await post(`/agent-tasks/${r2.body.task.id}/cancel`)).body.task.status).toBe('cancelled');
    expect((await post(`/agent-tasks/${r2.body.task.id}/cancel`)).status).toBe(409);
    await callback({ taskId: r2.body.task.id, status: 'done' }, 'cb-secret-123');
    expect((await get(`/agent-tasks/${r2.body.task.id}`)).body.task.status).toBe('cancelled');
    // Qayta yuborish (failed → queued → dispatch)
    expect((await post(`/agent-tasks/${r.body.task.id}/retry`)).status).toBe(200);
    await settle();
    expect((await get(`/agent-tasks/${r.body.task.id}`)).body.task.status).toBe('running');
  });

  it("Yangi funksiya: spetsifikatsiya → review → tasdiq (tahrir bilan) → dispatch matnida spetsifikatsiya", async () => {
    githubEnv();
    __setContentRunnerForTests(async () => ({ spec: 'Nima: ombor qoldig\'i\nKim: direktor' }));
    const r = await post('/agent-tasks', { agentKey: 'feature', text: "Ombor qoldig'i bo'limi kerak" });
    await settle();
    let t = (await get(`/agent-tasks/${r.body.task.id}`)).body.task;
    expect(t).toMatchObject({ status: 'review', spec: "Nima: ombor qoldig'i\nKim: direktor" });
    expect(fetchMock).not.toHaveBeenCalled();
    const office = await get('/office');
    expect(office.body.agents.find((a: any) => a.id === 'feature')).toMatchObject({ activity: 'review', busy: false });

    const ap = await post(`/agent-tasks/${r.body.task.id}/approve`, { spec: 'Nima: ombor qoldig\'i\nKim: direktor va o\'rinbosar' });
    expect(ap.status).toBe(200);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body).client_payload;
    expect(payload.text).toContain("Ombor qoldig'i bo'limi kerak");
    expect(payload.text).toContain("direktor va o'rinbosar");
    t = (await get(`/agent-tasks/${r.body.task.id}`)).body.task;
    expect(t.status).toBe('running');
    expect((await post(`/agent-tasks/${r.body.task.id}/approve`, {})).status).toBe(409);
  });
});

describe('content agentlari — Gemini', () => {
  it('SMM: tayyor postlar; xato bo\'lsa failed; Telegram — faqat sozlansa va bosilganda', async () => {
    const prompts: string[] = [];
    __setContentRunnerForTests(async (p) => { prompts.push(p); return { summary: '3 ta post', items: [{ title: 'Post 1', text: 'Smeta 5 daqiqada', hashtags: ['#qurilish'] }, { title: 'Bo\'sh', text: '' }] }; });
    const r = await post('/agent-tasks', { agentKey: 'smm', text: 'Haftalik 3 ta post' });
    await settle();
    const t = (await get(`/agent-tasks/${r.body.task.id}`)).body.task;
    expect(t).toMatchObject({ status: 'done', summary: '3 ta post', items: [{ title: 'Post 1', text: 'Smeta 5 daqiqada', hashtags: ['#qurilish'] }] });
    expect(prompts[0]).toContain('Haftalik 3 ta post');
    expect(prompts[0]).toContain('SMM');
    expect(fetchMock).not.toHaveBeenCalled(); // avtomatik e'lon yo'q

    expect((await post(`/agent-tasks/${r.body.task.id}/send`, { target: 'channel', index: 0 })).status).toBe(409);
    process.env.TELEGRAM_BOT_TOKEN = '123:abc';
    // kanal yo'q, lekin dasturchi botga ulangan — o'z chatiga ketadi (owner 2026-10-23)
    await User.updateOne({ _id: devId }, { telegramChatId: '5551234' });
    const own = await post(`/agent-tasks/${r.body.task.id}/send`, { target: 'channel', index: 0 });
    expect(own.status).toBe(200);
    expect(own.body.sentTo).toBe('developer');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).chat_id).toBe('5551234');
    fetchMock.mockClear();
    await User.updateOne({ _id: devId }, { $unset: { telegramChatId: 1 } });
    process.env.AGENT_TG_CHANNEL_ID = '@qurilish_kanal';
    expect((await post(`/agent-tasks/${r.body.task.id}/send`, { target: 'channel', index: 0 })).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ chat_id: '@qurilish_kanal', text: 'Post 1\n\nSmeta 5 daqiqada\n\n#qurilish' });

    __setContentRunnerForTests(async () => { throw new Error('503 overloaded'); });
    const r2 = await post('/agent-tasks', { agentKey: 'marketing', text: 'Kampaniya' });
    await settle();
    expect((await get(`/agent-tasks/${r2.body.task.id}`)).body.task).toMatchObject({ status: 'failed', error: 'gemini_failed' });
  });

  it("Tariflar boshqaruvchisi: promptda firmalar obunalari (faqat o'qish)", async () => {
    const prompts: string[] = [];
    __setContentRunnerForTests(async (p) => { prompts.push(p); return { summary: 'ok', items: [{ title: 'Taklif', text: 'Narxni saqlang' }] }; });
    const r = await post('/agent-tasks', { agentKey: 'billing', text: 'Qaysi obunalar tugayapti?' });
    await settle();
    expect((await get(`/agent-tasks/${r.body.task.id}`)).body.task.status).toBe('done');
    expect(prompts[0]).toContain('Obunalar');
    expect(prompts[0]).toContain('Agent'); // seedCompany firmasi nomi
  });
});

describe('Boshliq va Hisobotchi', () => {
  it("Boshliq: reja → review → tasdiq (tahrir) → bo'lak vazifalar → hammasi tugagach maqsad yopiladi", async () => {
    __setContentRunnerForTests(async (p) => {
      if (p.includes('Egasining maqsadi')) return { plan: [{ agentKey: 'smm', text: 'Post yoz' }, { agentKey: 'marketing', text: 'Reja tuz' }, { agentKey: 'yoq', text: 'x' }, { agentKey: 'role-direktor', text: 'x' }] };
      return { summary: 'tayyor', items: [{ title: 't', text: 'matn' }] };
    });
    const r = await post('/agent-tasks', { agentKey: 'manager', text: 'Yangi mijozlar jalb qilish' });
    await settle();
    let t = (await get(`/agent-tasks/${r.body.task.id}`)).body.task;
    expect(t.status).toBe('review');
    expect(t.plan).toEqual([{ agentKey: 'smm', text: 'Post yoz' }, { agentKey: 'marketing', text: 'Reja tuz' }]);

    expect((await post(`/agent-tasks/${r.body.task.id}/approve`, { plan: [{ agentKey: 'nope', text: 'x' }] })).status).toBe(400);
    const ap = await post(`/agent-tasks/${r.body.task.id}/approve`, { plan: [{ agentKey: 'smm', text: 'Post yoz (2 ta)' }] });
    expect(ap.status).toBe(200);
    expect(ap.body.task.plan[0]).toMatchObject({ agentKey: 'smm', text: 'Post yoz (2 ta)' });
    expect(ap.body.task.plan[0].taskId).toBeTruthy();
    await settle();
    const kid = (await get(`/agent-tasks/${ap.body.task.plan[0].taskId}`)).body.task;
    expect(kid).toMatchObject({ status: 'done', parentId: r.body.task.id });
    t = (await get(`/agent-tasks/${r.body.task.id}`)).body.task;
    expect(t.status).toBe('done');
    expect(t.summary).toMatch(/tayyor 1/);
  });

  it("Hisobotchi: AI ishlamasa — tuzilgan ro'yxat; boshqa agent tugagach avtomatik hisobot", async () => {
    githubEnv();
    await AgentTask.create({ agentKey: 'backend', agentKind: 'code', text: 'API tuzat', status: 'done', finishedAt: new Date(), links: [{ label: 'Pull request', url: 'https://github.com/acme/erp/pull/7' }] });
    await AgentTask.create({ agentKey: 'qa', agentKind: 'code', text: 'Test yoz', status: 'failed', error: 'workflow_failed', finishedAt: new Date() });
    __setContentRunnerForTests(async () => { throw new Error('GEMINI_API_KEY sozlanmagan'); });
    const r = await post('/agent-tasks', { agentKey: 'reporter', text: 'bugungi hisobot' });
    await settle();
    const t = (await get(`/agent-tasks/${r.body.task.id}`)).body.task;
    expect(t.status).toBe('done');
    expect(t.summary).toContain('Backend');
    expect(t.summary).toContain('https://github.com/acme/erp/pull/7');
    expect(t.summary).toContain('GitHub Actions xato bilan tugadi');
    expect(t.summary).toContain('Sizdan kerak');
    expect(t.links).toEqual([{ label: 'Backend: PR', url: 'https://github.com/acme/erp/pull/7' }]);

    // DEVELOPER_CHAT_ID'ga yuborish — faqat sozlansa
    expect((await post(`/agent-tasks/${r.body.task.id}/send`, { target: 'developer' })).status).toBe(409);
    process.env.TELEGRAM_BOT_TOKEN = '123:abc';
    process.env.DEVELOPER_CHAT_ID = '777';
    expect((await post(`/agent-tasks/${r.body.task.id}/send`, { target: 'developer' })).status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).chat_id).toBe('777');

    // Avtomatik: content agenti tugadi → 60 s ichida bitta hisobot
    __setContentRunnerForTests(async () => ({ summary: 'AI hisobot', items: [{ title: 'a', text: 'b' }] }));
    await post('/agent-tasks', { agentKey: 'docs', text: 'FAQ yoz' });
    await settle();
    expect(await __fireAutoReportForTests()).toBe(true);
    const reports = await AgentTask.find({ agentKey: 'reporter' }).sort({ createdAt: -1 }).lean();
    expect(reports.length).toBe(2);
    expect(reports[0]).toMatchObject({ status: 'done', summary: 'AI hisobot' });
  });

  it("Boshliq yangi agent yaratadi (Gemini): serverda saqlanadi, ofisda ko'rinadi, buyruq oladi, audit yoziladi", async () => {
    __setContentRunnerForTests(async (p) => {
      if (p.includes('yangi agent so')) return { name: 'Ombor nazorati', kind: 'code', team: 'platform', description: 'Ombor qoldiqlari moduli', systemPrompt: 'Sen ombor agentisan.' };
      return { summary: 'ok', items: [{ title: 'a', text: 'b' }] };
    });
    const r = await post('/agent-tasks', { agentKey: 'manager', text: "Ombor ishi uchun agent yonla" });
    await settle();
    const t = (await get(`/agent-tasks/${r.body.task.id}`)).body.task;
    expect(t.status).toBe('done');
    expect(t.spawnedKey).toMatch(/^custom-[0-9a-f]{8}$/);
    expect(t.summary).toContain('Ombor nazorati');
    const prof = await AgentProfile.findOne({ key: t.spawnedKey }).lean();
    expect(prof).toMatchObject({ name: 'Ombor nazorati', kind: 'code', team: 'platform', builtIn: false, createdBy: devId, systemPrompt: 'Sen ombor agentisan.' });
    const office = await get('/office');
    expect(office.body.agents.find((a: any) => a.id === t.spawnedKey)).toMatchObject({ name: 'Ombor nazorati', kind: 'code', team: 'platform' });
    expect((await post('/agent-tasks', { agentKey: t.spawnedKey, text: 'Ombor sahifasi' })).status).toBe(200);
    const audit = await AuditLog.findOne({ entity: 'ai_office_agent', entityId: t.spawnedKey }).lean();
    expect(audit).toMatchObject({ action: 'create', userId: devId });
    // Rejaga aylanmaydi
    expect(t.plan).toEqual([]);
  });

  it("Boshliq yangi agent — AI'siz zaxira; nom band bo'lsa raqam qo'shiladi; oddiy maqsad esa reja bo'ladi", async () => {
    __setContentRunnerForTests(async () => { throw new Error('GEMINI_API_KEY sozlanmagan'); });
    const r = await post('/agent-tasks', { agentKey: 'manager', text: "yangi agent qo'sh: SMM postlar tahlili" });
    await settle();
    const t = (await get(`/agent-tasks/${r.body.task.id}`)).body.task;
    expect(t.status).toBe('done');
    const prof: any = await AgentProfile.findOne({ key: t.spawnedKey }).lean();
    expect(prof.name).toBe('SMM postlar tahlili');
    expect(prof).toMatchObject({ kind: 'content', team: 'growth' });
    const r2 = await post('/agent-tasks', { agentKey: 'manager', text: "yangi agent qo'sh: SMM postlar tahlili" });
    await settle();
    const t2 = (await get(`/agent-tasks/${r2.body.task.id}`)).body.task;
    expect((await AgentProfile.findOne({ key: t2.spawnedKey }).lean() as any).name).toBe('SMM postlar tahlili 2');
    // Dasturchi qo'lda: bir xil nom 409
    expect((await post('/agents', { name: 'smm postlar tahlili', kind: 'code' })).status).toBe(409);
    const r3 = await post('/agent-tasks', { agentKey: 'manager', text: 'Mijozlar sonini oshirish' });
    await settle();
    expect((await get(`/agent-tasks/${r3.body.task.id}`)).body.task.status).toBe('review');
  });

  it('agent yaratish iborasi va zaxira loyiha', () => {
    for (const s of ["Ombor ishi uchun agent yonla", "yangi agent qo'sh: X", 'Создай агента для склада', 'добавь нового агента', "GPS uchun agent yarat"]) expect(SPAWN_RE.test(s), s).toBe(true);
    for (const s of ['Mijozlar sonini oshirish', 'Agentlar hisobotini ber']) expect(SPAWN_RE.test(s), s).toBe(false);
    expect(fallbackAgentDraft('Ombor ishi uchun agent yonla')).toMatchObject({ name: 'Ombor', kind: 'code', team: 'platform' });
    expect(fallbackAgentDraft("yangi agent qo'sh: Telegram bot reklamasi").team).toBe('growth');
  });

  it('hisobot davri va zaxira matn', () => {
    const now = Date.UTC(2026, 9, 22, 10, 0); // Toshkent 15:00
    expect(reportPeriod('bugungi hisobot', now)).toEqual({ from: Date.UTC(2026, 9, 21, 19, 0), label: 'bugun' });
    expect(reportPeriod('haftalik', now).label).toBe('oxirgi 7 kun');
    expect(reportPeriod('x', now).label).toBe('oxirgi 24 soat');
    expect(plainReport([], new Map(), 'bugun')).toMatch(/vazifa berilmagan/);
  });
});
