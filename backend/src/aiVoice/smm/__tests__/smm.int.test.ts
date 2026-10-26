// SMM (owner 2026-10-23): rasmli postlar, Telegram (sendPhoto / uzun matn), Instagram Graph API (post, karusel, reels,
// story — konteyner → holat → publish), vaqtinchalik fayllar (token, TTL, o'chirish), avtopilot (tasdiq bilan / to'liq
// avto, slot bir marta, kunlik limit, kill-switch, sozlanmagan joyga e'lon yo'q), statistika, sozlamalar. fetch — soxta.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AgentProfile from '../../../models/AgentProfile';
import AgentTask from '../../../models/AgentTask';
import AuditLog from '../../../models/AuditLog';
import User from '../../../models/User';
import { SmmInsight, SmmRun, SmmSettings, SmmTempMedia } from '../../../models/Smm';
import { JWT_SECRET } from '../../../middleware/auth';
import { mountAiVoiceRoutes } from '../../bootstrap';
import { __drainAgentsForTests, __resetAgentsForTests, __setContentRunnerForTests } from '../../agents/service';
import { startMongo, stopMongo } from '../../__tests__/helpers';
import { __setIgSleepForTests, igMaybeRefresh, igPublish, mapGraphError } from '../instagram';
import { __drainSmmForTests, captionOf, resolveKind } from '../publish';
import { dueSlot, nextSlot, pickLeastRecent, smmTick } from '../autopilot';
import { putTemp, getTemp } from '../tempMedia';
import { smmRender, wrapText, ffmpegAvailable, renderTemplate } from '../render';
import { tgMessageUrl } from '../telegram';
import { __resetChannelCacheForTests, formatChannelPost, paragraphs } from '../channel';
import { __resetBotUiForTests, setBotUiSnapshot } from '../../../services/botUi/runtime';
import { zonedToUtc } from '../../lib/zonedTime';

let mongo: MongoMemoryServer;
let devId: string;
const ENV_KEYS = ['AI_VOICE_ENABLED', 'INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_USER_ID', 'META_APP_ID', 'META_APP_SECRET', 'INSTAGRAM_GRAPH_HOST', 'AGENT_TG_CHANNEL_ID',
  'DEVELOPER_CHAT_ID', 'TELEGRAM_BOT_TOKEN', 'RENDER_EXTERNAL_URL', 'BACKEND_URL', 'GEMINI_API_KEY', 'GEMINI_API_KEYS', 'SMM_AUTOPILOT_DISABLED', 'AI_SECRETS_KEY'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

const app = express();
app.use(express.json());
mountAiVoiceRoutes(app);
const tok = (id: string) => `Bearer ${jwt.sign({ userId: id }, JWT_SECRET)}`;
const P = '/api/ai-voice/platform';
const get = (path: string) => request(app).get(`${P}${path}`).set('Authorization', tok(devId));
const post = (path: string, body: object = {}) => request(app).post(`${P}${path}`).set('Authorization', tok(devId)).send(body);
const put = (path: string, body: object = {}) => request(app).put(`${P}${path}`).set('Authorization', tok(devId)).send(body);

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), Buffer.alloc(300, 1)]);
const ITEM = {
  title: 'Smeta 5 daqiqada', text: 'QurilishERP bilan smetani tez tuzing. Sinab ko\'ring!', hashtags: ['#qurilish', 'erp'], format: 'post', category: 'feature',
  topic: 'Smeta tezligi', imagePrompt: 'engineer with tablet at construction site', scenes: [{ title: 'Muammo', text: 'Smeta 3 kun' }, { title: 'Yechim', text: '5 daqiqa' }],
};

