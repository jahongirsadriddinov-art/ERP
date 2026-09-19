import { Router } from 'express';
import PromoCode from '../models/PromoCode';
import { requireAuth, requireDeveloper } from '../middleware/auth';
import { getPlanInfo } from '../config/plans';
import { checkPromoCode } from '../services/promoCodes';

const router = Router();

// POST /api/promocodes/validate — RO'YXATDAN O'TISH paytida hali login
// qilmagan foydalanuvchi ham promokodni tekshira olishi kerak, shu sabab
// auth talab qilinmaydi. Limitni ISHLATIB QO'YMAYDI (faqat o'qiydi) —
// services/promoCodes.ts'dagi izohga qarang.
router.post('/validate', async (req, res) => {
  try {
    const { code, planKey } = req.body || {};
    if (!code || !planKey) return res.status(400).json({ ok: false, error: 'Kod va tarif kerak' });
    const planInfo = getPlanInfo(planKey);
    if (!planInfo) return res.status(400).json({ ok: false, error: 'Tarif topilmadi' });
    const result = await checkPromoCode(code, planKey, planInfo.amount);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server xatoligi' });
  }
});

// Qolgani FAQAT dasturchi (super-admin) uchun.
router.use(requireAuth, requireDeveloper);

router.get('/', async (req, res) => {
  try {
    const list = await PromoCode.find().sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { code, type, value, maxUses, expiresAt, applicablePlans } = req.body || {};
    const clean = String(code || '').trim().toUpperCase();
    const RESERVED = new Set(['__PROTO__', 'CONSTRUCTOR', 'PROTOTYPE']);
    if (!/^[A-Z0-9_-]{2,32}$/.test(clean) || RESERVED.has(clean)) {
      return res.status(400).json({ error: "Kod noto'g'ri (2-32 belgi, harf/raqam/_/-)" });
    }
    if (type !== 'percent' && type !== 'fixed') return res.status(400).json({ error: "Turi noto'g'ri" });
    if (typeof value !== 'number' || value <= 0 || (type === 'percent' && value > 100)) {
      return res.status(400).json({ error: "Qiymat noto'g'ri" });
    }
    const existing = await PromoCode.findOne({ code: clean });
    if (existing) return res.status(409).json({ error: 'Bu kod allaqachon mavjud' });
    const promo = await PromoCode.create({
      code: clean,
      type,
      value,
      maxUses: typeof maxUses === 'number' && maxUses > 0 ? maxUses : undefined,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      applicablePlans: Array.isArray(applicablePlans) ? applicablePlans.filter((p: any) => typeof p === 'string') : [],
      active: true,
    });
    res.status(201).json({ ok: true, id: promo._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const promo = await PromoCode.findById(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Topilmadi' });
    const { type, value, active, maxUses, expiresAt, applicablePlans } = req.body || {};
    if (type !== undefined) {
      if (type !== 'percent' && type !== 'fixed') return res.status(400).json({ error: "Turi noto'g'ri" });
      promo.type = type;
    }
    if (value !== undefined) {
      if (typeof value !== 'number' || value <= 0) return res.status(400).json({ error: "Qiymat noto'g'ri" });
      promo.value = value;
    }
    if (active !== undefined) promo.active = !!active;
    if (maxUses !== undefined) promo.maxUses = typeof maxUses === 'number' && maxUses > 0 ? maxUses : undefined;
    if (expiresAt !== undefined) promo.expiresAt = expiresAt ? new Date(expiresAt) : undefined;
    if (applicablePlans !== undefined) {
      promo.applicablePlans = Array.isArray(applicablePlans) ? applicablePlans.filter((p: any) => typeof p === 'string') : [];
    }
    await promo.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await PromoCode.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
