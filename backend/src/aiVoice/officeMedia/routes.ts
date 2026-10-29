import crypto from 'crypto';
import { geminiAudioToJson } from '../../services/gemini';
import { Router, type NextFunction, type Request, type Response } from 'express';
import OfficeMedia from '../../models/OfficeMedia';
import { hitRate } from '../lib/mongoRateLimit';
import { aiConfig } from '../config';
import { wavToPcm16, resamplePcm16 } from '../voice/audio';
import { GeminiTranscriber, GeminiTts, type Transcriber, type TtsSynth } from '../voice/geminiSpeech';
import { pcm16ToWav } from '../voice/audio';
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
let tts: TtsSynth = new GeminiTts();
/** Faqat testlar: soxta TTS (null — asl). */
export function __setTtsForTests(t: TtsSynth | null): void { tts = t || new GeminiTts(); }

const mediaDto = (m: any) => ({
  yandex: m?.yandex || '', tracks: (m?.tracks || []).map((t: any) => ({ id: t.id, name: t.name, url: t.url })), cinema: m?.cinema || '',
});

export const officeMediaRoutes = Router();
officeMediaRoutes.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const GAME_IDS = ['pong', 'snake', 'blocks', 'g2048', 'breakout', 'racer', 'ttt'];
/** Mini-o'yinlar rekordlari (dasturchining o'zi). */
officeMediaRoutes.get('/office/scores', wrap(async (req, res) => {
  const d: any = await OfficeMedia.findOne({ userId: uid(req) }).select('scores').lean();
  res.json({ scores: d?.scores || {} });
}));
/** Rekord yuborish: { game, score } — faqat kattaroq bo'lsa yoziladi. */
officeMediaRoutes.put('/office/scores', wrap(async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  const game = String(b.game || ''), score = Math.floor(Number(b.score));
  if (!GAME_IDS.includes(game) || !Number.isFinite(score) || score < 0 || score > 1e9) return res.status(400).json({ error: 'invalid' });
  await OfficeMedia.updateOne({ userId: uid(req) }, { $max: { [`scores.${game}`]: score } }, { upsert: true });
  const d: any = await OfficeMedia.findOne({ userId: uid(req) }).select('scores').lean();
  res.json({ ok: true, scores: d?.scores || {} });
}));

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
  const doc = await OfficeMedia.findOneAndUpdate({ userId: uid(req) }, { $set: set }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).lean();
  res.json({ ok: true, media: mediaDto(doc) });
}));

/** Butun so'rov uchun byudjet — Cloudflare 100 s dan OLDIN tugashi shart (524 bo'lmasin). */
const TOTAL_BUDGET_MS = 70_000;
const FIRST_TRY_MS = 40_000;

/** Va'dani belgilangan vaqtda to'xtatadi (model osilib qolsa so'rov cheksiz kutmasin). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!(ms > 0)) return Promise.reject(new Error('timeout'));
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    t.unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

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
  // Owner 2026-10-28 xato jurnali: "API 524: POST .../office/transcribe". 524 — Cloudflare
  // 100 soniyadan ko'p kutib, ulanishni uzgan. Bu yerda ikkita urinish KETMA-KET va HECH
  // QANDAY taymautsiz ketardi: model osilsa so'rov cheksiz osilib, foydalanuvchi 524 olardi.
  // Endi umumiy byudjet 70 s (Cloudflare chegarasidan past) — ortiq ketsa aniq xato qaytadi.
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const left = () => deadline - Date.now();
  try {
    const r = await withTimeout(transcriber.transcribe(pcm, { lang, model: aiConfig.models.transcribe }), Math.min(FIRST_TRY_MS, left()));
    return res.json({ text: (r.text || '').slice(0, 2000) });
  } catch (e: any) {
    console.warn('[office/transcribe] transcriber failed, Gemini audio fallback:', String(e?.message || e).slice(0, 200));
  }
  if (left() < 5_000) return res.status(503).json({ error: 'stt_timeout' });
  // Zaxira (owner 2026-10-23: "stt_failed" chiqardi) — ovozli chiqimda ishlab turgan Gemini audio yo'li
  try {
    const out = await withTimeout(geminiAudioToJson(Buffer.from(b.audio, 'base64'), 'audio/wav',
      `Transcribe this ${lang === 'ru' ? 'Russian' : 'Uzbek (Latin script)'} speech exactly as spoken. Answer ONLY JSON: {"text":"..."}. If there is no speech, {"text":""}.`), left());
    res.json({ text: String(out?.text || '').slice(0, 2000) });
  } catch (e: any) {
    console.error('[office/transcribe] failed:', String(e?.message || e).slice(0, 200));
    res.status(502).json({ error: 'stt_failed' });
  }
}));

/** Agent javobini ovozlashtirish (o'zbek/rus; Gemini TTS — qo'ng'iroqlardagi bilan bir xil). Tana: { text, lang } → { audio: base64 WAV }. */
officeMediaRoutes.post('/office/tts', wrap(async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  const text = typeof b.text === 'string' ? b.text.trim().slice(0, 600) : '';
  if (!text) return res.status(400).json({ error: 'invalid' });
  const rl = await hitRate(`office:tts:${uid(req)}`, 200, 3_600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited' });
  try {
    const pcm = await tts.synth(text, { voiceName: 'Kore', lang: b.lang === 'ru' ? 'ru' : 'uz', model: aiConfig.models.tts });
    res.json({ audio: pcm16ToWav(pcm, 24_000).toString('base64'), mime: 'audio/wav' });
  } catch {
    res.status(503).json({ error: 'tts_unavailable' });
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
