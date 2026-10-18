// VoiceSessionManager (P5) — FakeVoiceProvider bilan: disclosure birinchi, tool ko'prigi (executor,
// aktyor qayta tekshiruvi), A7 (tool javobidan oldin "muvaffaqiyat" ovozi/matni o'tmaydi), tasdiq (B3),
// davomiylik chegarasi, GoAway resume, usage, busy (partial indeks), platforma cap, SIGTERM drain,
// transkript → AiConversation, zaxira provayder.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiCallSession from '../../models/AiCallSession';
import AiConversation from '../../models/AiConversation';
import AiUsageMetrics from '../../models/AiUsageMetrics';
import User from '../../models/User';
import { __setActorCacheTtlForTests, invalidateActor } from '../actor';
import type { AivEndReason, ToolResult } from '../contracts';
import { registerTool, unregisterTool } from '../tools/registry';
import type { AiToolDef } from '../tools/types';
import { tone } from '../voice/audio';
import { FakeVoiceProvider, type FakeVoiceSession } from '../voice/fakeProvider';
import type { ProviderKind } from '../voice/provider';
import { VoiceSessionManager } from '../voice/sessionManager';
import type { StartVoiceSessionOpts, VoiceSessionHandle, VoiceTransport } from '../voice/types';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany;
const saved = { en: process.env.AI_VOICE_ENABLED, cap: process.env.AI_LIVE_MAX_CONCURRENT };

class FakeTransport implements VoiceTransport {
  audio: Buffer[] = [];
  events: { event: string; payload: any }[] = [];
  closed?: AivEndReason;
  flushes = 0;
  constructor(public kind: 'inapp' | 'telegram' = 'inapp') {}
  sendAudio(b: Buffer) { this.audio.push(b); }
  flushAudio() { this.flushes++; }
  sendEvent(event: string, payload: unknown) { this.events.push({ event, payload }); }
  close(r: AivEndReason) { this.closed = r; }
  get audioBytes() { return this.audio.reduce((a, b) => a + b.length, 0); }
  ev(name: string) { return this.events.filter((e) => e.event === name).map((e) => e.payload); }
}

const CLIP = tone(100, 24_000);          // 4800 bayt
const ALL = ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi'] as const;
let release: ((r?: Partial<ToolResult>) => void) | null = null;
let slowCalls = 0;
let noteCalls = 0;

const slowTool: AiToolDef = {
  name: 'p5Slow', description: { uz: 'sekin', ru: 'медленно' }, parameters: { type: 'object', properties: {} },
  kind: 'read', maxRoles: [...ALL], defaultRoles: [...ALL], purposes: ['assistant'], channels: ['inapp_call', 'telegram_call'],
  behavior: 'BLOCKING', confirm: 'never',
  handler: () => new Promise((res) => {
    slowCalls++;
    release = (r) => res({ status: 'ok', message: 'tayyor', retryable: false, ...(r || {}) });
  }),
};
const noteTool: AiToolDef = {
  name: 'p5Note', description: { uz: 'eslatma', ru: 'заметка' },
  parameters: { type: 'object', properties: { targetUserId: { type: 'string', format: 'objectId' } }, required: ['targetUserId'] },
  kind: 'write', maxRoles: [...ALL], defaultRoles: [...ALL], purposes: ['assistant'], channels: ['inapp_call'],
  behavior: 'BLOCKING', confirm: 'when_other_user', refs: { targetUserId: 'User' }, targetUserArg: 'targetUserId',
  summarize: () => 'Eslatma yuborish', auditEntity: 'ai_note',
  handler: async () => { noteCalls++; return { status: 'ok', message: 'yuborildi', retryable: false }; },
};

function mk(o: { live?: FakeVoiceProvider | null; cascade?: FakeVoiceProvider | null; clip?: Buffer | null; clipOnLive?: boolean } = {}) {
  const live = o.live === undefined ? new FakeVoiceProvider() : o.live;
  const cascade = o.cascade === undefined ? null : o.cascade;
  const mgr = new VoiceSessionManager({
    providerFor: (kind: ProviderKind) => (kind === 'gemini_live' ? live : cascade),
    clipOnLive: o.clipOnLive ?? true, disclosure: { getClip: async () => (o.clip === undefined ? CLIP : o.clip) },
    setupTimeoutMs: 1_000, touchMs: 200, disclosureTimeoutMs: 500,
  });
  return { mgr, live: live!, cascade };
}

