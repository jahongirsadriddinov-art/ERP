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

export default router;
