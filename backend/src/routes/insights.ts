import { Router } from 'express';
import CompanyDocument from '../models/CompanyDocument';
import Equipment from '../models/Equipment';
import { getTenant } from '../middleware/tenantContext';
import { companyPriceTrends, docStage, theftChecks } from '../services/insights';

// GET /api/insights/summary — rahbar uchun "Nazorat" paneli (owner 2026-10-19): material o'g'irligi belgilari,
// narx o'zgarishlari, tugayotgan hujjatlar, servis kerak bo'lgan texnika. Ogohlantirishlar o'zi ham keladi
// (services/insights.ts) — bu yerda istalgan payt ko'rish uchun.
const router = Router();

router.get('/summary', async (_req, res) => {
  try {
    const t = getTenant();
    const companyId = String(t?.companyId || '');
    if (!companyId) return res.status(400).json({ error: 'Firma topilmadi' });
    const now = new Date();
    const [theft, prices, docs, eq] = await Promise.all([
      theftChecks(companyId, now).catch(() => []),
      companyPriceTrends(companyId, now).catch(() => []),
      CompanyDocument.find({ companyId, expiresAt: { $ne: null, $lte: new Date(now.getTime() + 31 * 86_400_000) } })
        .select('title category expiresAt').sort({ expiresAt: 1 }).limit(30).lean(),
      Equipment.find({ companyId }).select('name nextServiceDate serviceIntervalHours lastServiceEngineHours engineHours lastSeenAt status').lean(),
    ]);
    const docsOut = (docs as any[]).map((d) => ({ id: String(d._id), title: d.title, category: d.category, expiresAt: d.expiresAt, ...docStage(new Date(d.expiresAt), now) }));
    const equipmentOut = (eq as any[]).map((e) => {
      const byDate = e.nextServiceDate ? Math.ceil((new Date(e.nextServiceDate).getTime() - now.getTime()) / 86_400_000) : null;
      const hoursLeft = e.serviceIntervalHours && e.engineHours !== undefined ? e.serviceIntervalHours - (e.engineHours - (e.lastServiceEngineHours || 0)) : null;
      return { id: String(e._id), name: e.name, status: e.status, nextServiceDate: e.nextServiceDate || null, daysToService: byDate, hoursToService: hoursLeft, lastSeenAt: e.lastSeenAt || null };
    }).filter((e) => (e.daysToService !== null && e.daysToService <= 14) || (e.hoursToService !== null && e.hoursToService <= 50));
    res.json({ theft, prices: prices.slice(0, 20), docs: docsOut, equipment: equipmentOut });
  } catch (err) {
    console.error('[insights/summary]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