// ── Soxta tashqi API'lar ──
type Call = { url: string; method: string; body: any };
let calls: Call[] = [];
let graphMode: 'ok' | 'container_error' | 'token_bad' = 'ok';
let statusPolls = 0;
let memberResult: any = { status: 'administrator', can_post_messages: true };
let rejectCustomEmoji = false;
const fetchMock = vi.fn(async (input: any, init: any = {}) => {
  const url = String(input);
  const method = init.method || 'GET';
  let body: any = init.body;
  if (body instanceof URLSearchParams) body = Object.fromEntries(body.entries());
  else if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* */ } }
  calls.push({ url, method, body });
  const j = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://api.telegram.org/')) {
    const m = url.split('/').pop()!;
    if (m === 'getMe') return j({ ok: true, result: { id: 777, is_bot: true, username: 'qurilish_erp_bot' } });
    if (m === 'getChat') {
      if (body?.chat_id === '@kanal_yoq') return j({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400);
      if (body?.chat_id === '@guruh_erp') return j({ ok: true, result: { id: -100555, type: 'supergroup', title: 'Guruh' } });
      return j({ ok: true, result: { id: -1001234567890, type: 'channel', title: 'QurilishERP yangiliklari', username: 'erp_kanal' } });
    }
    if (m === 'getChatMember') return j({ ok: true, result: memberResult });
    const payload = body instanceof FormData ? String(body.get('caption') || '') : String(body?.text || '');
    if (rejectCustomEmoji && payload.includes('<tg-emoji')) return j({ ok: false, error_code: 400, description: 'Bad Request: ENTITY_TEXT_INVALID' }, 400);
    return j({ ok: true, result: m === 'sendMediaGroup' ? [{ message_id: 41 }, { message_id: 42 }] : { message_id: m === 'sendMessage' ? 50 : 40 } });
  }
  if (url.startsWith('https://generativelanguage.googleapis.com/')) {
    return j({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('PNGDATA').toString('base64') } }] } }] });
  }
  if (url.includes('graph.instagram.com/refresh_access_token')) return j({ access_token: 'IGQnewtoken', token_type: 'bearer', expires_in: 5184000 });
  if (/graph\.(instagram|facebook)\.com/.test(url)) {
    if (graphMode === 'token_bad') return j({ error: { message: 'Error validating access token: Session has expired', code: 190, type: 'OAuthException' } }, 400);
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v[\d.]+\//, '');
    if (method === 'POST' && path.endsWith('/media')) return j({ id: `c${calls.filter((c) => c.url.endsWith('/media')).length}` });
    if (method === 'POST' && path.endsWith('/media_publish')) return j({ id: '17900000000000001' });
    if (u.searchParams.get('fields') === 'status_code,status') {
      statusPolls++;
      if (graphMode === 'container_error') return j({ status_code: 'ERROR', status: 'Error: aspect ratio' });
      return j({ status_code: statusPolls % 2 ? 'IN_PROGRESS' : 'FINISHED' });
    }
    if (u.searchParams.get('fields') === 'permalink') return j({ permalink: 'https://www.instagram.com/p/ABC123/' });
    if (path.endsWith('/insights') && path.startsWith('17900')) return j({ data: [{ name: 'reach', values: [{ value: 120 }] }, { name: 'likes', total_value: { value: 9 } }, { name: 'saved', values: [{ value: 3 }] }] });
    if (path.endsWith('/insights')) return j({ data: [{ name: 'reach', total_value: { value: 900 } }, { name: 'profile_views', total_value: { value: 33 } }] });
    if (u.searchParams.get('fields')?.includes('followers_count')) return j({ username: 'qurilisherp', followers_count: 1500, media_count: 42 });
    if (u.searchParams.get('fields')?.includes('like_count')) return j({ like_count: 9, comments_count: 2 });
    if (path === 'me') return j({ user_id: '1784', username: 'qurilisherp' });
    return j({});
  }
  return new Response(null, { status: 204 });
});

function igEnv() {
  process.env.INSTAGRAM_ACCESS_TOKEN = 'IGQsecrettoken123';
  process.env.INSTAGRAM_USER_ID = '1784';
  process.env.RENDER_EXTERNAL_URL = 'https://api.example.uz';
}
async function smmTask(items: any[] = [ITEM]): Promise<string> {
  __setContentRunnerForTests(async () => ({ summary: 'ok', items }));
  const r = await post('/agent-tasks', { agentKey: 'smm', text: '1 ta post' });
  expect(r.status).toBe(200);
  await __drainAgentsForTests();
  return r.body.task.id;
}
const graphCalls = () => calls.filter((c) => /graph\./.test(c.url));
const tgCalls = () => calls.filter((c) => c.url.startsWith('https://api.telegram.org/'));

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  mongo = await startMongo();
  devId = String((await User.create({ firstName: 'Dev', phone: '+998900007777', role: 'dasturchi', telegramChatId: '555' } as any))._id);
}, 120_000);

beforeEach(async () => {
  for (const k of ENV_KEYS.slice(1)) delete process.env[k];
  __resetAgentsForTests();
  __setContentRunnerForTests(null);
  __setIgSleepForTests(async () => {});
  await Promise.all([AgentProfile.deleteMany({}), AgentTask.deleteMany({}), SmmSettings.deleteMany({}), SmmRun.deleteMany({}), SmmInsight.deleteMany({}), SmmTempMedia.deleteMany({}), AuditLog.deleteMany({})]);
  calls = []; graphMode = 'ok'; statusPolls = 0; memberResult = { status: 'administrator', can_post_messages: true }; rejectCustomEmoji = false;
  __resetBotUiForTests();
  __resetChannelCacheForTests();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await __drainAgentsForTests();
  await __drainSmmForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  __setIgSleepForTests(null);
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await stopMongo(mongo);
});