const managers: VoiceSessionManager[] = [];
async function startCall(mgr: VoiceSessionManager, extra: Partial<StartVoiceSessionOpts> = {}, transport = new FakeTransport()) {
  managers.push(mgr);
  const r = await mgr.start({
    companyId: A.companyId, employeeId: A.workerId, purpose: 'assistant', channel: transport.kind === 'telegram' ? 'telegram_call' : 'inapp_call',
    lang: 'uz', ptt: false, transport, ...extra,
  });
  return { r, transport };
}

async function connect(h: VoiceSessionHandle, live: FakeVoiceProvider): Promise<FakeVoiceSession> {
  await h.connected();
  await vi.waitFor(() => expect(live.last?.texts.length).toBeGreaterThan(0));
  return live.last!;
}

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  mongo = await startMongo();
  await AiConversation.init();
  __setActorCacheTtlForTests(0);
  A = await seedCompany('P5A');
  registerTool(slowTool);
  registerTool(noteTool);
}, 120_000);

afterEach(async () => {
  for (const m of managers.splice(0)) { await m.drain(2_000); m.dispose(); }
  await AiCallSession.updateMany({ isActive: true }, { $set: { isActive: false, status: 'cancelled' } });
  delete process.env.AI_LIVE_MAX_CONCURRENT;
  release = null;
});

afterAll(async () => {
  unregisterTool('p5Slow');
  unregisterTool('p5Note');
  __setActorCacheTtlForTests(10_000);
  process.env.AI_VOICE_ENABLED = saved.en;
  if (saved.cap !== undefined) process.env.AI_LIVE_MAX_CONCURRENT = saved.cap;
  await stopMongo(mongo);
});

