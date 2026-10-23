// AI ofis — media (musiqa/kino havolalari, o'z qo'shiqlari), ovoz → matn va agent bilan suhbat. Faqat dasturchi.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../../../models/User';
import OfficeMedia from '../../../models/OfficeMedia';
import { JWT_SECRET } from '../../../middleware/auth';
import { mountAiVoiceRoutes } from '../../bootstrap';
import { __setContentRunnerForTests } from '../../agents/service';
import { __setTranscriberForTests } from '../routes';
import { pcm16ToWav } from '../../voice/audio';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from '../../__tests__/helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany;
let devId: string, dev2: string;
const app = express();
app.use(express.json({ limit: '10mb' }));
mountAiVoiceRoutes(app);
const tok = (id: string) => `Bearer ${jwt.sign({ userId: id }, JWT_SECRET)}`;
const P = '/api/ai-voice/platform';
const saved = process.env.AI_VOICE_ENABLED;

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  mongo = await startMongo();
  A = await seedCompany('Media');
  devId = String((await User.create({ firstName: 'Dev', phone: '+998900007001', role: 'dasturchi' } as any))._id);
  dev2 = String((await User.create({ firstName: 'Dev2', phone: '+998900007002', role: 'dasturchi' } as any))._id);
}, 120_000);
beforeEach(async () => { await OfficeMedia.deleteMany({}); __setContentRunnerForTests(null); __setTranscriberForTests(null); });
afterAll(async () => {
  __setContentRunnerForTests(null); __setTranscriberForTests(null);
  if (saved === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = saved;
  await stopMongo(mongo);
});

describe('ofis media', () => {
  it('faqat dasturchi; har dasturchining o\'zi', async () => {
    expect((await request(app).get(`${P}/office/media`).set('Authorization', tok(A.ownerId))).status).toBe(403);
    expect((await request(app).get(`${P}/office/media`)).status).toBe(401);
    const empty = await request(app).get(`${P}/office/media`).set('Authorization', tok(devId));
    expect(empty.body).toEqual({ yandex: '', tracks: [], cinema: '' });
    const put = await request(app).put(`${P}/office/media`).set('Authorization', tok(devId)).send({
      yandex: 'https://music.yandex.ru/album/123/track/456', cinema: 'https://youtu.be/dQw4w9WgXcQ',
      tracks: [{ name: 'Qo\'shiq', url: 'https://res.cloudinary.com/demo/song.mp3' }],
    });
    expect(put.status).toBe(200);
    expect(put.body.media).toMatchObject({ yandex: 'https://music.yandex.ru/album/123/track/456', cinema: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(put.body.media.tracks[0]).toMatchObject({ name: 'Qo\'shiq', url: 'https://res.cloudinary.com/demo/song.mp3' });
    expect(put.body.media.tracks[0].id).toMatch(/^[a-f0-9]{12}$/);
    expect((await request(app).get(`${P}/office/media`).set('Authorization', tok(dev2))).body.yandex).toBe('');
  });

  it('noto\'g\'ri havolalar rad etiladi', async () => {
    const put = (b: object) => request(app).put(`${P}/office/media`).set('Authorization', tok(devId)).send(b);
    expect((await put({ yandex: 'https://music.yandex.ru.evil.com/album/1' })).body.error).toBe('invalid_yandex');
    expect((await put({ cinema: 'javascript:alert(1)' })).body.error).toBe('invalid_video');
    expect((await put({ tracks: [{ name: 'x', url: 'http://insecure/song.mp3' }] })).body.error).toBe('invalid_tracks');
    expect((await put({ cinema: 'https://hd.kinopoisk.ru/film/1' })).status).toBe(200);
    expect((await put({ yandex: '' })).status).toBe(200);
  });
});

describe('ovoz → matn', () => {
  it('WAV → transkriptor (16 kHz), noto\'g\'ri audio 400', async () => {
    let got = 0;
    __setTranscriberForTests({ transcribe: async (pcm, o) => { got = pcm.length; expect(o.lang).toBe('ru'); return { text: 'Привет, как дела?' }; } });
    const wav = pcm16ToWav(Buffer.alloc(16_000 * 2), 16_000).toString('base64');
    const r = await request(app).post(`${P}/office/transcribe`).set('Authorization', tok(devId)).send({ audio: wav, lang: 'ru' });
    expect(r.status).toBe(200);
    expect(r.body.text).toBe('Привет, как дела?');
    expect(got).toBe(32_000);
    expect((await request(app).post(`${P}/office/transcribe`).set('Authorization', tok(devId)).send({ audio: 'bm90IGEgd2F2' })).status).toBe(400);
    expect((await request(app).post(`${P}/office/transcribe`).set('Authorization', tok(A.ownerId)).send({ audio: wav })).status).toBe(403);
  });
});

describe('agent bilan suhbat', () => {
  it('agent nomidan javob (vazifa yaratilmaydi); noma\'lum agent 404', async () => {
    let prompt = '';
    __setContentRunnerForTests(async (p) => { prompt = p; return { reply: 'Hozir login API ustida ishlayapman.' }; });
    const r = await request(app).post(`${P}/agents/backend/chat`).set('Authorization', tok(devId))
      .send({ text: 'Nima qilyapsan?', history: [{ role: 'me', text: 'Salom' }, { role: 'agent', text: 'Salom!' }] });
    expect(r.status).toBe(200);
    expect(r.body.reply).toBe('Hozir login API ustida ishlayapman.');
    expect(prompt).toContain('"Backend"');
    expect(prompt).toContain('Egasi: Nima qilyapsan?');
    expect((await request(app).post(`${P}/agents/nope/chat`).set('Authorization', tok(devId)).send({ text: 'x' })).status).toBe(404);
    expect((await request(app).post(`${P}/agents/backend/chat`).set('Authorization', tok(devId)).send({ text: '' })).status).toBe(400);
  });
});