describe('yordamchilar', () => {
  it('caption, format tanlash, matnni bo\'lish, Telegram havolasi, Graph xatolari', () => {
    expect(captionOf({ title: 'A', text: 'B', hashtags: ['#x', 'bad tag', '#y'] })).toBe('A\n\nB\n\n#x #y');
    expect(resolveKind(undefined, 'post', [{ data: MP4, mime: 'video/mp4' }])).toBe('reel');
    expect(resolveKind('carousel', undefined, [{ data: JPEG, mime: 'image/jpeg' }])).toBe('post');
    expect(resolveKind('reel', undefined, [{ data: JPEG, mime: 'image/jpeg' }, { data: JPEG, mime: 'image/jpeg' }])).toBe('carousel');
    expect(resolveKind('story', 'post', [{ data: JPEG, mime: 'image/jpeg' }])).toBe('story');
    expect(wrapText('bir ikki uch tort besh olti', 9, 2)).toEqual(['bir ikki', 'uch tort…']);
    expect(tgMessageUrl('@qurilish_erp', 12)).toBe('https://t.me/qurilish_erp/12');
    expect(tgMessageUrl('-1001234', 5)).toBe('https://t.me/c/1234/5');
    expect(tgMessageUrl('555', 5)).toBeUndefined();
    expect(mapGraphError({ error: { code: 190, message: 'x access_token=SECRET' } }, 400).code).toBe('ig_token_invalid');
    expect(mapGraphError({ error: { code: 190, message: 'x access_token=SECRET' } }, 400).detail).not.toContain('SECRET');
    expect(mapGraphError({ error: { code: 9, error_subcode: 2207042 } }, 400).code).toBe('ig_publish_limit');
    expect(mapGraphError({ error: { code: 9004, message: 'fetch' } }, 400).code).toBe('ig_media_fetch');
    expect(mapGraphError({ error: { code: 4 } }, 400).code).toBe('ig_rate_limited');
    expect(mapGraphError({ error: { code: 10 } }, 403).code).toBe('ig_permission');
  });

  it('slot: vaqti kelganda 30 daqiqa oynada; keyingi slot; formatlar navbatma-navbat', () => {
    const s = { days: [1, 3, 5], times: ['10:00', '18:00'] };
    const mon = zonedToUtc('2026-10-26' as any, '10:05' as any); // dushanba
    expect(dueSlot(s, mon)).toEqual({ key: 'smm:2026-10-26:10:00', date: '2026-10-26', time: '10:00' });
    expect(dueSlot(s, zonedToUtc('2026-10-26' as any, '10:31' as any))).toBeNull();
    expect(dueSlot(s, zonedToUtc('2026-10-27' as any, '10:05' as any))).toBeNull(); // seshanba
    expect(nextSlot(s.days, s.times, mon)?.toISOString()).toBe(zonedToUtc('2026-10-26' as any, '18:00' as any).toISOString());
    expect(nextSlot(s.days, s.times, zonedToUtc('2026-10-26' as any, '19:00' as any))?.toISOString()).toBe(zonedToUtc('2026-10-28' as any, '10:00' as any).toISOString());
    expect(pickLeastRecent(['post', 'carousel', 'reel'] as const, ['post', 'carousel'])).toBe('reel');
    expect(pickLeastRecent(['post', 'carousel', 'reel'] as const, ['reel', 'carousel', 'post'])).toBe('post');
  });
});

describe('Instagram Graph API', () => {
  it('post: konteyner → holat (IN_PROGRESS → FINISHED) → media_publish → permalink', async () => {
    igEnv();
    const r = await igPublish('post', [{ url: 'https://api.example.uz/api/smm-media/x.jpg', kind: 'image' }], 'Salom');
    expect(r).toEqual({ mediaId: '17900000000000001', permalink: 'https://www.instagram.com/p/ABC123/' });
    const g = graphCalls();
    expect(g[0].url).toBe('https://graph.instagram.com/v23.0/1784/media');
    expect(g[0].body).toMatchObject({ image_url: 'https://api.example.uz/api/smm-media/x.jpg', caption: 'Salom', access_token: 'IGQsecrettoken123' });
    expect(g.filter((c) => c.url.includes('status_code')).length).toBe(2);
    expect(g.find((c) => c.url.endsWith('/media_publish'))!.body).toMatchObject({ creation_id: 'c1' });
  });

  it('karusel (bolalar konteynerlari), reels (REELS + share_to_feed), story (STORIES)', async () => {
    igEnv();
    await igPublish('carousel', [{ url: 'https://h/a.jpg', kind: 'image' }, { url: 'https://h/b.jpg', kind: 'image' }], 'K');
    const media = graphCalls().filter((c) => c.url.endsWith('/media'));
    expect(media[0].body).toMatchObject({ image_url: 'https://h/a.jpg', is_carousel_item: 'true' });
    expect(media[2].body).toMatchObject({ media_type: 'CAROUSEL', children: 'c1,c2', caption: 'K' });
    calls = [];
    await igPublish('reel', [{ url: 'https://h/v.mp4', kind: 'video' }], 'R');
    expect(graphCalls()[0].body).toMatchObject({ media_type: 'REELS', video_url: 'https://h/v.mp4', share_to_feed: 'true' });
    calls = [];
    await igPublish('story', [{ url: 'https://h/s.jpg', kind: 'image' }], 'S');
    expect(graphCalls()[0].body).toMatchObject({ media_type: 'STORIES', image_url: 'https://h/s.jpg' });
    expect(graphCalls()[0].body.caption).toBeUndefined();
    await expect(igPublish('carousel', [{ url: 'https://h/a.jpg', kind: 'image' }], 'K')).rejects.toMatchObject({ code: 'ig_carousel_count' });
  });

  it('xatolar: konteyner ERROR, token eskirgan; token xatoga chiqmaydi; sozlanmagan', async () => {
    await expect(igPublish('post', [{ url: 'https://h/a.jpg', kind: 'image' }], 'x')).rejects.toMatchObject({ code: 'ig_not_configured' });
    igEnv();
    graphMode = 'container_error';
    await expect(igPublish('post', [{ url: 'https://h/a.jpg', kind: 'image' }], 'x')).rejects.toMatchObject({ code: 'ig_media_format' });
    graphMode = 'token_bad';
    const e: any = await igPublish('post', [{ url: 'https://h/a.jpg', kind: 'image' }], 'x').catch((x) => x);
    expect(e.code).toBe('ig_token_invalid');
    expect(JSON.stringify(e)).not.toContain('IGQsecrettoken123');
  });

  it('token yangilash: IG Login — refresh_access_token; yangi token shifrlangan saqlanadi va ishlatiladi', async () => {
    igEnv();
    process.env.AI_SECRETS_KEY = 'test-secrets-key-for-smm';
    const r = await igMaybeRefresh(new Date('2026-10-23T00:00:00Z'));
    expect(r.refreshed).toBe(true);
    expect(calls.some((c) => c.url.includes('refresh_access_token?grant_type=ig_refresh_token'))).toBe(true);
    const s: any = await SmmSettings.findOne({ key: 'global' }).lean();
    expect(JSON.stringify(s.igToken)).not.toContain('IGQnewtoken');
    expect(s.igTokenExpiresAt).toBeTruthy();
    // Keyingi chaqiruv — muddati uzoq, yangilanmaydi
    expect((await igMaybeRefresh(new Date('2026-10-24T00:00:00Z'))).refreshed).toBe(false);
    calls = [];
    await igPublish('post', [{ url: 'https://h/a.jpg', kind: 'image' }], 'x');
    expect(graphCalls()[0].body.access_token).toBe('IGQnewtoken');
    // Facebook tokeni META_APP_* bo'lmasa yangilanmaydi
    process.env.INSTAGRAM_ACCESS_TOKEN = 'EAAfacebooktoken';
    expect(await igMaybeRefresh(new Date(), true)).toMatchObject({ refreshed: false, error: 'meta_app_missing' });
  });
});

