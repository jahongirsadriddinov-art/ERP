import { Router } from 'express';
import Session from '../models/Session';

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

// DELETE /api/sessions/:id — shu qurilmani chiqarib yuborish (bekor qilish).
// O'ZINIKI (userId mos kelishi) bo'lishi shart — boshqa foydalanuvchining
// sessiyasini bekor qilib bo'lmaydi.
router.delete('/:id', async (req, res) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, userId: (req as any).user.userId });
    if (!session) return res.status(404).json({ error: 'Topilmadi' });
    session.revoked = true;
    await session.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
