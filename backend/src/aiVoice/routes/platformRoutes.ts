import { Router } from 'express';

// Platforma: /api/ai-voice/platform (index.ts: requireAuth + requireDeveloper).
// STUB (P1) — P6 to'ldiradi: telegram-account holati, login start|code|password (5/10 daq, kodlar
// HECH QACHON saqlanmaydi/log qilinmaydi/audit qilinmaydi), logout, test-call (callConsent shart,
// audit, 5/soat), worker holati.
const router = Router();

// B8: login relay javoblari hech qayerda keshlanmasin (stubda ham).
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

router.use((_req, res) => {
  res.status(501).json({ error: 'not_implemented', message: 'AI Telegram akkaunti boshqaruvi hali tayyor emas' });
});

export default router;