describe("vaqtinchalik fayllar", () => {
  it('token bilan beriladi (Range ham), muddati o\'tsa yo\'q; noto\'g\'ri token 404', async () => {
    process.env.RENDER_EXTERNAL_URL = 'https://api.example.uz';
    const big = Buffer.alloc(9 * 1024 * 1024, 3); // 2 bo'lak
    const t = await putTemp(big, 'video/mp4');
    expect(t.url).toMatch(/^https:\/\/api\.example\.uz\/api\/smm-media\/[A-Za-z0-9_-]{32}\.mp4$/);
    expect(await SmmTempMedia.countDocuments({ token: t.token })).toBe(2);
    expect((await getTemp(t.token))!.data.equals(big)).toBe(true);
    const r = await request(app).get(`/api/smm-media/${t.token}.mp4`).set('Range', 'bytes=0-9');
    expect(r.status).toBe(206);
    expect(r.headers['content-range']).toBe(`bytes 0-9/${big.length}`);
    expect(r.headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/api/smm-media/short.mp4')).status).toBe(404);
    expect((await request(app).post(`/api/smm-media/${t.token}.mp4`)).status).toBe(405);
    await SmmTempMedia.updateMany({ token: t.token }, { $set: { expireAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get(`/api/smm-media/${t.token}.mp4`)).status).toBe(404);
  });
});

describe("e'lon (qurilmadan fayl bilan)", () => {
  it("Instagram: JPEG → vaqtinchalik havola → e'lon; holat va havola; vaqtinchalik fayl o'chiriladi; audit", async () => {
    igEnv();
    const id = await smmTask();
    const task = (await get(`/agent-tasks/${id}`)).body.task;
    expect(task.items[0]).toMatchObject({ title: 'Smeta 5 daqiqada', format: 'post', hashtags: ['#qurilish', '#erp'], scenes: [{ title: 'Muammo', text: 'Smeta 3 kun' }, { title: 'Yechim', text: '5 daqiqa' }] });
    const r = await request(app).post(`${P}/agent-tasks/${id}/items/0/publish`).set('Authorization', tok(devId))
      .field('target', 'instagram').field('kind', 'post').attach('files', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ ok: true, pending: true });
    await __drainSmmForTests();
    const it0 = (await get(`/agent-tasks/${id}`)).body.task.items[0];
    expect(it0.ig).toMatchObject({ status: 'published', kind: 'post', url: 'https://www.instagram.com/p/ABC123/' });
    const container = graphCalls().find((c) => c.url.endsWith('/media'))!;
    expect(container.body.image_url).toMatch(/^https:\/\/api\.example\.uz\/api\/smm-media\/[A-Za-z0-9_-]{32}\.jpg$/);
    expect(container.body.caption).toContain('Smeta 5 daqiqada');
    expect(await SmmTempMedia.countDocuments({})).toBe(0);
    expect(await AuditLog.countDocuments({ entity: 'smm_publish' })).toBe(1);
    // Ikkinchi marta — rad (force'siz)
    const again = await request(app).post(`${P}/agent-tasks/${id}/items/0/publish`).set('Authorization', tok(devId))
      .field('target', 'instagram').attach('files', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_published');
  });

  it("Instagram: sozlanmagan 409, ommaviy URL yo'q 409, fayl yo'q 400; xato holati saqlanadi", async () => {
    const id = await smmTask();
    const send = () => request(app).post(`${P}/agent-tasks/${id}/items/0/publish`).set('Authorization', tok(devId)).field('target', 'instagram')
      .attach('files', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect((await send()).body.error).toBe('ig_not_configured');
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IGQx';
    process.env.RENDER_EXTERNAL_URL = 'http://localhost:5000';
    expect((await send()).body.error).toBe('public_url_required');
    igEnv();
    expect((await request(app).post(`${P}/agent-tasks/${id}/items/0/publish`).set('Authorization', tok(devId)).field('target', 'instagram')).body.error).toBe('ig_media_required');
    graphMode = 'container_error';
    expect((await send()).status).toBe(202);
    await __drainSmmForTests();
    const it0 = (await get(`/agent-tasks/${id}`)).body.task.items[0];
    expect(it0.ig).toMatchObject({ status: 'failed', error: 'ig_media_format', detail: 'Error: aspect ratio' });
    expect(await SmmTempMedia.countDocuments({})).toBe(0);
  });

  it("Telegram: rasm sendPhoto (caption ≤1024); uzun matn → rasm + keyingi xabar; kanal yo'q — o'z chatiga", async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot123';
    const long = { ...ITEM, text: 'a'.repeat(1500) };
    const id = await smmTask([ITEM, long]);
    const r = await request(app).post(`${P}/agent-tasks/${id}/items/0/publish`).set('Authorization', tok(devId))
      .field('target', 'telegram').attach('files', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(200);
    expect(r.body.sentTo).toBe('developer');
    const photo = tgCalls()[0];
    expect(photo.url).toBe('https://api.telegram.org/botbot123/sendPhoto');
    expect(photo.body).toBeInstanceOf(FormData);
    expect((photo.body as FormData).get('chat_id')).toBe('555');
    expect(String((photo.body as FormData).get('caption'))).toContain('#qurilish #erp');
    calls = [];
    process.env.AGENT_TG_CHANNEL_ID = '@qurilish_erp';
    __resetChannelCacheForTests();
    const r2 = await request(app).post(`${P}/agent-tasks/${id}/items/1/publish`).set('Authorization', tok(devId))
      .field('target', 'telegram').attach('files', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(r2.body).toMatchObject({ sentTo: 'channel', url: 'https://t.me/qurilish_erp/40' });
    expect(tgCalls().map((c) => c.url.split('/').pop())).toEqual(['sendPhoto', 'sendMessage']);
    expect((tgCalls()[0].body as FormData).get('caption')).toBe('<b>Smeta 5 daqiqada</b>');
    expect((tgCalls()[0].body as FormData).get('parse_mode')).toBe('HTML');
    expect(tgCalls()[1].body.reply_markup).toEqual({ inline_keyboard: [[{ text: '🌐 erp-firma.uz', url: 'https://erp-firma.uz' }]] });
    expect(tgCalls()[1].body).toMatchObject({ chat_id: '@qurilish_erp', reply_parameters: { message_id: 40 } });
    const it1 = (await get(`/agent-tasks/${id}`)).body.task.items[1];
    expect(it1.tg).toMatchObject({ status: 'published', target: 'channel', url: 'https://t.me/qurilish_erp/40' });
  });

  it('post tahriri, qurilma media metama\'lumoti, AI rasm (Gemini) va 503 zaxira', async () => {
    const id = await smmTask();
    const e = await request(app).patch(`${P}/agent-tasks/${id}/items/0`).set('Authorization', tok(devId)).send({ text: 'Yangi matn', hashtags: 'qurilish #erp', format: 'reel' });
    expect(e.body.item).toMatchObject({ text: 'Yangi matn', hashtags: ['#qurilish', '#erp'], format: 'reel' });
    expect((await request(app).patch(`${P}/agent-tasks/${id}/items/0`).set('Authorization', tok(devId)).send({ format: 'tv' })).status).toBe(400);
    const m = await put(`/agent-tasks/${id}/items/0/media`, { media: [{ id: 'loc_abc123', kind: 'image', mime: 'image/jpeg', w: 1080, h: 1350, size: 120000, source: 'template' }] });
    expect(m.body.item.media).toEqual([expect.objectContaining({ id: 'loc_abc123', kind: 'image', w: 1080, h: 1350, source: 'template' })]);
    expect((await put(`/agent-tasks/${id}/items/0/media`, { media: [{ id: '../x', kind: 'image' }] })).status).toBe(400);
    // AI rasm: kalit yo'q → 503 (qurilma shablon chizadi)
    const no = await post('/smm/image', { taskId: id, index: 0, aspect: '4:5' });
    expect(no.status).toBe(503);
    expect(no.body).toMatchObject({ error: 'image_unavailable', reason: 'no_key' });
    process.env.GEMINI_API_KEY = 'gk1';
    const ok = await post('/smm/image', { taskId: id, index: 0, aspect: '9:16' });
    expect(ok.body).toMatchObject({ mime: 'image/png', source: 'ai', data: Buffer.from('PNGDATA').toString('base64') });
    const g = calls.find((c) => c.url.includes('generativelanguage'))!;
    expect(g.url).toContain('gemini-2.5-flash-image:generateContent');
    expect(g.body.generationConfig).toMatchObject({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } });
    expect(g.body.contents[0].parts[0].text).toContain('engineer with tablet');
  });
});

describe('sozlamalar va avtopilot', () => {
  it("sozlamalar: tekshiruv, saqlash, audit; holat ro'yxatida faqat nomlar", async () => {
    igEnv();
    process.env.TELEGRAM_BOT_TOKEN = 'bot123';
    const g = await get('/smm/settings');
    expect(g.body.settings).toMatchObject({ mode: 'off', days: [1, 3, 5], times: ['10:00'], dailyCap: 3, paused: false, perWeek: 3 });
    expect(g.body.status.instagram).toMatchObject({ configured: true, via: 'instagram', publicUrl: true });
    expect(g.body.status.telegram).toMatchObject({ bot: true, channel: false, viewsAvailable: false });
    expect(JSON.stringify(g.body)).not.toContain('IGQsecrettoken123');
    expect((await put('/smm/settings', { mode: 'yolo' })).status).toBe(400);
    expect((await put('/smm/settings', { times: ['25:00'] })).status).toBe(400);
    expect((await put('/smm/settings', { dailyCap: 50 })).status).toBe(400);
    const s = await put('/smm/settings', { mode: 'approve', days: [2, 4], times: ['18:30', '09:00'], formats: ['post', 'reel'], language: 'ru', dailyCap: 2, targets: { telegram: false, instagram: true } });
    expect(s.body.settings).toMatchObject({ mode: 'approve', days: [2, 4], times: ['09:00', '18:30'], formats: ['post', 'reel'], language: 'ru', dailyCap: 2, perWeek: 4, targets: { telegram: false, instagram: true } });
    expect(s.body.settings.next).toBeTruthy();
    expect(await AuditLog.countDocuments({ entity: 'smm_settings' })).toBe(1);
  });

  it("tasdiq bilan: slot bir marta (ikki tick), post 'pending', egasiga xabar; tasdiqlash; kill-switch", async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot123';
    process.env.DEVELOPER_CHAT_ID = '999';
    await put('/smm/settings', { mode: 'approve', days: [1], times: ['10:00'] });
    let prompt = '';
    __setContentRunnerForTests(async (p) => { prompt = p; return { summary: 'ok', items: [ITEM, { ...ITEM, title: 'ikkinchi' }] }; });
    const now = zonedToUtc('2026-10-26' as any, '10:02' as any);
    await Promise.all([smmTick(now), smmTick(now)]);
    await smmTick(new Date(now.getTime() + 60_000));
    const runs: any[] = await SmmRun.find({}).lean();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ key: 'smm:2026-10-26:10:00', status: 'prepared', category: 'feature' });
    expect(prompt).toContain('[lang:uz] Avtopilot');
    const tasks: any[] = await AgentTask.find({ agentKey: 'smm' }).lean();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].items).toHaveLength(1);
    expect(tasks[0].items[0]).toMatchObject({ approval: 'pending', format: 'post' });
    const note = tgCalls().find((c) => c.body?.chat_id === '999');
    expect(note?.body.text).toMatch(/tasdiq kutmoqda/);
    expect(graphCalls()).toHaveLength(0);
    const id = String(tasks[0]._id);
    const ap = await post(`/agent-tasks/${id}/items/0/approval`, { decision: 'approved' });
    expect(ap.body.item.approval).toBe('approved');
    expect((await post(`/agent-tasks/${id}/items/0/approval`, { decision: 'approved' })).status).toBe(409);
    // Kill-switch: keyingi slot ishlamaydi
    await put('/smm/settings', { paused: true, times: ['10:00', '12:00'] });
    await smmTick(zonedToUtc('2026-10-26' as any, '12:01' as any));
    expect(await SmmRun.countDocuments({})).toBe(1);
    await put('/smm/settings', { paused: false });
    process.env.SMM_AUTOPILOT_DISABLED = '1';
    await smmTick(zonedToUtc('2026-10-26' as any, '12:02' as any));
    expect(await SmmRun.countDocuments({})).toBe(1);
  });

  it("to'liq avto: server rasm (AI yo'q → shablon) → Instagram + Telegram kanal, fayllar o'chadi; kunlik limit", async () => {
    igEnv();
    process.env.TELEGRAM_BOT_TOKEN = 'bot123';
    process.env.AGENT_TG_CHANNEL_ID = '@qurilish_erp';
    vi.spyOn(smmRender, 'renderTemplate').mockResolvedValue(JPEG);
    vi.spyOn(smmRender, 'renderSlideshow').mockResolvedValue(MP4);
    vi.spyOn(smmRender, 'transcodeToMp4').mockImplementation(async (b) => b);
    await put('/smm/settings', { mode: 'auto', days: [1], times: ['10:00', '11:00', '12:00'], formats: ['reel'], dailyCap: 2 });
    __setContentRunnerForTests(async () => ({ summary: 'ok', items: [{ ...ITEM, format: 'reel' }] }));
    await smmTick(zonedToUtc('2026-10-26' as any, '10:01' as any));
    const run: any = await SmmRun.findOne({}).lean();
    expect(run).toMatchObject({ status: 'published', format: 'reel' });
    const t: any = await AgentTask.findById(run.taskId).lean();
    expect(t.items[0]).toMatchObject({ approval: 'approved', format: 'reel' });
    expect(t.items[0].ig).toMatchObject({ status: 'published', kind: 'reel' });
    expect(t.items[0].tg).toMatchObject({ status: 'published', target: 'channel' });
    expect(t.items[0].media[0]).toMatchObject({ kind: 'video', source: 'server-template' });
    expect(graphCalls().find((c) => c.url.endsWith('/media'))!.body).toMatchObject({ media_type: 'REELS' });
    expect(tgCalls().some((c) => c.url.endsWith('/sendVideo'))).toBe(true);
    expect(await SmmTempMedia.countDocuments({})).toBe(0);
    expect(await AuditLog.countDocuments({ entity: 'smm_autopilot' })).toBe(1);
    await smmTick(zonedToUtc('2026-10-26' as any, '11:01' as any));
    await smmTick(zonedToUtc('2026-10-26' as any, '12:01' as any));
    const all: any[] = await SmmRun.find({}).sort({ createdAt: 1 }).lean();
    expect(all.map((r) => r.status)).toEqual(['published', 'published', 'skipped']);
  });

  it("to'liq avto, lekin e'lon joyi sozlanmagan — hech narsa e'lon qilinmaydi, tasdiq kutadi", async () => {
    await put('/smm/settings', { mode: 'auto', days: [1], times: ['10:00'] });
    __setContentRunnerForTests(async () => ({ summary: 'ok', items: [ITEM] }));
    await smmTick(zonedToUtc('2026-10-26' as any, '10:01' as any));
    const run: any = await SmmRun.findOne({}).lean();
    expect(run.status).toBe('prepared');
    expect(run.note).toMatch(/sozlanmagan/);
    expect((await AgentTask.findById(run.taskId).lean() as any).items[0].approval).toBe('pending');
    expect(graphCalls()).toHaveLength(0);
    expect(tgCalls()).toHaveLength(0);
  });
});

