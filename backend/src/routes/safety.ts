import { Router } from 'express';
import SafetyIncident from '../models/SafetyIncident';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { logAudit } from '../services/audit';
import { sendPushToUser } from '../services/push';

const router = Router();

// Xavfsizlik hodisasi hisoboti — ProjectMedia bilan bir xil tamoyil:
// BARCHA xodim (nafaqat admin) darhol qayd eta olishi kerak, chunki
// hodisani birinchi ko'radigan aynan dala xodimi bo'ladi.
router.get('/', async (req, res) => {
  try {
    const list = await SafetyIncident.find(scoped()).sort({ createdAt: -1 }).limit(500).lean();
    res.json(list.map(i => ({ ...i, id: i._id })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.post('/', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { objectId, title, description, severity, photos, occurredAt } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Sarlavha kerak' });

    const actor = await User.findById(t.userId).lean().catch(() => null);
    if (!actor) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    const incident = await SafetyIncident.create(stamped({
      objectId: objectId || undefined,
      reportedBy: { userId: t.userId, name: `${actor.firstName} ${actor.lastName || ''}`.trim(), role: actor.role },
      title: String(title).trim(),
      description: description ? String(description).slice(0, 2000) : undefined,
      severity: ['low', 'medium', 'high', 'critical'].includes(severity) ? severity : 'medium',
      photos: Array.isArray(photos) ? photos.slice(0, 10) : [],
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
    }));

    // Jiddiy/kritik hodisa haqida rahbariyat DARHOL bilishi kerak.
    if (['high', 'critical'].includes(incident.severity)) {
      const bosses = await User.find(scoped({ role: { $in: ['direktor', 'orinbosar'] } }) as any).select('_id').lean();
      for (const b of bosses) {
        sendPushToUser(String(b._id), {
          title: incident.severity === 'critical' ? '🚨 Jiddiy xavfsizlik hodisasi!' : '⚠️ Xavfsizlik hodisasi',
          body: incident.title,
          tag: 'safety',
        }).catch(() => {});
      }
    }

    await logAudit({
      userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
      action: 'create', entity: 'safety_incident', entityId: String(incident._id),
      description: `Xavfsizlik hodisasi qayd etildi: "${incident.title}" (${incident.severity})`,
      companyId: t.companyId, req,
    });

    res.status(201).json({ ...incident.toObject(), id: incident._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Status o'zgartirish — faqat direktor/o'rinbosar.
router.patch('/:id/status', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const actor = await User.findById(t.userId).lean().catch(() => null);
    if (!actor || !['direktor', 'orinbosar'].includes(actor.role)) {
      return res.status(403).json({ error: 'Faqat direktor yoki orinbosar holatni o\'zgartira oladi' });
    }
    const { status } = req.body || {};
    if (!['open', 'investigating', 'resolved'].includes(status)) return res.status(400).json({ error: "Noto'g'ri holat" });
    const incident = await SafetyIncident.findOne(scoped({ _id: req.params.id }));
    if (!incident) return res.status(404).json({ error: 'Topilmadi' });
    incident.status = status;
    if (status === 'resolved') {
      incident.resolvedAt = new Date();
      incident.resolvedBy = { userId: t.userId, name: `${actor.firstName} ${actor.lastName || ''}`.trim() };
    }
    await incident.save();
    res.json({ ...incident.toObject(), id: incident._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Hodisa matnini tuzatish / o'chirish (owner 2026-10-22): o'zi qayd etganini — o'zi, hammasini — direktor/o'rinbosar.
// Hal qilingan (resolved) hodisani faqat rahbar o'zgartiradi/o'chiradi — tekshiruv izi saqlansin.
async function incidentAccess(req: any, res: any): Promise<{ incident: any; actor: any } | null> {
  const t = getTenant();
  if (!t?.userId) { res.status(401).json({ error: 'Autentifikatsiya talab etiladi' }); return null; }
  const incident: any = await SafetyIncident.findOne(scoped({ _id: req.params.id })).catch(() => null);
  if (!incident) { res.status(404).json({ error: 'Topilmadi' }); return null; }
  const actor: any = await User.findById(t.userId).lean().catch(() => null);
  const isBoss = !!actor && (!!actor.isOwner || ['direktor', 'orinbosar'].includes(actor.role));
  const isReporter = String(incident.reportedBy?.userId) === String(t.userId);
  if (!isBoss && !isReporter) { res.status(403).json({ error: "Faqat hodisani qayd etgan xodim yoki direktor/o'rinbosar o'zgartira oladi" }); return null; }
  if (!isBoss && incident.status === 'resolved') { res.status(409).json({ error: "Hal qilingan hodisani faqat direktor yoki o'rinbosar o'zgartira oladi" }); return null; }
  return { incident, actor };
}

router.patch('/:id', async (req, res) => {
  try {
    const r = await incidentAccess(req, res);
    if (!r) return;
    const { incident, actor } = r;
    const { title, description, severity, objectId, photos, occurredAt } = req.body || {};
    const set: Record<string, unknown> = {};
    if (title !== undefined) { const tt = String(title || '').trim().slice(0, 300); if (!tt) return res.status(400).json({ error: 'Sarlavha kerak' }); set.title = tt; }
    if (description !== undefined) set.description = description ? String(description).slice(0, 2000) : undefined;
    if (severity !== undefined) { if (!['low', 'medium', 'high', 'critical'].includes(severity)) return res.status(400).json({ error: "Noto'g'ri daraja" }); set.severity = severity; }
    if (objectId !== undefined) set.objectId = objectId ? String(objectId) : undefined;
    if (photos !== undefined) set.photos = Array.isArray(photos) ? photos.slice(0, 10).map(String) : [];
    if (occurredAt !== undefined) { const d = new Date(occurredAt); if (isNaN(+d)) return res.status(400).json({ error: "Sana noto'g'ri" }); set.occurredAt = d; }
    if (!Object.keys(set).length) return res.status(400).json({ error: "O'zgartirish yo'q" });
    const before = Object.fromEntries(Object.keys(set).map((k) => [k, incident[k]]));
    incident.set(set);
    await incident.save();
    const t = getTenant()!;
    if (actor) {
      logAudit({
        userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
        action: 'update', entity: 'safety_incident', entityId: String(incident._id),
        description: `Xavfsizlik hodisasi o'zgartirildi: "${incident.title}"`, oldValue: before, newValue: set, companyId: t.companyId, req,
      }).catch(() => {});
    }
    res.json({ ...incident.toObject(), id: incident._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await incidentAccess(req, res);
    if (!r) return;
    const { incident, actor } = r;
    const snapshot = incident.toObject();
    await incident.deleteOne();
    const t = getTenant()!;
    if (actor) {
      logAudit({
        userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
        action: 'delete', entity: 'safety_incident', entityId: String(req.params.id),
        description: `Xavfsizlik hodisasi o'chirildi: "${snapshot.title}"`, oldValue: snapshot, companyId: t.companyId, req,
      }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
