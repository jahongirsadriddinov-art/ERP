// Integratsion sinov: /api/dev/bot-ui — faqat dasturchi; saqlash/validatsiya; emoji paketi (soxta Telegram);
// "AI bilan bezash" (soxta Gemini) → qoralama → qo'llash; standartga qaytarish; stiker rasmi faqat paketdagilar.
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';

const tg = vi.hoisted(() => ({ calls: [] as { method: string; body: any }[], downloads: [] as string[] }));
vi.mock('../services/botUi/telegramApi', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    tgCall: vi.fn(async (method: string, body: any) => {
      tg.calls.push({ method, body });
      if (method === 'getStickerSet') {
        if (body.name === 'Regular') return { name: 'Regular', title: 'R', sticker_type: 'regular', stickers: [] };
        if (body.name !== 'BuildPack') throw new Error('Bad Request: STICKERSET_INVALID');
        return {
          name: 'BuildPack', title: 'Qurilish', sticker_type: 'custom_emoji', stickers: [
            { custom_emoji_id: '1001', emoji: '✅', file_id: 'f1', thumbnail: { file_id: 't1' } },
            { custom_emoji_id: '1002', emoji: '❌', file_id: 'f2', is_animated: true },
            { custom_emoji_id: '1003', emoji: '💬', file_id: 'f3', thumbnail: { file_id: 't3' } },
            { custom_emoji_id: '1004', emoji: '🏗', file_id: 'f4' },
          ],
        };
      }
      return true;
    }),
    tgDownloadFile: vi.fn(async (fileId: string) => { tg.downloads.push(fileId); return { buf: Buffer.from('RIFFxxxxWEBP'), path: `stickers/${fileId}.webp` }; }),
  };
});
const gem = vi.hoisted(() => ({ prompt: '', result: null as any, fail: false }));
vi.mock('../services/gemini', () => ({
  geminiTextToJson: vi.fn(async (p: string) => { gem.prompt = p; if (gem.fail) throw new Error('quota'); return gem.result; }),
}));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import BotUiConfig from '../models/BotUiConfig';
import { requireAuth, requireDeveloper, JWT_SECRET } from '../middleware/auth';
import botUiRoutes, { stickerImageRouter, __decorateJobForTests } from './botUi';
import { decorateMarkup, __resetBotUiForTests } from '../services/botUi/runtime';
import { tb } from '../i18n/bot';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/dev/bot-ui', requireAuth, requireDeveloper, botUiRoutes);
app.use('/api/bot-ui-sticker', stickerImageRouter);

const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const api = (k: string) => ({
  get: (p = '') => request(app).get(`/api/dev/bot-ui${p}`).set('Authorization', tok(k)),
  put: (b: any) => request(app).put('/api/dev/bot-ui').set('Authorization', tok(k)).send(b),
  post: (p: string, b: any = {}) => request(app).post(`/api/dev/bot-ui${p}`).set('Authorization', tok(k)).send(b),
  del: (p: string) => request(app).delete(`/api/dev/bot-ui${p}`).set('Authorization', tok(k)),
});

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test:token';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const A = new mongoose.Types.ObjectId().toString();
  ids.dev = String((await User.create({ firstName: 'Dev', phone: '+998900000099', role: 'dasturchi' }))._id);
  ids.boss = String((await User.create({ firstName: 'Boss', phone: '+998900000001', role: 'direktor', isOwner: true, companyId: A }))._id);
}, 120_000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(() => { tg.calls.length = 0; __resetBotUiForTests(); });