describe('statistika', () => {
  it('yangilash (media + akkaunt), jamlanma, eng yaxshi format; Telegram ko\'rishlari mavjud emas', async () => {
    igEnv();
    const id = await smmTask();
    await AgentTask.updateOne({ _id: id }, { $set: { 'items.0.ig': { status: 'published', at: new Date(), kind: 'post', mediaId: '17900000000000001', url: 'https://www.instagram.com/p/ABC123/' } } });
    const r = await post('/smm/analytics/refresh');
    expect(r.status).toBe(200);
    expect(r.body.media).toBe(1);
    const s = r.body.summary;
    expect(s.totals).toMatchObject({ posts: 1, reach: 120, likes: 9, saved: 3, comments: 2 });
    expect(s.posts[0]).toMatchObject({ title: 'Smeta 5 daqiqada', kind: 'post', engagement: 14 });
    expect(s.account.latest).toMatchObject({ followers: 1500, reach: 900, profile_views: 33 });
    expect(s.best.format).toBe('post');
    expect(s.telegram.viewsAvailable).toBe(false);
    expect((await get('/smm/analytics')).body.totals.reach).toBe(120);
  });
});

describe('server shablon (ffmpeg)', () => {
  it.skipIf(!ffmpegAvailable())('brendli JPEG shablon yaratiladi (4:5 va 9:16)', async () => {
    const a = await renderTemplate({ title: "Qog'oz cheklar yo'qolmaydi", subtitle: 'Ovozli chiqim', aspect: '4:5' });
    expect(a.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(a.length).toBeGreaterThan(5000);
  }, 60_000);
});

describe("Telegram kanal (UI'dan ulash) va kanal formati", () => {
  it('format: qalin sarlavha, HTML escape, paragraflar, heshteglar oxirida; uzun matn — qisqa caption + davomi', () => {
    const p = formatChannelPost({ title: 'Smeta <tez>', text: 'Birinchi gap.\n\nIkkinchi & uchinchi.', hashtags: ['#qurilish', 'yomon teg', '#erp'] });
    expect(p.captionHtml).toBe('<b>Smeta &lt;tez&gt;</b>\n\nBirinchi gap.\n\nIkkinchi &amp; uchinchi.\n\n#qurilish #erp');
    expect(p.restHtml).toBeUndefined();
    const long = formatChannelPost({ title: 'Sarlavha', text: `${'a'.repeat(600)}\n\n${'b'.repeat(600)}`, hashtags: ['#x'] });
    expect(long.captionHtml).toBe(`<b>Sarlavha</b>\n\n${'a'.repeat(600)}`);
    expect(long.restHtml).toBe(`${'b'.repeat(600)}\n\n#x`);
    const one = "Bu birinchi gap. Bu ikkinchi gap. Uchinchi gap keldi. To'rtinchi gap ham bor. Beshinchi gap. " + 'Yana bir uzun gap shu yerda turibdi va u ancha uzun. '.repeat(5);
    expect(paragraphs(one).length).toBeGreaterThan(2);
  });

  it("tekshirish: kanal yo'q / guruh / bot admin emas / huquq yo'q — tushunarli xato + bot nomi; muvaffaqiyat — saqlanadi va env'dan ustun", async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot123';
    process.env.AGENT_TG_CHANNEL_ID = '@eski_env';
    const v = (channel: string) => post('/smm/telegram/channel', { channel });
    expect((await v('x')).body.error).toBe('tg_channel_invalid');
    expect((await v('@kanal_yoq')).body).toMatchObject({ error: 'tg_chat_not_found', botUsername: 'qurilish_erp_bot' });
    expect((await v('@guruh_erp')).body.error).toBe('tg_not_channel');
    memberResult = { status: 'left' };
    expect((await v('@erp_kanal')).body).toMatchObject({ error: 'tg_bot_not_admin', botUsername: 'qurilish_erp_bot' });
    memberResult = { status: 'administrator', can_post_messages: false };
    expect((await v('https://t.me/erp_kanal')).body.error).toBe('tg_no_post_right');
    memberResult = { status: 'administrator', can_post_messages: true };
    const ok = await v('erp_kanal');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, channel: { id: '-1001234567890', username: 'erp_kanal', title: 'QurilishERP yangiliklari' }, botUsername: 'qurilish_erp_bot' });
    const member = calls.filter((c) => c.url.endsWith('/getChatMember')).pop()!;
    expect(member.body).toEqual({ chat_id: -1001234567890, user_id: 777 });
    const st = (await get('/smm/settings')).body.status.telegram;
    expect(st).toMatchObject({ channel: true, channelSource: 'db', channelName: '@erp_kanal', channelTitle: 'QurilishERP yangiliklari', botUsername: 'qurilish_erp_bot' });
    expect(await AuditLog.countDocuments({ entity: 'smm_settings', entityId: 'telegram_channel' })).toBe(1);

    // "Kanalga joylash" — endi DOIM kanalga (HTML, sayt tugmasi rasmda), havola username bilan
    const id = await smmTask();
    calls = [];
    const r = await request(app).post(`${P}/agent-tasks/${id}/items/0/publish`).set('Authorization', tok(devId))
      .field('target', 'telegram').attach('files', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(r.body).toMatchObject({ ok: true, sentTo: 'channel', url: 'https://t.me/erp_kanal/40' });
    const fd = tgCalls()[0].body as FormData;
    expect(fd.get('chat_id')).toBe('-1001234567890');
    expect(fd.get('parse_mode')).toBe('HTML');
    expect(String(fd.get('caption'))).toMatch(/^<b>Smeta 5 daqiqada<\/b>\n\n/);
    expect(JSON.parse(String(fd.get('reply_markup')))).toEqual({ inline_keyboard: [[{ text: '🌐 erp-firma.uz', url: 'https://erp-firma.uz' }]] });
    // Eski "Kanalga yuborish" (matn) ham kanalga
    calls = [];
    const old = await post(`/agent-tasks/${id}/send`, { target: 'channel', index: 0 });
    expect(old.body).toMatchObject({ ok: true, sentTo: 'channel' });
    expect(tgCalls()[0].body).toMatchObject({ chat_id: '-1001234567890', parse_mode: 'HTML' });
    // Sayt tugmasini o'chirish
    await put('/smm/settings', { siteButton: false });
    calls = [];
    await request(app).post(`${P}/agent-tasks/${id}/items/0/publish`).set('Authorization', tok(devId)).field('target', 'telegram').attach('files', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect((tgCalls()[0].body as FormData).get('reply_markup')).toBeNull();
    // Uzish — env'ga qaytadi; env ham bo'lmasa — o'z chatiga
    expect((await request(app).delete(`${P}/smm/telegram/channel`).set('Authorization', tok(devId))).status).toBe(200);
    delete process.env.AGENT_TG_CHANNEL_ID;
    __resetChannelCacheForTests();
    calls = [];
    const own = await request(app).post(`${P}/agent-tasks/${id}/items/0/publish`).set('Authorization', tok(devId)).field('target', 'telegram');
    expect(own.body).toMatchObject({ ok: true, sentTo: 'developer' });
    expect(tgCalls()[0].body).toMatchObject({ chat_id: '555', parse_mode: 'HTML' });
  });

  it("to'liq avto: UI'dan ulangan kanalga jadval bo'yicha joylaydi", async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot123';
    vi.spyOn(smmRender, 'renderTemplate').mockResolvedValue(JPEG);
    expect((await post('/smm/telegram/channel', { channel: '@erp_kanal' })).status).toBe(200);
    await put('/smm/settings', { mode: 'auto', days: [1], times: ['10:00'], formats: ['post'] });
    __setContentRunnerForTests(async () => ({ summary: 'ok', items: [ITEM] }));
    calls = [];
    await smmTick(zonedToUtc('2026-10-26' as any, '10:03' as any));
    const run: any = await SmmRun.findOne({}).lean();
    expect(run.status).toBe('published');
    const photo = tgCalls().find((c) => c.url.endsWith('/sendPhoto'))!;
    expect((photo.body as FormData).get('chat_id')).toBe('-1001234567890');
    expect(graphCalls()).toHaveLength(0);
  });
});

