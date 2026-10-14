import { Router } from 'express';

// O'zim: /api/ai-voice/me (index.ts: requireAuth + blockDeveloper; workGate ALLOW ro'yxatida).
// STUB (P1) — P3 to'ldiradi: GET/PATCH / (til, opt-out, rozilik — consent.ts, kanal tartibi),
// /reminders CRUD, POST /attendance/:id/respond, GET /pending-call. Faqat o'z ma'lumotlari.
const router = Router();

router.use((_req, res) => {
  res.status(501).json({ error: 'not_implemented', message: 'AI shaxsiy sozlamalari hali tayyor emas' });
});

export default router;
