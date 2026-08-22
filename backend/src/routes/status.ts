import { Router } from 'express';
import AppSettings from '../models/AppSettings';

const router = Router();

// GET /api/status — HAMMAGA OCHIQ (auth shart emas — login ekrani hali
// ko'rsatilmasdan OLDIN ham tekshirilishi kerak). Sayt/bot hozir yoqilgan-
// o'chirilganini qaytaradi — frontend ilova ochilishidan OLDIN shuni
// so'raydi, "siteEnabled:false" bo'lsa texnik ishlar ekranini ko'rsatadi.
router.get('/', async (_req, res) => {
  try {
    const settings = await AppSettings.findOne({ key: 'global' }).lean();
    res.json({
      siteEnabled: settings?.siteEnabled !== false,
      botEnabled: settings?.botEnabled !== false,
    });
  } catch (err) {
    console.error('[status]', err);
    // Xatolik holatida ham sayt ISHLASHDA DAVOM ETSIN — status tekshiruvi
    // o'zi hech qachon saytni "yolg'on" o'chirib qo'ymasligi kerak.
    res.json({ siteEnabled: true, botEnabled: true });
  }
});

export default router;
