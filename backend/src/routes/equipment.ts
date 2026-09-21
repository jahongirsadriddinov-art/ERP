import { Router } from 'express';
import Equipment from '../models/Equipment';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { requireOwnerOrAdmin } from '../middleware/auth';
import { logAudit } from '../services/audit';

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
    res.status(201).json({ ...eq.toObject(), id: eq._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.patch('/:id', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { name, type, serialNumber, status, assignedToUserId, objectId, purchaseDate, notes } = req.body || {};
    const eq = await Equipment.findOne(scoped({ _id: req.params.id }));
    if (!eq) return res.status(404).json({ error: 'Topilmadi' });
    if (name !== undefined) eq.name = String(name).trim();
    if (type !== undefined) eq.type = type;
    if (serialNumber !== undefined) eq.serialNumber = serialNumber;
    if (status !== undefined && ['available', 'in_use', 'maintenance', 'broken'].includes(status)) eq.status = status;
    if (assignedToUserId !== undefined) eq.assignedToUserId = assignedToUserId || undefined;
    if (objectId !== undefined) eq.objectId = objectId || undefined;
    if (purchaseDate !== undefined) eq.purchaseDate = purchaseDate;
    if (notes !== undefined) eq.notes = notes;
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

router.delete('/:id', requireOwnerOrAdmin, async (req, res) => {
  try {
    const eq = await Equipment.findOneAndDelete(scoped({ _id: req.params.id }));
    if (!eq) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
