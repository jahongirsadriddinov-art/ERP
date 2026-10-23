import { Router } from 'express';
import WorkLog from '../models/WorkLog';
import User from '../models/User';
import Company from '../models/Company';
import ObjectModel from '../models/Object';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { todayInTashkent } from '../utils/tz';
import { createNotification } from '../services/notifications';
import { logAudit } from '../services/audit';
import { allowedObjectIds, canAccessObject, OBJECT_FORBIDDEN } from '../middleware/objectScope';

// Ishbay hisob (owner 2026-10-19, ixtiyoriy): bajarilgan hajm × narx. Firma features.piecework yoqmagan bo'lsa —
// yozish mumkin emas (o'qish ham bo'sh). Kiritadi: rahbar, prorab, brigadir; tasdiqlaydi: rahbar yoki o'sha
// obyektning prorabi. Ishchi faqat o'z yozuvlarini ko'radi.
const router = Router();

const BOSS = ['direktor', 'orinbosar'];
const MANAGERS = [...BOSS, 'prorab', 'brigadir'];

async function enabled(companyId?: string): Promise<boolean> {
  if (!companyId) return false;
  const c: any = await Company.findById(companyId).select('features').lean().catch(() => null);
  return c?.features?.piecework === true;
}
const isBoss = (t: any) => !!t?.isOwner || BOSS.includes(String(t?.role));

