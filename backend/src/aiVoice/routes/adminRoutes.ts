import { Router } from 'express';

// Firma admini: /api/ai-voice/admin (index.ts: requireAuth + blockDeveloper).
// STUB (P1) — P8 to'ldiradi: requireAiAdmin (ega/direktor/o'rinbosar, DB'dan qayta o'qiladi) +
// companyHasFeature('ai_assistant') fail-closed; settings (version, 409), tools matritsasi kod chegarasi
// bilan, PATCH /employees consent/optOut'ni rad etadi, run-now manual dedupe kaliti, timezone faqat o'qish.
const router = Router();

router.use((_req, res) => {
  res.status(501).json({ error: 'not_implemented', message: 'AI sozlamalari hali tayyor emas' });
});

export default router;