describe('premium (custom) emoji kanal postida', () => {
  const snap = (map: [string, string][]) => setBotUiSnapshot({
    buttons: {}, messageEmoji: new Map(map), messageEmojiEnabled: true, stripEmojiWhenIcon: true, stickers: [], messagePrefix: {}, messagePrefixEnabled: false,
  });

  it("Bot dizayni xaritasi bo'yicha <tg-emoji> qo'yiladi; Telegram rad etsa — oddiy emoji bilan qayta va sababi ro'yxatda", async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot123';
    process.env.AGENT_TG_CHANNEL_ID = '@erp_kanal';
    const id = await smmTask([{ ...ITEM, text: "Qog'oz cheklar yo'qolyaptimi? 😟 Endi yo'q!" }]);
    snap([['😟', '5368324170671202286']]);
    calls = [];
    const ok = await request(app).post(`${P}/agent-tasks/${id}/items/0/publish`).set('Authorization', tok(devId))
      .field('target', 'telegram').attach('files', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(ok.body.ok).toBe(true);
    expect(String((tgCalls()[0].body as FormData).get('caption'))).toContain('<tg-emoji emoji-id="5368324170671202286">😟</tg-emoji>');
    expect(tgCalls()).toHaveLength(1);
    expect((await get('/smm/settings')).body.status.telegram.premium).toBe('ok');

    rejectCustomEmoji = true;
    calls = [];
    const r = await request(app).post(`${P}/agent-tasks/${id}/items/0/publish`).set('Authorization', tok(devId))
      .field('target', 'telegram').attach('files', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(r.body).toMatchObject({ ok: true, sentTo: 'channel' });
    expect(tgCalls()).toHaveLength(2);
    const plain = String((tgCalls()[1].body as FormData).get('caption'));
    expect(plain).not.toContain('<tg-emoji');
    expect(plain).toContain('😟');
    const st = (await get('/smm/settings')).body.status;
    expect(st.telegram).toMatchObject({ premium: 'rejected', premiumError: 'Bad Request: ENTITY_TEXT_INVALID' });
    expect(st.items.find((i: any) => i.key === 'TG_PREMIUM_EMOJI')).toMatchObject({ ok: false, detail: 'Bad Request: ENTITY_TEXT_INVALID' });
    const log = (await get(`/agent-tasks/${id}`)).body.task.log.map((l: any) => l.text).join(' | ');
    expect(log).toMatch(/premium emojini rad etdi/);
  });
});
