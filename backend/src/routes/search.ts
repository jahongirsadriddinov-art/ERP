import { Router } from 'express';
import User from '../models/User';
import ObjectModel from '../models/Object';
import Material from '../models/Material';
import Transaction from '../models/Transaction';
import Message from '../models/Message';
import { getTenant } from '../middleware/tenantContext';
import { scoped } from '../middleware/scope';

const router = Router();

// GET /api/search?q=...&types=users,objects,materials,transactions,messages
// Permission-aware: results filtered by company scope and user role
router.get('/', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const q = (req.query.q as string || '').trim();
    if (!q || q.length < 2) return res.json({ results: [], query: q });

    const types = ((req.query.types as string) || 'users,objects,materials,transactions,messages').split(',');
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const actor = await User.findById(tenant.userId).lean();
    if (!actor) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    const results: Record<string, any[]> = {};

    const searches: Promise<void>[] = [];

    if (types.includes('users')) {
      searches.push((async () => {
        const filter: any = { $or: [{ firstName: regex }, { lastName: regex }, { phone: regex }] };
        // non-admin sees only company users
        if (actor.role !== 'dasturchi') {
          filter.companyId = actor.companyId;
        }
        const users = await User.find(filter).select('firstName lastName phone role companyId').limit(10).lean();
        results.users = users.map(u => ({
          id: u._id,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
          phone: u.phone,
          role: u.role,
          _type: 'user',
        }));
      })());
    }

    if (types.includes('objects')) {
      searches.push((async () => {
        const filter = { ...scoped(), $or: [{ name: regex }, { location: regex }] };
        const objects = await ObjectModel.find(filter).select('name location status').limit(10).lean();
        results.objects = objects.map(o => ({ id: o._id, name: o.name, location: o.location, status: o.status, _type: 'object' }));
      })());
    }

    if (types.includes('materials')) {
      searches.push((async () => {
        const filter = { ...scoped(), name: regex };
        const mats = await Material.find(filter).select('name unit needed remaining objectId').limit(10).lean();
        results.materials = mats.map(m => ({ id: m._id, name: m.name, unit: m.unit, needed: m.needed, remaining: m.remaining, objectId: m.objectId, _type: 'material' }));
      })());
    }

    if (types.includes('transactions')) {
      searches.push((async () => {
        // Only admin can search all transactions; others see own
        const filter: any = { ...scoped() };
        if (!['direktor', 'orinbosar', 'dasturchi'].includes(actor.role)) {
          filter.$or = [{ createdById: String(actor._id) }, { fromUserId: String(actor._id) }, { toUserId: String(actor._id) }];
        }
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: [{ description: regex }, { materialName: regex }] });
        const txs = await Transaction.find(filter).select('type description materialName amount status date').limit(10).lean();
        results.transactions = txs.map(t => ({ id: t._id, type: t.type, description: t.description, materialName: t.materialName, amount: t.amount, status: t.status, date: t.date, _type: 'transaction' }));
      })());
    }

    if (types.includes('messages')) {
      searches.push((async () => {
        const userId = String(actor._id);
        // Users can only search their own messages
        const filter: any = {
          text: regex,
          deleted: { $ne: true },
          $or: [{ fromUserId: userId }, { toUserId: userId }],
        };
        if (actor.role !== 'dasturchi') {
          // also include group messages for user's groups
          filter.$or.push({ groupId: { $exists: true } });
        }
        const msgs = await Message.find(filter).select('text fromUserId toUserId groupId timestamp type').limit(10).lean();
        results.messages = msgs.map(m => ({ id: m._id, text: m.text, fromUserId: m.fromUserId, toUserId: m.toUserId, groupId: m.groupId, timestamp: m.timestamp, _type: 'message' }));
      })());
    }

    await Promise.allSettled(searches);

    res.json({ results, query: q });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
