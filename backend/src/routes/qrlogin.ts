import { Router } from 'express';
import { randomBytes } from 'crypto';
import QrLoginSession from '../models/QrLoginSession';
import User from '../models/User';
import { requireAuth } from '../middleware/auth';
import { checkRate } from '../utils/rateLimit';
import { issueSession } from './auth';

const router = Router();

const SLOT_MS = 3000;       // har bir kod 3 soniya amal qiladi
const SLOT_COUNT = 3;       // jami 3 ta ketma-ket kod skanerlanishi kerak
const SESSION_TIMEOUT_MS = 60 * 1000; // 60 soniyadan keyin "muddati tugadi"

function randomCode(): string {
  // 6 ta katta harf/raqam — taxmin qilish qiyin, lekin QR ichida qisqa
  // matn sifatida qulay.
  return randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

function currentSlot(createdAt: Date): number {
  return Math.min(SLOT_COUNT - 1, Math.floor((Date.now() - createdAt.getTime()) / SLOT_MS));
}
function isExpired(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > SESSION_TIMEOUT_MS;
}
function isValidSessionId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

// POST /api/auth/qrlogin/create — laptop/planshet sahifasi ochilganda
// chaqiradi (auth SHART EMAS — hali hech kim login qilmagan).
router.post('/create', async (req, res) => {
  try {
    const ip = (req.ip || '').trim();
    const rl = checkRate(`qrlogin:create:${ip}`, 20, 10 * 60 * 1000);
    if (!rl.allowed) return res.status(429).json({ error: "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring." });

    const sessionId = randomBytes(32).toString('hex');
    const codes = Array.from({ length: SLOT_COUNT }, randomCode);
    await QrLoginSession.create({ sessionId, codes, status: 'pending' });
    res.json({ sessionId, slotMs: SLOT_MS, slotCount: SLOT_COUNT });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/auth/qrlogin/code/:sessionId — laptop/planshet sahifasi har
// soniyada so'raydi: hozirgi kod (QR shunga qarab qayta chiziladi) va
// progress (nechta slot skanerlangan).
router.get('/code/:sessionId', async (req, res) => {
  try {
    if (!isValidSessionId(req.params.sessionId)) return res.status(400).json({ error: 'Yaroqsiz sessiya' });
    const session = await QrLoginSession.findOne({ sessionId: req.params.sessionId }).lean();
    if (!session) return res.json({ expired: true });
    if (session.status !== 'pending' && session.status !== 'verified') return res.json({ expired: true });
    if (isExpired(session.createdAt as any)) return res.json({ expired: true });

    const slot = currentSlot(session.createdAt as any);
    res.json({
      code: session.codes[slot],
      slot,
      scannedCount: session.scannedSlots.length,
      verified: session.status === 'verified',
    });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST /api/auth/qrlogin/scan — TELEFONDAN (allaqachon login qilingan
// foydalanuvchi) chaqiriladi, QRScanner kamera orqali o'qigan
// "qrlogin:<sessionId>:<code>" matnini yuboradi. Har safar FAQAT hozirgi
// vaqt-slotiga mos kod qabul qilinadi va har bir slot faqat BIR MARTA
// hisoblanadi — shu sabab haqiqatda ketma-ket 3 ta ALOHIDA (jami ~6-9
// soniyalik) skanerlash kerak, bitta suratga olingan QR kadri YETARLI EMAS.
router.post('/scan', requireAuth, async (req, res) => {
  try {
    const { sessionId, code } = req.body || {};
    if (!isValidSessionId(sessionId) || typeof code !== 'string') {
      return res.status(400).json({ ok: false, error: 'Yaroqsiz QR' });
    }
    const rl = checkRate(`qrlogin:scan:${(req as any).user.userId}`, 30, 60 * 1000);
    if (!rl.allowed) return res.status(429).json({ ok: false, error: "Juda ko'p urinish" });

    const session = await QrLoginSession.findOne({ sessionId });
    if (!session || session.status === 'consumed' || isExpired(session.createdAt as any)) {
      return res.status(410).json({ ok: false, error: "QR muddati tugagan — sahifani yangilang" });
    }
    if (session.status === 'verified') {
      return res.json({ ok: true, scannedCount: session.scannedSlots.length, verified: true });
    }

    // XAVFSIZLIK — MUHIM TUZATISH: avval sessiya "kim skanerlagani" FAQAT
    // OXIRGI (3-chi) muvaffaqiyatli skanda yozilardi — ya'ni 1- va 2-slotni
    // BIR hisob, 3-slotni BOSHQA hisob skanerlasa, laptopga O'SHA OXIRGI
    // (ehtimol butunlay begona) hisob kirib qolardi. Endi sessiya BIRINCHI
    // muvaffaqiyatli skanda o'sha hisobga "biriktiriladi" — qolgan 2 ta
    // slotni ham FAQAT O'SHA BIR XIL hisob yakunlay oladi.
    const scannerId = (req as any).user.userId as string;
    if (session.userId && session.userId !== scannerId) {
      return res.status(403).json({ ok: false, error: "Bu QR boshqa hisob tomonidan skanerlanmoqda" });
    }

    const slot = currentSlot(session.createdAt as any);
    if (session.codes[slot] !== code) {
      return res.status(400).json({ ok: false, error: "Kod eskirgan — yangi kod kutilmoqda" });
    }
    if (session.scannedSlots.includes(slot)) {
      // Xuddi shu kadr allaqachon hisoblangan — kameraning navbatdagi
      // kadrlarida bir xil QR qayta-qayta o'qilishi normal, xato emas.
      return res.json({ ok: true, scannedCount: session.scannedSlots.length, verified: false });
    }

    session.userId = scannerId;
    session.scannedSlots.push(slot);
    if (session.scannedSlots.length >= SLOT_COUNT) {
      session.status = 'verified';
    }
    await session.save();
    res.json({ ok: true, scannedCount: session.scannedSlots.length, verified: session.status === 'verified' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server xatoligi' });
  }
});

// POST /api/auth/qrlogin/finalize — laptop/planshet sahifasi `verified`ni
// ko'rgach chaqiradi, HAQIQIY JWT'ni oladi. Bir martalik: muvaffaqiyatli
// chaqirilgach sessiya 'consumed'ga o'tadi, sessionId qayta ishlatib
// bo'lmaydi. issueSession (routes/auth.ts) chaqiriladi — bloklangan/
// kutilayotgan/muddati tugagan obuna tekshiruvlari oddiy parol bilan
// kirish bilan AYNAN bir xil qo'llanadi.
router.post('/finalize', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!isValidSessionId(sessionId)) return res.status(400).json({ error: 'Yaroqsiz sessiya' });

    const session = await QrLoginSession.findOneAndUpdate(
      { sessionId, status: 'verified' },
      { status: 'consumed' },
      { new: false }
    );
    if (!session || !session.userId) {
      return res.status(400).json({ error: 'Hali tasdiqlanmagan yoki muddati tugagan' });
    }
    const user = await User.findById(session.userId);
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    return issueSession(user, res, req);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
