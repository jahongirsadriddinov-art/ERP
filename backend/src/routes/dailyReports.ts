import { Router } from 'express';
import DailyReport from '../models/DailyReport';
import ObjectModel from '../models/Object';
import User from '../models/User';
import { scoped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { todayInTashkent } from '../utils/tz';
import { normalizeReport, parseReportText, saveReport } from '../services/dailyReport';
import { logAudit } from '../services/audit';
import { allowedObjectIds, canAccessObject, OBJECT_FORBIDDEN } from '../middleware/objectScope';

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
      // Obyekt doirasi (owner 2026-10-23): biriktirilgan obyektlar (projectIds + foremanId)
      const allowed = (await allowedObjectIds()) || [];
      if (filter.objectId && !allowed.includes(String(filter.objectId))) return res.json([]);
      if (['prorab', 'brigadir'].includes(String(t?.role))) {
        filter.$or = [{ userId: String(t?.userId) }, { objectId: { $in: allowed } }];
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
    const allowed = await allowedObjectIds();
    const objs: any[] = await ObjectModel.find(scoped({ status: { $ne: 'completed' }, ...(allowed === null ? {} : { _id: { $in: allowed } }) }) as any).select('name').limit(60).lean();
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
      if (!(await canAccessObject(o._id))) return res.status(403).json(OBJECT_FORBIDDEN);
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

// Hisobotni tuzatish / o'chirish (owner 2026-10-22): yozgan xodim — o'zinikini, direktor/o'rinbosar — hammasini.
async function reportAccess(req: any, res: any): Promise<{ doc: any; actor: any } | null> {
  const t = getTenant();
  if (!t?.userId) { res.status(401).json({ error: 'Autentifikatsiya talab etiladi' }); return null; }
  const doc: any = await DailyReport.findOne(scoped({ _id: req.params.id })).catch(() => null);
  if (!doc) { res.status(404).json({ error: 'Topilmadi' }); return null; }
  if (!BOSS.includes(String(t.role)) && !t.isOwner && String(doc.userId) !== String(t.userId)) {
    res.status(403).json({ error: "Faqat hisobotni yozgan xodim yoki direktor/o'rinbosar o'zgartira oladi" }); return null;
  }
  const actor: any = await User.findById(t.userId).select('firstName lastName role').lean().catch(() => null);
  return { doc, actor };
}
const audit = (req: any, actor: any, action: 'update' | 'delete', doc: any, extra: Record<string, unknown> = {}) => {
  const t = getTenant();
  if (!actor || !t) return;
  logAudit({
    userId: String(t.userId), userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
    action, entity: 'daily_report', entityId: String(doc._id),
    description: `Kunlik hisobot ${action === 'delete' ? "o'chirildi" : "o'zgartirildi"}: ${doc.userName} (${doc.date})`, companyId: t.companyId, req, ...extra,
  }).catch(() => {});
};

router.patch('/:id', async (req, res) => {
  try {
    const r = await reportAccess(req, res);
    if (!r) return;
    const { doc, actor } = r;
    const set: Record<string, unknown> = {};
    if (req.body?.report !== undefined) {
      const report = normalizeReport(req.body.report);
      if (!report) return res.status(400).json({ error: "Hisobot bo'sh" });
      Object.assign(set, { summary: report.summary, workDone: report.workDone, materialsUsed: report.materialsUsed, workersCount: report.workersCount, issues: report.issues });
    }
    if (req.body?.objectId !== undefined) {
      if (!req.body.objectId) Object.assign(set, { objectId: undefined, objectName: undefined });
      else {
        const o: any = /^[a-f0-9]{24}$/i.test(String(req.body.objectId)) ? await ObjectModel.findOne(scoped({ _id: req.body.objectId })).select('name').lean() : null;
        if (!o) return res.status(404).json({ error: 'Obyekt topilmadi' });
        if (!(await canAccessObject(o._id))) return res.status(403).json(OBJECT_FORBIDDEN);
        Object.assign(set, { objectId: String(o._id), objectName: String(o.name) });
      }
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: "O'zgartirish yo'q" });
    const before = Object.fromEntries(Object.keys(set).map((k) => [k, doc[k]]));
    doc.set(set);
    await doc.save();
    audit(req, actor, 'update', doc, { oldValue: before, newValue: set });
    res.json({ ...doc.toObject(), id: doc._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await reportAccess(req, res);
    if (!r) return;
    const snapshot = r.doc.toObject();
    await r.doc.deleteOne();
    audit(req, r.actor, 'delete', r.doc, { oldValue: snapshot });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
