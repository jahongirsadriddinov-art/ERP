import { Router } from 'express';
import Plan from '../models/Plan';
import Subscription from '../models/Subscription';
import { requireAuth, requireDeveloper } from '../middleware/auth';
import { reloadPlanCache, FEATURE_REGISTRY, ALL_FEATURE_KEYS } from '../config/plans';

const router = Router();

// GET /api/plans — HAMMA (ro'yxatdan o'tish/tarif ko'rsatish uchun) faqat
// FAOL tariflarni ko'radi. optionalAuth bilan ulanadi (index.ts), lekin bu
// yerda auth talab qilinmaydi — ro'yxatdan o'tish hali login qilmagan
// foydalanuvchiga narxlarni ko'rsatishi kerak.
router.get('/', async (req, res) => {
  try {
    const plans = await Plan.find({ active: true }).sort({ order: 1 }).lean();
    res.json(plans.map(p => ({ key: p.key, label: p.label, days: p.days, amount: p.amount, features: p.features || [], period: p.period, tier: p.tier })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/plans/features — funksiyalar ro'yxati (admin panelida checkbox
// yasash uchun) — bu ham himoyalanmagan, faqat statik ro'yxat, sir emas.
router.get('/features', (req, res) => {
  res.json(FEATURE_REGISTRY);
});

// Quyidagilar FAQAT dasturchi (super-admin) uchun.
router.use(requireAuth, requireDeveloper);

// GET /api/admin/plans — barcha tariflar (nofaollar ham) — admin panel jadvali uchun.
router.get('/admin', async (req, res) => {
  try {
    const plans = await Plan.find().sort({ order: 1 }).lean();
    res.json(plans.map(p => ({
      id: p._id, key: p.key, label: p.label, days: p.days, amount: p.amount,
      features: p.features || [], active: p.active !== false, order: p.order || 0,
      period: p.period, tier: p.tier,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST /api/admin/plans — yangi tarif yaratish.
router.post('/admin', async (req, res) => {
  try {
    const { key, label, days, amount, features, order, period, tier } = req.body || {};
    // "__proto__"/"constructor"/"prototype" — normal /[a-z0-9_-]+/ tekshiruvidan
    // o'tadi, lekin PLAN_CONFIG[key]=... (config/plans.ts, reloadPlanCache) shu
    // nom bilan yozilganda oddiy xususiyat o'rniga OBYEKTNING PROTOTIPINI
    // o'zgartirib qo'yardi (JS'ning o'ziga xos xatti-harakati) — butun tarif
    // keshini buzib qo'yishi mumkin edi.
    const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    if (!key || typeof key !== 'string' || !/^[a-z0-9_-]+$/i.test(key) || RESERVED_KEYS.has(key)) {
      return res.status(400).json({ error: "Tarif kaliti noto'g'ri (faqat harf/raqam/_/-)" });
    }
    if (!label || typeof days !== 'number' || days <= 0 || typeof amount !== 'number' || amount < 0) {
      return res.status(400).json({ error: "Yorliq, kunlar va narx to'g'ri kiritilishi kerak" });
    }
    const cleanFeatures = Array.isArray(features) ? features.filter((f: any) => ALL_FEATURE_KEYS.includes(f)) : [];
    const cleanPeriod = ['1month', '3month', '12month'].includes(period) ? period : undefined;
    const cleanTier = [1, 2, 3].includes(tier) ? tier : undefined;
    const existing = await Plan.findOne({ key });
    if (existing) return res.status(409).json({ error: "Shu kalitdagi tarif allaqachon mavjud" });
    const plan = await Plan.create({ key, label, days, amount, features: cleanFeatures, active: true, order: order ?? 0, period: cleanPeriod, tier: cleanTier });
    await reloadPlanCache();
    res.status(201).json({ ok: true, id: plan._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// PUT /api/admin/plans/:key — mavjud tarifni tahrirlash (narx/kun/yorliq/
// funksiyalar/faollik/tartib).
router.put('/admin/:key', async (req, res) => {
  try {
    const plan = await Plan.findOne({ key: req.params.key });
    if (!plan) return res.status(404).json({ error: 'Tarif topilmadi' });
    const { label, days, amount, features, active, order, period, tier } = req.body || {};
    if (label !== undefined) plan.label = label;
    if (days !== undefined) { if (typeof days !== 'number' || days <= 0) return res.status(400).json({ error: "Kunlar noto'g'ri" }); plan.days = days; }
    if (amount !== undefined) { if (typeof amount !== 'number' || amount < 0) return res.status(400).json({ error: "Narx noto'g'ri" }); plan.amount = amount; }
    if (features !== undefined) plan.features = Array.isArray(features) ? features.filter((f: any) => ALL_FEATURE_KEYS.includes(f)) : [];
    if (active !== undefined) plan.active = !!active;
    if (order !== undefined) plan.order = order;
    if (period !== undefined) plan.period = ['1month', '3month', '12month'].includes(period) ? period : undefined;
    if (tier !== undefined) plan.tier = [1, 2, 3].includes(tier) ? tier : undefined;
    await plan.save();
    await reloadPlanCache();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// DELETE /api/admin/plans/:key — faqat HECH QANDAY obuna shu kalitni
// ishlatmayotgan bo'lsa o'chirishga ruxsat beriladi (mavjud mijozlarning
// tarifi "yo'qolib" qolmasligi uchun) — aks holda shunchaki active:false
// qilinsin (PUT orqali) taklif qilinadi.
router.delete('/admin/:key', async (req, res) => {
  try {
    const inUse = await Subscription.countDocuments({ selectedPlan: req.params.key });
    if (inUse > 0) {
      return res.status(409).json({ error: `Bu tarifdan ${inUse} ta obuna foydalanmoqda — o'chirish o'rniga "faolsiz" qiling` });
    }
    const deleted = await Plan.findOneAndDelete({ key: req.params.key });
    if (!deleted) return res.status(404).json({ error: 'Tarif topilmadi' });
    await reloadPlanCache();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
