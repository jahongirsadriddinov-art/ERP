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

describe('ofis ob-havosi (Open-Meteo)', () => {
  it('WMO kodlari → rejim', async () => {
    const { wmoToMode } = await import('../weather');
    expect(wmoToMode(0)).toBe('sunny');
    expect(wmoToMode(1)).toBe('sunny');
    expect(wmoToMode(3)).toBe('cloudy');
    expect(wmoToMode(45)).toBe('fog');
    expect(wmoToMode(61)).toBe('rain');
    expect(wmoToMode(81)).toBe('rain');
    expect(wmoToMode(95)).toBe('rain');
    expect(wmoToMode(73)).toBe('snow');
    expect(wmoToMode(86)).toBe('snow');
    expect(wmoToMode(2, { precipitation: 0.4 })).toBe('rain');
    expect(wmoToMode(61, { snowfall: 0.2 })).toBe('snow');
    expect(wmoToMode(null, { cloud: 90 })).toBe('cloudy');
  });

  it('endpoint: faqat dasturchi, 10 daqiqa kesh, xatoda zaxira', async () => {
    const { __setWeatherFetcherForTests, OPEN_METEO_URL } = await import('../weather');
    let calls = 0;
    __setWeatherFetcherForTests(async (url) => {
      calls++;
      expect(url).toBe(OPEN_METEO_URL);
      return new Response(JSON.stringify({ current: { weather_code: 63, temperature_2m: 7.4, is_day: 1, cloud_cover: 100, precipitation: 1.2, snowfall: 0 } }), { status: 200 });
    });
    expect((await request(app).get(`${P}/office/weather`).set('Authorization', tok(A.ownerId))).status).toBe(403);
    const r = await request(app).get(`${P}/office/weather`).set('Authorization', tok(devId));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'rain', code: 63, temp: 7.4, isDay: true, source: 'open-meteo' });
    const r2 = await request(app).get(`${P}/office/weather`).set('Authorization', tok(devId));
    expect(r2.body.source).toBe('cache');
    expect(calls).toBe(1);
    __setWeatherFetcherForTests(async () => { throw new Error('offline'); });
    const r3 = await request(app).get(`${P}/office/weather`).set('Authorization', tok(devId));
    expect(r3.body).toMatchObject({ mode: 'sunny', source: 'fallback' });
    __setWeatherFetcherForTests(null);
  });
});

describe('o\'yin rekordlari va TTS', () => {
  it('rekord: faqat kattasi saqlanadi, har dasturchining o\'zi, noto\'g\'ri o\'yin 400', async () => {
    const put = (b: object, id = devId) => request(app).put(`${P}/office/scores`).set('Authorization', tok(id)).send(b);
    expect((await put({ game: 'snake', score: 12 })).body.scores).toMatchObject({ snake: 12 });
    expect((await put({ game: 'snake', score: 5 })).body.scores).toMatchObject({ snake: 12 });
    expect((await put({ game: 'g2048', score: 2048 })).body.scores).toMatchObject({ snake: 12, g2048: 2048 });
    expect((await put({ game: 'hack', score: 1 })).status).toBe(400);
    expect((await put({ game: 'snake', score: -3 })).status).toBe(400);
    expect((await request(app).get(`${P}/office/scores`).set('Authorization', tok(dev2))).body.scores).toEqual({});
    expect((await request(app).get(`${P}/office/scores`).set('Authorization', tok(devId))).body.scores).toMatchObject({ snake: 12, g2048: 2048 });
    expect((await request(app).get(`${P}/office/scores`).set('Authorization', tok(A.ownerId))).status).toBe(403);
  });

  it('TTS: matn → WAV (24 kHz), xatoda 503', async () => {
    const { __setTtsForTests } = await import('../routes');
    __setTtsForTests({ synth: async (text, o) => { expect(o.lang).toBe('uz'); expect(text).toBe('Salom'); return Buffer.alloc(4800); } });
    const r = await request(app).post(`${P}/office/tts`).set('Authorization', tok(devId)).send({ text: 'Salom', lang: 'uz' });
    expect(r.status).toBe(200);
    const wav = Buffer.from(r.body.audio, 'base64');
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(24000);
    __setTtsForTests({ synth: async () => { throw new Error('no key'); } });
    expect((await request(app).post(`${P}/office/tts`).set('Authorization', tok(devId)).send({ text: 'x' })).status).toBe(503);
    expect((await request(app).post(`${P}/office/tts`).set('Authorization', tok(devId)).send({ text: '' })).status).toBe(400);
    __setTtsForTests(null);
  });
});