describe('/api/dev/bot-ui', () => {
  it('faqat dasturchi: direktor 403, tokensiz 401', async () => {
    expect((await api('boss').get()).status).toBe(403);
    expect((await api('boss').put({ buttons: {} })).status).toBe(403);
    expect((await api('boss').post('/auto-decorate')).status).toBe(403);
    expect((await request(app).get('/api/dev/bot-ui')).status).toBe(401);
  });

  it('GET: katalog (barcha tugmalar), buyruqlar, bo\'sh sozlama', async () => {
    const r = await api('dev').get();
    expect(r.status).toBe(200);
    const keys = r.body.catalog.map((i: any) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['kb_chat', 'kb_addExpense', 'kb_devSettings', 'confirmYes', 'exp_okBtn', 'ai_ai']));
    expect(r.body.commandsCatalog.map((c: any) => c.command)).toEqual(['start', 'res', 'ai', 'jadval']);
    expect(r.body.config.buttons).toEqual({});
  });

  it('PUT: saqlaydi, runtime darhol qo\'llaydi, buyruqlar Telegramga yuboriladi', async () => {
    const r = await api('dev').put({
      buttons: { kb_chat: { text: { uz: 'Suhbat', ru: 'Беседа' }, iconCustomEmojiId: '1003', style: 'primary' } },
      commands: [{ command: 'start', enabled: true, description: { uz: 'Boshlash', ru: 'Старт' } }, { command: 'res', enabled: false, description: {} }],
    });
    expect(r.status).toBe(200);
    expect(r.body.commandsError).toBeNull();
    expect(r.body.config.buttons.kb_chat.style).toBe('primary');
    const d = decorateMarkup({ keyboard: [[{ text: tb('uz', 'kb_chat') }]] });
    expect(d.keyboard[0][0]).toEqual({ text: 'Suhbat', icon_custom_emoji_id: '1003', style: 'primary' });
    const sets = tg.calls.filter(c => c.method === 'setMyCommands');
    expect(sets[0].body.commands).toEqual([{ command: 'start', description: 'Boshlash' }]);
    expect(sets[1].body).toEqual({ commands: [{ command: 'start', description: 'Старт' }], language_code: 'ru' });
  });

  it('PUT: noto\'g\'ri qiymatlar va matn to\'qnashuvi → 400', async () => {
    expect((await api('dev').put({ buttons: { nope: { style: 'primary' } } })).status).toBe(400);
    expect((await api('dev').put({ buttons: { kb_chat: { style: 'pink' } } })).status).toBe(400);
    expect((await api('dev').put({ buttons: { kb_chat: { iconCustomEmojiId: 'x1' } } })).status).toBe(400);
    const c = await api('dev').put({ buttons: { kb_chat: { text: { uz: tb('uz', 'kb_objects') } } } });
    expect(c.status).toBe(400);
    expect(c.body.error).toMatch(/to'qnashuv/);
  });

  it('emoji paketi: havoladan qo\'shiladi; oddiy stiker paketi va noto\'g\'ri nom rad etiladi', async () => {
    expect((await api('dev').post('/packs', { link: 'https://t.me/addstickers/Regular' })).status).toBe(400);
    expect((await api('dev').post('/packs', { link: 'https://t.me/addemoji/Missing' })).status).toBe(400);
    expect((await api('dev').post('/packs', { link: 'not a link!' })).status).toBe(400);
    const r = await api('dev').post('/packs', { link: 'https://t.me/addemoji/BuildPack' });
    expect(r.status).toBe(200);
    expect(r.body.packs).toHaveLength(1);
    expect(r.body.packs[0]).toMatchObject({ name: 'BuildPack', title: 'Qurilish', count: 4 });
  });

  it('stiker rasmi: faqat paketdagi emoji, kesh bilan', async () => {
    const a = await request(app).get('/api/bot-ui-sticker/1001');
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toMatch(/image\/webp/);
    expect(a.headers['cross-origin-resource-policy']).toBe('cross-origin');
    await request(app).get('/api/bot-ui-sticker/1001');
    expect(tgDownloads()).toEqual(['t1']);
    expect((await request(app).get('/api/bot-ui-sticker/999999')).status).toBe(404); // paketda yo'q
    expect((await request(app).get('/api/bot-ui-sticker/1002')).status).toBe(404); // animatsion, thumbnail yo'q
    expect((await request(app).get('/api/bot-ui-sticker/abc')).status).toBe(400);
  });

  it('AI bilan bezash (soxta Gemini) → qoralama → qo\'llash', async () => {
    gem.result = {
      buttons: { confirmYes: { icon: '1001', style: 'success' }, confirmNo: { icon: '1002', style: 'danger' }, kb_objects: { icon: '1004', style: 'pink' }, bogus: { icon: '1001' }, kb_report: { icon: '555' } },
      messages: { '✅': '1001', '🏗': '1004', '🔥': '424242' },
    };
    const r = await decorate();
    expect(gem.prompt).toContain('confirmYes');
    expect(gem.prompt).toContain('KINDS');
    expect(gem.prompt).toContain('1003 💬');
    const d = r.body.draft;
    expect(d.source).toBe('ai');
    expect(d.buttons.confirmYes).toEqual({ iconCustomEmojiId: '1001', style: 'success' });
    expect(d.buttons.kb_objects).toEqual({ iconCustomEmojiId: '1004', style: 'primary' }); // noto'g'ri style → vazifasiga qarab
    expect(d.buttons.bogus).toBeUndefined();
    expect(d.buttons.kb_report?.iconCustomEmojiId).toBeUndefined(); // paketda yo'q id
    expect(d.messageEmoji['🔥']).toBeUndefined();
    // qoralama hali qo'llanmagan
    expect((await api('dev').get()).body.config.buttons.confirmYes).toBeUndefined();

    const a = await api('dev').post('/draft/apply');
    expect(a.status).toBe(200);
    expect(a.body.draft).toBeNull();
    expect(a.body.config.buttons.confirmYes).toMatchObject({ iconCustomEmojiId: '1001', style: 'success' });
    expect(a.body.config.buttons.kb_chat.text).toEqual({ uz: 'Suhbat', ru: 'Беседа' }); // matnlar saqlanib qoladi
    expect(a.body.config.messageEmoji).toEqual(expect.arrayContaining([{ emoji: '✅', id: '1001' }, { emoji: '🏗', id: '1004' }]));
    const m = decorateMarkup({ inline_keyboard: [[{ text: tb('uz', 'confirmYes'), callback_data: 'y' }]] });
    expect(m.inline_keyboard[0][0]).toMatchObject({ icon_custom_emoji_id: '1001', style: 'success' });
  });

  it('AI xatosi → kalit so\'zlar bo\'yicha qoralama (izoh bilan)', async () => {
    gem.fail = true;
    const r = await decorate();
    gem.fail = false;
    expect(r.body.draft.source).toBe('keywords');
    expect(r.body.draft.note).toMatch(/AI xatosi/);
    expect(r.body.draft.buttons.confirmYes.iconCustomEmojiId).toBe('1001'); // ✅ → ✅
    expect(r.body.draft.buttons.kb_objects.iconCustomEmojiId).toBe('1004'); // 🏗 → 🏗
    expect(r.body.draft.buttons.exitChat.style).toBe('danger');
    expect((await api('dev').del('/draft')).body.draft).toBeNull();
  });

  it('standartga qaytarish: tugmalar/buyruqlar tozalanadi, paketlar qoladi, eski buyruqlar ro\'yxati', async () => {
    const r = await api('dev').post('/reset');
    expect(r.status).toBe(200);
    expect(r.body.config.buttons).toEqual({});
    expect(r.body.packs).toHaveLength(1);
    const kb = { keyboard: [[{ text: tb('uz', 'kb_chat') }]] };
    expect(decorateMarkup(kb)).toBe(kb);
    const set = tg.calls.find(c => c.method === 'setMyCommands');
    expect(set?.body.commands[0]).toEqual({ command: 'start', description: 'Botni boshlash / Запуск' });
    const doc = await BotUiConfig.findOne({ key: 'global' }).lean();
    expect(doc?.commands).toEqual([]);
  });

  it('paketni o\'chirish', async () => {
    const r = await api('dev').del('/packs/BuildPack');
    expect(r.body.packs).toEqual([]);
    expect((await api('dev').post('/auto-decorate')).status).toBe(400);
  });
});

function tgDownloads() { return tg.downloads; }

// AI bezash fonda ishlaydi: POST darhol 202 (decorating), tayyor bo'lgach GET qoralamani qaytaradi
async function decorate() {
  const p = await api('dev').post('/auto-decorate');
  expect(p.status).toBe(202);
  expect(p.body.decorating).toBe(true);
  await __decorateJobForTests();
  const r = await api('dev').get();
  expect(r.body.decorating).toBe(false);
  return r;
}
