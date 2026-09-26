import { Router } from 'express';
import crypto from 'crypto';
import User from '../models/User';
import { getTenant } from '../middleware/tenantContext';
import { checkRate } from '../utils/rateLimit';
import { normalizePhone } from '../utils/tokens';
import { bot } from '../services/bot';

// Ilova qulfi PIN kodi — HISOBGA bog'langan (bir marta o'rnatiladi, keyin har qanday yangi
// qurilmada login qilinganda avtomatik tiklanadi). Server faqat tuz (salt) + SHA-256 xeshni
// saqlaydi — PIN'ning o'zi hech qachon serverga kelmaydi. Qulfni ochish qurilmada (oflayn ham)
// shu xesh bilan tekshiriladi.
const router = Router();

const HEX = (len: number) => new RegExp(`^[0-9a-f]{${len}}$`);
const validPair = (salt: unknown, hash: unknown) =>
  typeof salt === 'string' && HEX(32).test(salt) && typeof hash === 'string' && HEX(64).test(hash);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// GET /api/pin — shu hisobning PIN (salt+hash), bo'lmasa { set: false }
router.get('/', async (_req, res) => {
  const uid = getTenant()?.userId;
  if (!uid) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
  const u: any = await User.findById(uid).select('+pinSalt +pinHash').lean();
  if (!u?.pinHash) return res.json({ set: false });
  res.json({ set: true, salt: u.pinSalt, hash: u.pinHash });
});

// PUT /api/pin — yangi PIN (qurilmada hisoblangan salt+hash)
router.put('/', async (req, res) => {
  const uid = getTenant()?.userId;
  if (!uid) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
  const { salt, hash } = req.body || {};
  if (!validPair(salt, hash)) return res.status(400).json({ error: "Noto'g'ri PIN ma'lumoti" });
  await User.updateOne({ _id: uid }, { $set: { pinSalt: salt, pinHash: hash } });
  res.json({ ok: true });
});

// POST /api/pin/reset/request { phone } — "PIN kodni unutdingizmi?": raqam hisobniki bilan mos
// bo'lsa, Telegram botga 6 xonali tiklash kodi yuboriladi (2 daqiqa amal qiladi).
router.post('/reset/request', async (req, res) => {
  const uid = getTenant()?.userId;
  if (!uid) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
  const rl = checkRate(`pinreset:req:${uid}`, 3, 10 * 60 * 1000);
  if (!rl.allowed) return res.status(429).json({ error: `Juda ko'p urinish. ${rl.retryAfterSec} soniyadan keyin qayta urining.` });
  const user: any = await User.findById(uid);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  const phone = normalizePhone(String(req.body?.phone || ''));
  if (!phone || normalizePhone(user.phone || '') !== phone) return res.status(400).json({ error: "Telefon raqami hisobingizdagi raqamga mos emas" });
  if (!user.telegramChatId) return res.status(400).json({ error: "Hisobingiz Telegram botga ulanmagan — botga kirib /start bosing" });
  const code = String(crypto.randomInt(100000, 1000000));
  user.pinResetCodeHash = sha(`${uid}:${code}`);
  user.pinResetExpires = new Date(Date.now() + 2 * 60 * 1000);
  user.pinResetAttempts = 0;
  await user.save();
  try {
    await bot.sendMessage(user.telegramChatId, `🔐 PIN kodni tiklash kodi: <code>${code}</code>\nKod 2 daqiqa amal qiladi. Siz so'ramagan bo'lsangiz — e'tibor bermang.`, { parse_mode: 'HTML' });
  } catch {
    return res.status(502).json({ error: "Botga xabar yuborib bo'lmadi" });
  }
  res.json({ ok: true });
});

// POST /api/pin/reset/confirm { code, salt, hash } — kod to'g'ri bo'lsa yangi PIN saqlanadi
router.post('/reset/confirm', async (req, res) => {
  const uid = getTenant()?.userId;
  if (!uid) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
  const { code, salt, hash } = req.body || {};
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Kod 6 xonali bo'lishi kerak" });
  if (!validPair(salt, hash)) return res.status(400).json({ error: "Noto'g'ri PIN ma'lumoti" });
  const user: any = await User.findById(uid).select('+pinResetCodeHash');
  if (!user?.pinResetCodeHash || !user.pinResetExpires || user.pinResetExpires < new Date()) {
    return res.status(400).json({ error: "Kod muddati tugagan — yangi kod so'rang" });
  }
  if ((user.pinResetAttempts || 0) >= 5) {
    user.pinResetCodeHash = undefined; user.pinResetExpires = undefined;
    await user.save();
    return res.status(429).json({ error: "Juda ko'p noto'g'ri urinish — yangi kod so'rang" });
  }
  const expected = Buffer.from(user.pinResetCodeHash, 'hex');
  const given = Buffer.from(sha(`${uid}:${code}`), 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    user.pinResetAttempts = (user.pinResetAttempts || 0) + 1;
    await user.save();
    return res.status(400).json({ error: "Kod noto'g'ri" });
  }
  user.pinSalt = salt; user.pinHash = hash;
  user.pinResetCodeHash = undefined; user.pinResetExpires = undefined; user.pinResetAttempts = 0;
  await user.save();
  res.json({ ok: true });
});

export default router;
