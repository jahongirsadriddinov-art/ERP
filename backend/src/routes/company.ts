import { Router } from 'express';
import Company from '../models/Company';
import { getTenant } from '../middleware/tenantContext';
import { requireAuth, requireOwnerOrAdmin } from '../middleware/auth';
import { emitToCompany } from '../services/socket';

// Firmaning O'ZIGA tegishli brend (nom/logo) — companies.ts'dan FARQLI:
// bu yerda dasturchi emas, o'sha firmaning O'ZI (direktor/orinbosar) faqat
// O'Z firmasini o'zgartiradi (requireOwnerOrAdmin + getTenant().companyId
// bilan qattiq cheklangan — companies.ts'dagi kabi istalgan firmani :id
// bo'yicha emas).
const router = Router();

// GET /api/company/me — joriy foydalanuvchining firma brendi (hammaga, firma
// ichida — oddiy xodim ham o'z firmasi nomini/logotipini ko'rishi kerak).
router.get('/me', requireAuth, async (_req, res) => {
  const t = getTenant();
  if (!t?.companyId) return res.json({ available: false });
  try {
    const company = await Company.findById(t.companyId).select('name logoUrl branchId').lean();
    if (!company) return res.json({ available: false });
    res.json({ available: true, name: company.name, logoUrl: company.logoUrl || '', branchId: company.branchId });
  } catch (err) {
    console.error('[company/me GET]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// PATCH /api/company/me — nom/logo o'zgartirish. MUHIM: avval bu FAQAT
// mahalliy (localStorage) qiymat sifatida saqlanardi — o'zgartirgan
// odamning O'Z brauzeridan boshqa hech kimga (hatto o'sha shaxsning boshqa
// qurilmasiga ham) ko'rinmasdi. Endi haqiqatan bazaga yoziladi va SHU
// FIRMADAGI barcha ulangan foydalanuvchilarga real-vaqtda socket orqali
// yetkaziladi (emitToCompany — company:update).
router.patch('/me', requireAuth, requireOwnerOrAdmin, async (req, res) => {
  const t = getTenant();
  if (!t?.companyId) return res.status(400).json({ error: 'Firma konteksti topilmadi' });

  const { name, logoUrl } = req.body || {};
  const update: any = {};
  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      return res.status(400).json({ error: 'Firma nomi 2-100 belgi orasida bo\'lishi kerak' });
    }
    update.name = trimmed;
  }
  if (typeof logoUrl === 'string') update.logoUrl = logoUrl;
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Hech narsa o\'zgartirilmadi' });

  try {
    const company = await Company.findByIdAndUpdate(t.companyId, update, { new: true }).select('name logoUrl branchId').lean();
    if (!company) return res.status(404).json({ error: 'Firma topilmadi' });
    emitToCompany(t.companyId, 'company:update', { name: company.name, logoUrl: company.logoUrl || '', branchId: company.branchId });
    res.json({ ok: true, name: company.name, logoUrl: company.logoUrl || '', branchId: company.branchId });
  } catch (err) {
    console.error('[company/me PATCH]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