router.get('/', async (req, res) => {
  try {
    const t = getTenant();
    if (!(await enabled(t?.companyId))) return res.json({ enabled: false, items: [] });
    const q = req.query as Record<string, string>;
    const filter: any = {};
    if (/^\d{4}-\d{2}$/.test(q.period || '')) filter.date = { $regex: `^${q.period}` };
    if (/^[a-f0-9]{24}$/i.test(q.objectId || '')) filter.objectId = q.objectId;
    if (!MANAGERS.includes(String(t?.role)) && !t?.isOwner) filter.userId = String(t?.userId);
    else if (!isBoss(t)) {
      // Obyekt doirasi (owner 2026-10-23): prorab/brigadir — faqat biriktirilgan obyektlar yozuvlari
      const allowed = (await allowedObjectIds()) || [];
      if (filter.objectId && !allowed.includes(String(filter.objectId))) return res.json({ enabled: true, items: [] });
      if (!filter.objectId) filter.objectId = { $in: allowed };
    }
    const items = await WorkLog.find(scoped(filter)).sort({ date: -1, createdAt: -1 }).limit(500).lean();
    res.json({ enabled: true, items: items.map((x: any) => ({ ...x, id: x._id })) });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.post('/', async (req, res) => {
  try {
    const t = getTenant();
    if (!(await enabled(t?.companyId))) return res.status(403).json({ error: "Ishbay hisob firmada yoqilmagan" });
    if (!MANAGERS.includes(String(t?.role)) && !t?.isOwner) return res.status(403).json({ error: "Ruxsat yo'q" });
    const b = req.body || {};
    const volume = Number(b.volume), rate = Number(b.rate);
    if (!/^[a-f0-9]{24}$/i.test(String(b.objectId || '')) || !/^[a-f0-9]{24}$/i.test(String(b.userId || ''))) return res.status(400).json({ error: 'Obyekt va xodim tanlang' });
    const workName = String(b.workName || '').trim();
    const unit = String(b.unit || '').trim();
    if (workName.length < 2 || !unit) return res.status(400).json({ error: 'Ish nomi va birligi kerak' });
    if (!(volume > 0 && volume < 1e7) || !(rate >= 0 && rate < 1e10)) return res.status(400).json({ error: "Hajm yoki narx noto'g'ri" });
    const [obj, worker, actor] = await Promise.all([
      ObjectModel.findOne(scoped({ _id: b.objectId })).select('_id foremanId').lean(),
      User.findOne(scoped({ _id: b.userId })).select('firstName lastName').lean(),
      User.findById(t?.userId).select('firstName lastName role').lean(),
    ]);
    if (!obj || !worker || !actor) return res.status(404).json({ error: 'Obyekt yoki xodim topilmadi' });
    if (!(await canAccessObject(obj._id))) return res.status(403).json(OBJECT_FORBIDDEN);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : todayInTashkent();
    const name = (u: any) => `${u.firstName} ${u.lastName || ''}`.trim();
    const log = await WorkLog.create(stamped({
      objectId: String(b.objectId), userId: String(b.userId), userName: name(worker),
      workName: workName.slice(0, 200), unit: unit.slice(0, 20), volume, rate, amount: Math.round(volume * rate), date,
      // Rahbar o'zi kiritsa — darhol tasdiqlangan
      status: isBoss(t) ? 'approved' : 'pending',
      ...(isBoss(t) ? { decidedBy: { userId: String(t?.userId), name: name(actor), at: new Date() } } : {}),
      note: b.note ? String(b.note).slice(0, 300) : undefined,
      createdBy: { userId: String(t?.userId), name: name(actor), role: String((actor as any).role) },
    }));
    res.status(201).json({ ...log.toObject(), id: log._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.patch('/:id/:decision', async (req, res) => {
  try {
    if (req.params.decision !== 'approve' && req.params.decision !== 'reject') return res.status(404).json({ error: 'Topilmadi' });
    const t = getTenant();
    const log: any = await WorkLog.findOne(scoped({ _id: req.params.id }));
    if (!log) return res.status(404).json({ error: 'Topilmadi' });
    if (log.status !== 'pending') return res.status(409).json({ error: 'Allaqachon hal qilingan' });
    if (!(await canAccessObject(log.objectId))) return res.status(404).json({ error: 'Topilmadi' });
    const obj: any = await ObjectModel.findOne(scoped({ _id: log.objectId })).select('foremanId').lean();
    if (!isBoss(t) && String(obj?.foremanId || '') !== String(t?.userId)) return res.status(403).json({ error: "Faqat rahbar yoki obyekt prorabi tasdiqlaydi" });
    if (String(log.createdBy?.userId) === String(t?.userId) && !isBoss(t)) return res.status(403).json({ error: "O'zingiz kiritgan yozuvni o'zingiz tasdiqlay olmaysiz" });
    const actor: any = await User.findById(t?.userId).select('firstName lastName').lean();
    log.status = req.params.decision === 'approve' ? 'approved' : 'rejected';
    log.decidedBy = { userId: String(t?.userId), name: `${actor?.firstName || ''} ${actor?.lastName || ''}`.trim(), at: new Date() };
    await log.save();
    createNotification({
      recipientId: String(log.userId), companyId: String(log.companyId), type: 'approval_result',
      title: log.status === 'approved' ? 'Ishbay ish tasdiqlandi' : 'Ishbay ish rad etildi',
      body: `${log.workName}: ${log.volume} ${log.unit} × ${log.rate} = ${log.amount.toLocaleString('ru-RU')} so'm`,
    }).catch(() => undefined);
    res.json({ ...log.toObject(), id: log._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

async function auditWorkLog(req: any, action: 'update' | 'delete', log: any, extra: Record<string, unknown> = {}) {
  const t = getTenant();
  const actor: any = t?.userId ? await User.findById(t.userId).select('firstName lastName role').lean().catch(() => null) : null;
  if (!actor) return;
  logAudit({
    userId: String(t!.userId), userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
    action, entity: 'worklog', entityId: String(log._id),
    description: `Ishbay yozuvi ${action === 'delete' ? "o'chirildi" : "o'zgartirildi"}: ${log.userName} — ${log.workName}`, companyId: t!.companyId, req, ...extra,
  }).catch(() => {});
}

// PATCH /api/worklogs/:id — hajm/narx/ish nomi/sana/izohni tuzatish (owner 2026-10-22): kiritgan xodim — yozuv hali
// kutilayotgan (pending) bo'lsa; rahbar — har doim (tasdiqlangan oylikka ta'sir qiladi — faqat rahbar).
router.patch('/:id', async (req, res) => {
  try {
    const t = getTenant();
    const log: any = await WorkLog.findOne(scoped({ _id: req.params.id }));
    if (!log) return res.status(404).json({ error: 'Topilmadi' });
    const own = String(log.createdBy?.userId) === String(t?.userId);
    if (!isBoss(t) && !own) return res.status(403).json({ error: "Ruxsat yo'q" });
    if (!isBoss(t) && log.status !== 'pending') return res.status(409).json({ error: "Hal qilingan yozuvni faqat direktor yoki o'rinbosar o'zgartira oladi" });
    const b = req.body || {};
    const set: Record<string, unknown> = {};
    if (b.volume !== undefined) { const v = Number(b.volume); if (!(v > 0 && v < 1e7)) return res.status(400).json({ error: "Hajm noto'g'ri" }); set.volume = v; }
    if (b.rate !== undefined) { const r = Number(b.rate); if (!(r >= 0 && r < 1e10)) return res.status(400).json({ error: "Narx noto'g'ri" }); set.rate = r; }
    if (b.workName !== undefined) { const w = String(b.workName || '').trim(); if (w.length < 2) return res.status(400).json({ error: 'Ish nomi kerak' }); set.workName = w.slice(0, 200); }
    if (b.unit !== undefined) { const u = String(b.unit || '').trim(); if (!u) return res.status(400).json({ error: 'Birlik kerak' }); set.unit = u.slice(0, 20); }
    if (b.date !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) return res.status(400).json({ error: "Sana noto'g'ri" }); set.date = String(b.date); }
    if (b.note !== undefined) set.note = b.note ? String(b.note).slice(0, 300) : undefined;
    if (!Object.keys(set).length) return res.status(400).json({ error: "O'zgartirish yo'q" });
    const before = Object.fromEntries(Object.keys(set).map((k) => [k, log[k]]));
    log.set(set);
    log.amount = Math.round(Number(log.volume) * Number(log.rate));
    await log.save();
    await auditWorkLog(req, 'update', log, { oldValue: before, newValue: set });
    res.json({ ...log.toObject(), id: log._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const t = getTenant();
    const log: any = await WorkLog.findOne(scoped({ _id: req.params.id }));
    if (!log) return res.status(404).json({ error: 'Topilmadi' });
    const own = String(log.createdBy?.userId) === String(t?.userId);
    if (!isBoss(t) && !(own && log.status === 'pending')) return res.status(403).json({ error: "Ruxsat yo'q" });
    const snapshot = log.toObject();
    await log.deleteOne();
    await auditWorkLog(req, 'delete', log, { oldValue: snapshot });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

/** Oylik: tasdiqlangan ishbay summalari (userId → so'm). */
export async function pieceworkTotals(companyId: string, period: string): Promise<Map<string, number>> {
  const rows: any[] = await WorkLog.aggregate([
    { $match: { companyId, status: 'approved', date: { $regex: `^${period}` } } },
    { $group: { _id: '$userId', s: { $sum: '$amount' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), Number(r.s) || 0]));
}

export default router;
