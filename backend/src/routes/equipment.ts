import { Router } from 'express';
import Equipment from '../models/Equipment';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { requireOwnerOrAdmin } from '../middleware/auth';
import { logAudit } from '../services/audit';
import EquipmentLog from '../models/EquipmentLog';
import { todayInTashkent } from '../utils/tz';
import { getBackendUrl } from '../utils/backendUrl';
import { randomBytes } from 'crypto';

const router = Router();

// Jihoz/texnika ro'yxati — BARCHA xodim ko'rishi mumkin (masalan "bu
// asbob qayerda" savoliga javob topish uchun), faqat admin qo'sha/
// o'zgartira/o'chira oladi (objects.ts'dagi bir xil naqsh).
router.get('/', async (req, res) => {
  try {
    const list = await Equipment.find(scoped()).sort({ createdAt: -1 }).lean();
    res.json(list.map(e => ({ ...e, id: e._id })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.post('/', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { name, type, serialNumber, status, assignedToUserId, objectId, purchaseDate, notes } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nomi kerak' });
    const eq = await Equipment.create(stamped({
      name: String(name).trim(), type, serialNumber, objectId,
      status: ['available', 'in_use', 'maintenance', 'broken'].includes(status) ? status : 'available',
      assignedToUserId: assignedToUserId || undefined, purchaseDate, notes,
    }));
    const t = getTenant();
    const actor = t?.userId ? await User.findById(t.userId).lean().catch(() => null) : null;
    if (actor) {
      logAudit({
        userId: t!.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
        action: 'create', entity: 'equipment', entityId: String(eq._id),
        description: `Jihoz qo'shildi: "${eq.name}"`, companyId: t!.companyId, req,
      }).catch(() => {});
    }
    res.status(201).json({ ...eq.toObject(), id: eq._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.patch('/:id', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { name, type, serialNumber, status, assignedToUserId, objectId, purchaseDate, notes } = req.body || {};
    const eq: any = await Equipment.findOne(scoped({ _id: req.params.id }));
    if (!eq) return res.status(404).json({ error: 'Topilmadi' });
    if (name !== undefined) eq.name = String(name).trim();
    if (type !== undefined) eq.type = type;
    if (serialNumber !== undefined) eq.serialNumber = serialNumber;
    if (status !== undefined && ['available', 'in_use', 'maintenance', 'broken'].includes(status)) eq.status = status;
    if (assignedToUserId !== undefined) eq.assignedToUserId = assignedToUserId || undefined;
    if (objectId !== undefined) eq.objectId = objectId || undefined;
    if (purchaseDate !== undefined) eq.purchaseDate = purchaseDate;
    if (notes !== undefined) eq.notes = notes;
    // Texnika nazorati (owner 2026-10-19): servis sanasi/oralig'i, motor-soat, yoqilg'i me'yori
    const b = req.body || {};
    const numOrNull = (v: unknown) => (v === null || v === '' ? undefined : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : NaN);
    for (const k of ['serviceIntervalHours', 'lastServiceEngineHours', 'engineHours', 'fuelNormPerHour']) {
      if (b[k] === undefined) continue;
      const v = numOrNull(b[k]);
      if (Number.isNaN(v)) return res.status(400).json({ error: `${k} noto'g'ri` });
      eq[k] = v;
    }
    if (b.nextServiceDate !== undefined) eq.nextServiceDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.nextServiceDate)) ? String(b.nextServiceDate) : undefined;
    await eq.save();

    const t = getTenant();
    if (t?.userId) {
      const actor = await User.findById(t.userId).lean().catch(() => null);
      if (actor) {
        logAudit({
          userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
          action: 'update', entity: 'equipment', entityId: String(eq._id),
          description: `Jihoz tahrirlandi: "${eq.name}"`, companyId: t.companyId, req,
        }).catch(() => {});
      }
    }

    res.json({ ...eq.toObject(), id: eq._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ── Texnika jurnali: ishlagan soat, yoqilg'i (prorab/rahbar qo'lda) ──
router.get('/:id/logs', async (req, res) => {
  try {
    const eq = await Equipment.findOne(scoped({ _id: req.params.id })).select('_id').lean();
    if (!eq) return res.status(404).json({ error: 'Topilmadi' });
    const logs = await EquipmentLog.find({ equipmentId: String(req.params.id) }).sort({ date: -1, createdAt: -1 }).limit(120).lean();
    res.json(logs.map((l: any) => ({ ...l, id: l._id })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});
router.post('/:id/logs', async (req, res) => {
  try {
    const t = getTenant();
    if (!['direktor', 'orinbosar', 'prorab', 'brigadir'].includes(String(t?.role)) && !t?.isOwner) return res.status(403).json({ error: "Ruxsat yo'q" });
    const eq: any = await Equipment.findOne(scoped({ _id: req.params.id }));
    if (!eq) return res.status(404).json({ error: 'Topilmadi' });
    const b = req.body || {};
    const n = (v: unknown, max: number) => (v === undefined || v === null || v === '' ? undefined : Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : NaN);
    const hours = n(b.hours, 24), fuel = n(b.fuel, 5000), engineHours = n(b.engineHours, 1e7);
    if ([hours, fuel, engineHours].some((x) => Number.isNaN(x))) return res.status(400).json({ error: "Qiymatlar noto'g'ri" });
    if (hours === undefined && fuel === undefined && engineHours === undefined) return res.status(400).json({ error: "Soat, yoqilg'i yoki motor-soat kiriting" });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : todayInTashkent();
    const log = await EquipmentLog.create(stamped({
      equipmentId: String(eq._id), objectId: eq.objectId, date, hours, fuel, engineHours, source: 'manual',
      note: b.note ? String(b.note).slice(0, 300) : undefined, createdBy: String(t?.userId || ''),
    }));
    if (engineHours !== undefined && engineHours > (eq.engineHours || 0)) { eq.engineHours = engineHours; await eq.save(); }
    res.status(201).json({ ...log.toObject(), id: log._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});
// Jurnal yozuvini tuzatish/o'chirish (owner 2026-10-22): o'zi kiritganini — o'zi, hammasini — direktor/o'rinbosar.
// Treker (avtomatik) yozuvlarini faqat rahbar o'chiradi.
async function logAccess(req: any, res: any): Promise<any | null> {
  const t = getTenant();
  if (!t?.userId) { res.status(401).json({ error: 'Autentifikatsiya talab etiladi' }); return null; }
  const eq = await Equipment.findOne(scoped({ _id: req.params.id })).select('_id').lean().catch(() => null);
  if (!eq) { res.status(404).json({ error: 'Topilmadi' }); return null; }
  const log: any = await EquipmentLog.findOne(scoped({ _id: req.params.logId, equipmentId: String(req.params.id) })).catch(() => null);
  if (!log) { res.status(404).json({ error: 'Topilmadi' }); return null; }
  const isBoss = !!t.isOwner || ['direktor', 'orinbosar'].includes(String(t.role));
  if (!isBoss && String(log.createdBy || '') !== String(t.userId)) { res.status(403).json({ error: "Faqat yozuvni kiritgan xodim yoki admin o'zgartira oladi" }); return null; }
  return log;
}
async function auditLog(req: any, action: 'update' | 'delete', log: any, extra: Record<string, unknown> = {}) {
  const t = getTenant();
  const actor = t?.userId ? await User.findById(t.userId).lean().catch(() => null) : null;
  if (!actor) return;
  logAudit({
    userId: t!.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
    action, entity: 'equipment_log', entityId: String(log._id),
    description: `Texnika jurnali ${action === 'delete' ? "o'chirildi" : "o'zgartirildi"}: ${log.date}`, companyId: t!.companyId, req, ...extra,
  }).catch(() => {});
}
router.patch('/:id/logs/:logId', async (req, res) => {
  try {
    const log = await logAccess(req, res);
    if (!log) return;
    const b = req.body || {};
    const n = (v: unknown, max: number) => (v === null || v === '' ? undefined : Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : NaN);
    const set: Record<string, unknown> = {};
    for (const [k, max] of [['hours', 24], ['fuel', 5000], ['engineHours', 1e7]] as const) {
      if (b[k] === undefined) continue;
      const v = n(b[k], max);
      if (Number.isNaN(v)) return res.status(400).json({ error: "Qiymatlar noto'g'ri" });
      set[k] = v;
    }
    if (b.date !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) return res.status(400).json({ error: "Sana noto'g'ri" }); set.date = String(b.date); }
    if (b.note !== undefined) set.note = b.note ? String(b.note).slice(0, 300) : undefined;
    if (!Object.keys(set).length) return res.status(400).json({ error: "O'zgartirish yo'q" });
    const before = Object.fromEntries(Object.keys(set).map((k) => [k, log[k]]));
    log.set(set);
    await log.save();
    await auditLog(req, 'update', log, { oldValue: before, newValue: set });
    res.json({ ...log.toObject(), id: log._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});
router.delete('/:id/logs/:logId', async (req, res) => {
  try {
    const log = await logAccess(req, res);
    if (!log) return;
    const snapshot = log.toObject();
    await log.deleteOne();
    await auditLog(req, 'delete', log, { oldValue: snapshot });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GPS-treker tokeni (rahbar) — trekerga /api/public/telemetry/<token> manzili yoziladi
router.post('/:id/tracker-token', requireOwnerOrAdmin, async (req, res) => {
  try {
    const eq: any = await Equipment.findOne(scoped({ _id: req.params.id }));
    if (!eq) return res.status(404).json({ error: 'Topilmadi' });
    eq.trackerToken = randomBytes(18).toString('hex');
    await eq.save();
    res.json({ token: eq.trackerToken, url: `${getBackendUrl()}/api/public/telemetry/${eq.trackerToken}` });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.delete('/:id', requireOwnerOrAdmin, async (req, res) => {
  try {
    const eq = await Equipment.findOneAndDelete(scoped({ _id: req.params.id }));
    if (!eq) return res.status(404).json({ error: 'Topilmadi' });
    const t = getTenant();
    const actor = t?.userId ? await User.findById(t.userId).lean().catch(() => null) : null;
    if (actor) {
      logAudit({
        userId: t!.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
        action: 'delete', entity: 'equipment', entityId: String(eq._id),
        description: `Jihoz o'chirildi: "${eq.name}"`, oldValue: eq.toObject(), companyId: t!.companyId, req,
      }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
