import { Router } from 'express';
import Company from '../models/Company';
import User from '../models/User';
import ObjectModel from '../models/Object';
import Material from '../models/Material';
import Transaction from '../models/Transaction';
import Message from '../models/Message';
import Group from '../models/Group';
import Subscription from '../models/Subscription';
import { requireDeveloper } from '../middleware/auth';

const router = Router();

// Barcha company route'lari FAQAT dasturchi (super-admin) uchun.
router.use(requireDeveloper);

// Barcha firmalar ro'yxati (har biri uchun user soni + egasi)
router.get('/', async (_req, res) => {
  try {
    const companies = await Company.find().sort({ createdAt: -1 }).lean();
    const result = await Promise.all(companies.map(async (c) => {
      const cid = String(c._id);
      const userCount = await User.countDocuments({ companyId: cid });
      const objectCount = await ObjectModel.countDocuments({ companyId: cid });
      const owner = c.ownerUserId ? await User.findById(c.ownerUserId).select('firstName lastName phone').lean() : null;
      return {
        id: cid,
        branchId: c.branchId,
        name: c.name,
        logoUrl: c.logoUrl || '',
        phone: c.phone,
        status: c.status,
        plan: c.plan,
        createdAt: c.createdAt,
        userCount,
        objectCount,
        owner: owner ? { name: `${owner.firstName} ${owner.lastName || ''}`.trim(), phone: owner.phone } : null,
      };
    }));
    res.json(result);
  } catch (err) {
    console.error('companies GET error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Firma ma'lumotlarini yangilash (dasturchi istalgan firmani o'zgartira oladi)
router.put('/:id', async (req, res) => {
  try {
    const { name, status, plan } = req.body;
    const c = await Company.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Firma topilmadi' });
    if (name?.trim()) c.name = name.trim();
    if (status && ['PENDING', 'ACTIVE', 'SUSPENDED'].includes(status)) c.status = status;
    if (plan && ['FREE', 'PRO', 'ENTERPRISE'].includes(plan)) c.plan = plan;
    await c.save();
    res.json({ id: String(c._id), branchId: c.branchId, name: c.name, status: c.status, plan: c.plan });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Firmani va uning BARCHA ma'lumotlarini o'chirish (dasturchi — ehtiyot bo'ling!)
router.delete('/:id', async (req, res) => {
  try {
    const cid = req.params.id;
    const c = await Company.findById(cid);
    if (!c) return res.status(404).json({ error: 'Firma topilmadi' });

    const cidStr = String(c._id);
    // Cascade: firmaga tegishli barcha yozuvlarni o'chiramiz
    const [u, o, m, t, msg, g, s] = await Promise.all([
      User.deleteMany({ companyId: cidStr }),
      ObjectModel.deleteMany({ companyId: cidStr }),
      Material.deleteMany({ companyId: cidStr }),
      Transaction.deleteMany({ companyId: cidStr }),
      Message.deleteMany({ companyId: cidStr }),
      Group.deleteMany({ companyId: cidStr }),
      Subscription.deleteMany({ companyId: cidStr }),
    ]);
    await Company.findByIdAndDelete(cid);

    res.json({
      message: 'Firma va ma\'lumotlari o\'chirildi',
      deleted: {
        users: u.deletedCount, objects: o.deletedCount, materials: m.deletedCount,
        transactions: t.deletedCount, messages: msg.deletedCount, groups: g.deletedCount, subscriptions: s.deletedCount,
      },
    });
  } catch (err) {
    console.error('companies DELETE error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
