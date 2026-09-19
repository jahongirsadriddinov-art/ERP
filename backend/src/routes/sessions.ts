import { Router } from 'express';
import Session from '../models/Session';
import { kickSession } from '../services/socket';

const router = Router();

// requireAuth index.ts'da ulanadi (boshqa /api/admin/subscriptions kabi
// yo'llardagi bir xil andoza) — bu yerda qayta talab qilinmaydi.

// GET /api/sessions — "Ulangan qurilmalar" (ProfilePage) — joriy
// foydalanuvchining bekor qilinmagan barcha sessiyalari.
router.get('/', async (req, res) => {
  try {
    const currentJti = (req as any).user?.jti;
    const sessions = await Session.find({ userId: (req as any).user.userId, revoked: { $ne: true } })
      .sort({ lastSeenAt: -1 }).lean();
    res.json(sessions.map(s => ({
      id: s._id,
      deviceLabel: s.deviceLabel,
      loginMethod: s.loginMethod,
      ip: s.ip,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      current: !!currentJti && s.jti === currentJti,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// DELETE /api/sessions/all — HOZIRGISIDAN BOSHQA barcha qurilmalarni bir
// yo'la chiqarib yuborish. Aniq "/:id" dan OLDIN e'lon qilingan — aks
// holda Express "all"ni ObjectId sifatida "/:id" ga yuborib yuborardi.
router.delete('/all', async (req, res) => {
  try {
    const currentJti = (req as any).user?.jti;
    const sessions = await Session.find({ userId: (req as any).user.userId, revoked: { $ne: true } });
    let count = 0;
    for (const session of sessions) {
      if (currentJti && session.jti === currentJti) continue; // o'zini chiqarib yubormaydi
      session.revoked = true;
      await session.save();
      kickSession(session.jti);
      count++;
    }
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// DELETE /api/sessions/:id — shu qurilmani chiqarib yuborish (bekor qilish).
// O'ZINIKI (userId mos kelishi) bo'lishi shart — boshqa foydalanuvchining
// sessiyasini bekor qilib bo'lmaydi. Bekor qilingach, agar o'sha qurilma
// hozir real-vaqt ulanishda bo'lsa — DARHOL uziladi (services/socket.ts
// kickSession) — aks holda faqat o'sha qurilmaning KEYINGI oddiy HTTP
// so'rovida (masalan sahifani yangilaganda) ta'sir qilardi.
router.delete('/:id', async (req, res) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, userId: (req as any).user.userId });
    if (!session) return res.status(404).json({ error: 'Topilmadi' });
    session.revoked = true;
    await session.save();
    kickSession(session.jti);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
