import crypto from 'crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import OfficeMedia from '../../models/OfficeMedia';
import { hitRate } from '../lib/mongoRateLimit';
import { aiConfig } from '../config';
import { wavToPcm16, resamplePcm16 } from '../voice/audio';
import { GeminiTranscriber, type Transcriber } from '../voice/geminiSpeech';
import { chatWithAgent } from '../agents/service';
import { isMediaFileUrl, parseVideoLink, parseYandexMusic } from './links';
import { getOfficeWeather } from './weather';

// AI ofis — media va ovozli suhbat (owner 2026-10-23). Bootstrap: /api/ai-voice/platform (requireAuth + requireDeveloper).
//  GET/PUT /office/media     — dasturchining musiqa (Yandex havola + o'z qo'shiqlari) va kino havolasi;
//  POST /office/transcribe   — ovoz (16 kHz WAV, base64) → matn (Gemini, o'zbek/rus);
//  POST /agents/:key/chat    — agent bilan suhbat (o'z ishi haqida savolga javob; Gemini).
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((e) => {
      console.error('[aiVoice/officeMedia] xato:', (e as Error)?.message?.slice(0, 160) || 'Error');
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
      else next();
    });
  };
const uid = (req: Request) => String(req.user?.userId || '');
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

let transcriber: Transcriber = new GeminiTranscriber();
/** Faqat testlar: soxta transkriptor (null — asl). */
export function __setTranscriberForTests(t: Transcriber | null): void { transcriber = t || new GeminiTranscriber(); }

const mediaDto = (m: any) => ({
  yandex: m?.yandex || '', tracks: (m?.tracks || []).map((t: any) => ({ id: t.id, name: t.name, url: t.url })), cinema: m?.cinema || '',
});

export const officeMediaRoutes = Router();
officeMediaRoutes.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

/** Toshkentdagi hozirgi ob-havo (Open-Meteo, 10 daqiqa kesh) — ofis tashqarisi uchun. */
officeMediaRoutes.get('/office/weather', wrap(async (_req, res) => {
  res.json(await getOfficeWeather());
}));

officeMediaRoutes.get('/office/media', wrap(async (req, res) => {
  res.json(mediaDto(await OfficeMedia.findOne({ userId: uid(req) }).lean()));
}));

officeMediaRoutes.put('/office/media', wrap(async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  const set: Record<string, unknown> = {};
  if ('yandex' in b) {
    const v = typeof b.yandex === 'string' ? b.yandex.trim() : '';
    if (v && !parseYandexMusic(v)) return res.status(400).json({ error: 'invalid_yandex' });
    set.yandex = v;
  }
  if ('cinema' in b) {
    const v = typeof b.cinema === 'string' ? b.cinema.trim() : '';
    if (v && !parseVideoLink(v) && !isMediaFileUrl(v, 'video')) return res.status(400).json({ error: 'invalid_video' });
    set.cinema = v;
  }
  if ('tracks' in b) {
    if (!Array.isArray(b.tracks) || b.tracks.length > 50) return res.status(400).json({ error: 'invalid_tracks' });
    const tracks = [];
    for (const t of b.tracks) {
      if (!isObj(t) || !isMediaFileUrl(t.url, 'audio')) return res.status(400).json({ error: 'invalid_tracks' });
      tracks.push({
        id: typeof t.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(t.id) ? t.id : crypto.randomBytes(6).toString('hex'),
        name: String(t.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || 'Track',
        url: String(t.url).trim(),
      });
    }
    set.tracks = tracks;
  }
  const doc = await OfficeMedia.findOneAndUpdate({ userId: uid(req) }, { $set: set }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  res.json({ ok: true, media: mediaDto(doc) });
}));

/** Ovoz → matn. Tana: { audio: base64 WAV (16 kHz mono, ≤ 60 s), lang?: 'uz' | 'ru' }. */
officeMediaRoutes.post('/office/transcribe', wrap(async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  const rl = await hitRate(`office:stt:${uid(req)}`, 120, 3_600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited' });
  if (typeof b.audio !== 'string' || b.audio.length > 2_800_000) return res.status(400).json({ error: 'invalid_audio' });
  const wav = wavToPcm16(Buffer.from(b.audio, 'base64'));
  if (!wav || wav.pcm.length < 1600) return res.status(400).json({ error: 'invalid_audio' });
  const pcm = wav.rate === 16_000 ? wav.pcm : resamplePcm16(wav.pcm, wav.rate, 16_000);
  const lang = b.lang === 'ru' ? 'ru' : 'uz';
  try {
    const r = await transcriber.transcribe(pcm, { lang, model: aiConfig.models.transcribe });
    res.json({ text: (r.text || '').slice(0, 2000) });
  } catch {
    res.status(502).json({ error: 'stt_failed' });
  }
}));

/** Agent bilan suhbat. Tana: { text, history?: [{ role: 'me' | 'agent', text }] } → { reply }. */
officeMediaRoutes.post('/agents/:key/chat', wrap(async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  const rl = await hitRate(`office:chat:${uid(req)}`, 120, 3_600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited' });
  const r = await chatWithAgent(String(req.params.key || '').slice(0, 40), b.text, b.history);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ reply: r.reply });
}));
