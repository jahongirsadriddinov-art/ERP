import { Router } from 'express';
import DailyReport from '../models/DailyReport';
import ObjectModel from '../models/Object';
import User from '../models/User';
import { scoped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { todayInTashkent } from '../utils/tz';
import { normalizeReport, parseReportText, saveReport } from '../services/dailyReport';

// Kunlik hisobotlar (owner 2026-10-19) — ilovadan: matn (yoki ovoz yozuvi matni) → AI → ko'rib chiqish → saqlash.
// Ko'rish: rahbar — hammasi; prorab/brigadir — o'z obyektlari; ishchi — o'zi yozganlari.
const router = Router();
const BOSS = ['direktor', 'orinbosar'];

router.get('/', async (req, res) => {
  try {
    const t = getTenant();
    const q = req.query as Record<string, string>;
    const filter: any = {};
    if (/^[a-f0-9]{24}$/i.test(q.objectId || '')) filter.objectId = q.objectId;
    if (!BOSS.includes(String(t?.role)) && !t?.isOwner) {
      if (['prorab', 'brigadir'].includes(String(t?.role))) {
        const me: any = await User.findById(t?.userId).select('projectIds').lean();
        const own = (await ObjectModel.find(scoped({ foremanId: String(t?.userId) })).select('_id').lean()).map((o: any) => String(o._id));
        filter.$or = [{ userId: String(t?.userId) }, { objectId: { $in: [...own, ...(me?.projectIds || []).map(String)] } }];
      } else filter.userId = String(t?.userId);
    }
    const items = await DailyReport.find(scoped(filter)).sort({ date: -1, createdAt: -1 }).limit(60).lean();
    res.json(items.map((x: any) => ({ ...x, id: x._id })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.post('/parse', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (text.length < 5) return res.status(400).json({ error: 'Hisobot matni juda qisqa' });
    const objs: any[] = await ObjectModel.find(scoped({ status: { $ne: 'completed' } }) as any).select('name').limit(60).lean();
    const parsed = await parseReportText(text, objs.map((o) => String(o.name || ''))).catch(() => null);
    if (!parsed) return res.status(422).json({ error: "AI hisobotni tushunmadi — aniqroq yozing" });
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.post('/', async (req, res) => {
  try {
    const t = getTenant();
    const report = normalizeReport(req.body?.report);
    if (!report) return res.status(400).json({ error: "Hisobot bo'sh" });
    let objectId: string | undefined;
    let objectName: string | undefined;
    if (/^[a-f0-9]{24}$/i.test(String(req.body?.objectId || ''))) {
      const o: any = await ObjectModel.findOne(scoped({ _id: req.body.objectId })).select('name').lean();
      if (!o) return res.status(404).json({ error: 'Obyekt topilmadi' });
      objectId = String(o._id); objectName = String(o.name);
    }
    const me: any = await User.findById(t?.userId).select('firstName lastName').lean();
    const doc = await saveReport({
      companyId: String(t?.companyId), userId: String(t?.userId), userName: `${me?.firstName || ''} ${me?.lastName || ''}`.trim() || '—',
      date: todayInTashkent(), objectId, objectName, source: 'app', report,
    });
    res.status(201).json({ ...doc.toObject(), id: doc._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