describe('VoiceSessionManager', () => {
  it('ringing paytida provayder oldindan ulanadi; disclosure klipi model ovozidan OLDIN, keyin "start" navbati', async () => {
    const { mgr, live } = mk();
    const { r, transport } = await startCall(mgr);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await vi.waitFor(() => expect(live.opens.length).toBe(1));            // accept'dan OLDIN
    expect(live.opens[0].tools.every((t) => t.behavior === 'BLOCKING')).toBe(true);
    const fs = await connect(r.handle, live);
    expect(transport.ev('aiv:ready')[0]).toMatchObject({ sessionId: r.handle.sessionId, inputSampleRate: 16000, outputSampleRate: 24000 });
    expect(transport.audioBytes).toBe(CLIP.length);                        // klip to'liq, birinchi
    expect(fs.texts[0]).toMatch(/^\[TIZIM\]/);
    expect(transport.ev('aiv:transcript')[0]).toMatchObject({ role: 'assistant', final: true });
    fs.speak(tone(40, 24_000));
    await vi.waitFor(() => expect(transport.audioBytes).toBe(CLIP.length + 1920));
    const doc: any = await AiCallSession.findById(r.handle.sessionId).lean();
    expect(doc).toMatchObject({ status: 'connected', provider: 'gemini_live', direction: 'inbound' });
  });

  it('A7: tool javobidan oldin model ovozi/matni o\'tkazilmaydi; javobdan keyin o\'tadi', async () => {
    const { mgr, live } = mk();
    const { r, transport } = await startCall(mgr);
    if (!r.ok) throw new Error('start');
    const fs = await connect(r.handle, live);
    const audioBefore = transport.audioBytes;
    fs.callTool('t1', 'p5Slow', {});
    await vi.waitFor(() => expect(release).toBeTruthy());
    fs.speak(tone(200, 24_000));
    fs.say('Bajarildi!');
    await new Promise((res) => setTimeout(res, 50));
    expect(transport.audioBytes).toBe(audioBefore);
    expect(transport.ev('aiv:transcript').some((t) => t.text === 'Bajarildi!')).toBe(false);
    expect(fs.toolResponses).toHaveLength(0);
    release!();
    await vi.waitFor(() => expect(fs.toolResponses).toHaveLength(1));
    expect(fs.toolResponses[0]).toMatchObject({ id: 't1', name: 'p5Slow', result: { status: 'ok' } });
    expect(transport.ev('aiv:tool')[0]).toMatchObject({ name: 'p5Slow', status: 'ok' });
    fs.speak(tone(40, 24_000));
    fs.say('Tayyor.');
    await vi.waitFor(() => expect(transport.audioBytes).toBe(audioBefore + 1920));
    expect(transport.ev('aiv:transcript').some((t) => t.text === 'Tayyor.')).toBe(true);
  });

  it('B2: aktyor har tool chaqiruvida qayta tekshiriladi — bloklangan foydalanuvchi: denied va sessiya revoked', async () => {
    const { mgr, live } = mk();
    const { r, transport } = await startCall(mgr, { employeeId: A.worker2Id });
    if (!r.ok) throw new Error('start');
    const fs = await connect(r.handle, live);
    await User.updateOne({ _id: A.worker2Id }, { $set: { isBlocked: true } });
    invalidateActor(A.worker2Id);
    const before = slowCalls;
    fs.callTool('t9', 'p5Slow', {});
    await vi.waitFor(() => expect(transport.closed).toBe('revoked'));
    expect(slowCalls).toBe(before);
    expect(fs.toolResponses[0]?.result.status).toBe('denied');
    const doc: any = await AiCallSession.findById(r.handle.sessionId).lean();
    expect(doc).toMatchObject({ isActive: false, status: 'interrupted' });
    await User.updateOne({ _id: A.worker2Id }, { $set: { isBlocked: false } });
    invalidateActor(A.worker2Id);
  });

  it('noma\'lum/ruxsatsiz tool — denied, handler chaqirilmaydi', async () => {
    const { mgr, live } = mk();
    const { r } = await startCall(mgr);
    if (!r.ok) throw new Error('start');
    const fs = await connect(r.handle, live);
    fs.callTool('x1', 'confirmPendingAction', { id: 'x' });
    await vi.waitFor(() => expect(fs.toolResponses).toHaveLength(1));
    expect(fs.toolResponses[0].result.status).toBe('denied');
  });

  it('B3: boshqa foydalanuvchiga yozuv — tasdiq kartasi; tugma bilan bir marta bajariladi', async () => {
    const { mgr, live } = mk();
    const { r, transport } = await startCall(mgr);
    if (!r.ok) throw new Error('start');
    const fs = await connect(r.handle, live);
    fs.callTool('n1', 'p5Note', { targetUserId: A.worker2Id });
    await vi.waitFor(() => expect(fs.toolResponses).toHaveLength(1));
    expect(fs.toolResponses[0].result.status).toBe('needs_confirmation');
    expect(noteCalls).toBe(0);
    const card = transport.ev('aiv:confirm')[0];
    expect(card?.pendingActionId).toMatch(/^[0-9a-f]{24}$/);
    const [a1, a2] = await Promise.all([r.handle.confirmAction(card.pendingActionId, true), r.handle.confirmAction(card.pendingActionId, true)]);
    expect(noteCalls).toBe(1);
    const oks = [a1, a2].filter((a) => a.ok && a.status === 'ok');
    expect(oks).toHaveLength(1);
    expect(fs.texts.some((t) => t.includes('status=ok'))).toBe(true);
  });

  it('davomiylik: chegarada qattiq to\'xtatish (max_duration → completed)', async () => {
    const { mgr, live } = mk();
    const { r, transport } = await startCall(mgr, { maxDurationSec: 1 });
    if (!r.ok) throw new Error('start');
    await connect(r.handle, live);
    await vi.waitFor(() => expect(transport.closed).toBe('max_duration'), { timeout: 3_000 });
    const doc: any = await AiCallSession.findById(r.handle.sessionId).lean();
    expect(doc).toMatchObject({ isActive: false, status: 'completed', endReason: 'max_duration' });
    expect(live.last!.closed).toBe(true);
  });

  it('jiringlash vaqti tugasa — no_answer; provayder yopiladi', async () => {
    const { mgr, live } = mk();
    const { r, transport } = await startCall(mgr, { ringTimeoutSec: 1, purpose: 'attendance' });
    if (!r.ok) throw new Error('start');
    await vi.waitFor(() => expect(transport.closed).toBe('timeout'), { timeout: 3_000 });
    const doc: any = await AiCallSession.findById(r.handle.sessionId).lean();
    expect(doc).toMatchObject({ status: 'no_answer', direction: 'outbound' });
    await vi.waitFor(() => expect(live.last?.closed).toBe(true));
  });

  it('GoAway → resumption handle bilan qayta ulanish; eski sessiya yopiladi, ovoz davom etadi', async () => {
    const { mgr, live } = mk();
    const { r, transport } = await startCall(mgr);
    if (!r.ok) throw new Error('start');
    const fs = await connect(r.handle, live);
    fs.resumption('h-1');
    fs.goAway(3_000);
    await vi.waitFor(() => expect(live.opens).toHaveLength(2));
    expect(live.opens[1].resumptionHandle).toBe('h-1');
    await vi.waitFor(() => expect(fs.closedReason).toBe('goaway'));
    const before = transport.audioBytes;
    fs.speak(tone(40, 24_000));                       // eski sessiya — e'tiborsiz
    live.last!.speak(tone(40, 24_000));
    await vi.waitFor(() => expect(transport.audioBytes).toBe(before + 1920));
    expect(transport.closed).toBeUndefined();
  });

  it('provayder kutilmaganda uzilsa va handle bo\'lmasa — interrupted', async () => {
    const { mgr, live } = mk();
    const { r, transport } = await startCall(mgr);
    if (!r.ok) throw new Error('start');
    const fs = await connect(r.handle, live);
    fs.drop();
    await vi.waitFor(() => expect(transport.closed).toBe('error'));
    expect(((await AiCallSession.findById(r.handle.sessionId).lean()) as any).status).toBe('interrupted');
  });

  it('usage: audio sekundlari va tokenlar AiCallSession va AiUsageMetrics\'ga; transkript AiConversation\'ga', async () => {
    const { mgr, live } = mk();
    const { r } = await startCall(mgr);
    if (!r.ok) throw new Error('start');
    const fs = await connect(r.handle, live);
    await new Promise((res) => setTimeout(res, 150));                     // disclosure davomida kirish yopiq
    r.handle.pushAudio(Buffer.alloc(32_000));
    fs.usage({ tokensIn: 100, tokensOut: 50 });
    fs.hear('Salom, vazifalarim qanday? +998 90 123 45 67');
    fs.say('Sizda 2 ta vazifa bor.');
    await r.handle.end('hangup');
    expect(fs.pushedBytes).toBe(32_000);
    const doc: any = await AiCallSession.findById(r.handle.sessionId).lean();
    expect(doc.status).toBe('completed');
    expect(doc.usage).toMatchObject({ audioInSec: 1, tokensIn: 100, tokensOut: 50 });
    expect(await AiUsageMetrics.countDocuments({ companyId: A.companyId })).toBeGreaterThan(0);
    const conv: any = await AiConversation.findOne({ sessionId: r.handle.sessionId }).lean();
    expect(conv).toMatchObject({ source: 'voice_inapp', userId: A.workerId, companyId: A.companyId, correlationId: r.handle.correlationId });
    expect(conv.messages.map((m: any) => m.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(conv.messages[1].content).not.toContain('123 45 67');            // telefon maskalangan
  });

  it('Telegram transporti: transkript source=telegram_call', async () => {
    const { mgr, live } = mk();
    const { r } = await startCall(mgr, {}, new FakeTransport('telegram'));
    if (!r.ok) throw new Error('start');
    const fs = await connect(r.handle, live);
    fs.hear('Ha, kelaman');
    await r.handle.end('hangup');
    const conv: any = await AiConversation.findOne({ sessionId: r.handle.sessionId }).lean();
    expect(conv.source).toBe('telegram_call');
  });

  it('busy: bitta xodimga ikkinchi faol sessiya — partial unique indeks', async () => {
    process.env.AI_LIVE_MAX_CONCURRENT = '5';
    const { mgr } = mk();
    const a = await startCall(mgr);
    expect(a.r.ok).toBe(true);
    const b = await startCall(mgr);
    expect(b.r).toEqual({ ok: false, reason: 'busy' });
  });

  it('platforma cap (AI_LIVE_MAX_CONCURRENT=1): ikkinchi xodim — platform_cap', async () => {
    const { mgr } = mk();
    const a = await startCall(mgr);
    expect(a.r.ok).toBe(true);
    const b = await startCall(mgr, { employeeId: A.prorabId });
    expect(b.r).toEqual({ ok: false, reason: 'platform_cap' });
  });

  it('SIGTERM drain: sessiyalar interrupted (shutdown)', async () => {
    const { mgr, live } = mk();
    const { r, transport } = await startCall(mgr);
    if (!r.ok) throw new Error('start');
    await connect(r.handle, live);
    await mgr.drain(2_000);
    expect(transport.closed).toBe('shutdown');
    const doc: any = await AiCallSession.findById(r.handle.sessionId).lean();
    expect(doc).toMatchObject({ isActive: false, status: 'interrupted', endReason: 'shutdown' });
    expect((await mgr.start({ companyId: A.companyId, employeeId: A.workerId, purpose: 'assistant', channel: 'inapp_call', lang: 'uz', ptt: false, transport })).ok).toBe(false);
  });

  it('Live ochilmasa — kaskad zaxirasi; hech biri bo\'lmasa — failed', async () => {
    const cascade = new FakeVoiceProvider({ name: 'gemini_cascade' });
    const { mgr } = mk({ live: new FakeVoiceProvider({ failOpen: true }), cascade });
    const { r } = await startCall(mgr);
    if (!r.ok) throw new Error('start');
    await vi.waitFor(async () => expect(((await AiCallSession.findById(r.handle.sessionId).lean()) as any).provider).toBe('gemini_cascade'));
    await r.handle.end('hangup');

    const none = mk({ live: null, cascade: null });
    const x = await startCall(none.mgr);
    if (!x.r.ok) throw new Error('start');
    await vi.waitFor(() => expect(x.transport.closed).toBe('error'));
    expect(((await AiCallSession.findById(x.r.handle.sessionId).lean()) as any).status).toBe('failed');
  });

  it('TTS klipi bo\'lmasa — model AYNAN disclosure jumlasi bilan boshlashga majbur (matnli zaxira)', async () => {
    const { mgr, live } = mk({ clip: null });
    const { r, transport } = await startCall(mgr);
    if (!r.ok) throw new Error('start');
    const fs = await connect(r.handle, live);
    expect(transport.audioBytes).toBe(0);
    expect(fs.texts[0]).toMatch(/AYNAN shu jumla bilan boshlang/);
    expect(fs.texts[0]).toMatch(/sun'iy intellekt/);
  });

  it("salom (owner 2026-10-19): birinchi marta — tanishtiruv; keyin — ism bilan qisqa salom, klip yo'q", async () => {
    await AiCallSession.deleteMany({ employeeId: A.worker2Id });
    const { mgr, live } = mk({ clipOnLive: false });
    const first = await startCall(mgr, { employeeId: A.worker2Id });
    if (!first.r.ok) throw new Error('start');
    const fs1 = await connect(first.r.handle, live);
    expect(first.transport.audioBytes).toBe(0);
    expect(fs1.texts[0]).toMatch(/BIRINCHI suhbat/);
    expect(fs1.texts[0]).toMatch(/P5A-ishchi2/);
    await first.r.handle.end('completed_remote');
    await AiCallSession.updateOne({ _id: first.r.handle.sessionId }, { $set: { answeredAt: new Date() } });
    const second = await startCall(mgr, { employeeId: A.worker2Id });
    if (!second.r.ok) throw new Error('start2');
    const fs2 = await connect(second.r.handle, live);
    expect(fs2.texts[0]).toMatch(/TANISHTIRMANG/);
    expect(fs2.texts[0]).toMatch(/aka.*opa|opa/);
    expect(fs2.texts[0]).toMatch(/qanday yordam bera olaman/);
  });

  it('barge-in: interrupted — kutayotgan audio tashlanadi, mijozga aiv:interrupted', async () => {
    const { mgr, live } = mk();
    const { r, transport } = await startCall(mgr);
    if (!r.ok) throw new Error('start');
    const fs = await connect(r.handle, live);
    fs.speak(tone(3_000, 24_000));                    // 3 s — ko'pi navbatda (pacing ~400 ms oldinda)
    const sentSoon = transport.audioBytes;
    expect(sentSoon).toBeLessThan(CLIP.length + 48 * 1000);
    fs.interrupt();
    expect(transport.ev('aiv:interrupted')).toHaveLength(1);
    expect(transport.flushes).toBe(1);
    await new Promise((res) => setTimeout(res, 300));
    expect(transport.audioBytes).toBe(sentSoon);
  });
});
