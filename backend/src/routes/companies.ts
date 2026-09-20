import { Router } from 'express';
import Company from '../models/Company';
import User from '../models/User';
import ObjectModel from '../models/Object';
import Material from '../models/Material';
import Transaction from '../models/Transaction';
import Message from '../models/Message';
import Group from '../models/Group';
import Subscription from '../models/Subscription';
import CompanyBackup from '../models/CompanyBackup';
import { requireDeveloper } from '../middleware/auth';
import { logAudit } from '../services/audit';

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
// XAVFSIZLIK — TOPILMA (audit): bu eng vayronkor yo'l bo'lishiga qaramay
// (butun firma, cascade), (1) audit jurnaliga HECH NARSA yozmasdi — kim,
// qachon o'chirgani hech qayerda qolmasdi, (2) tiklab bo'lmaydigan edi —
// zaxira nusxa yo'q edi. Endi: cascade o'chirishdan OLDIN to'liq holat
// models/CompanyBackup.ts'ga saqlanadi (90 kun) va audit yoziladi — shu
// bilan ikkalasi ham tuzatildi (POST /backups/:id/restore orqali tiklash
// mumkin).
router.delete('/:id', async (req, res) => {
  try {
    const cid = req.params.id;
    const c = await Company.findById(cid).lean();
    if (!c) return res.status(404).json({ error: 'Firma topilmadi' });

    const cidStr = String(c._id);
    const actingUserId = (req as any).user?.userId;
    const actor = actingUserId ? await User.findById(actingUserId).lean().catch(() => null) : null;
    const actorName = actor ? `${actor.firstName} ${actor.lastName || ''}`.trim() : 'Dasturchi';

    // ── Cascade'dan OLDIN to'liq zaxira nusxa ─────────────────────────────
    const [users, objects, materials, transactions, messages, groups, subscriptions] = await Promise.all([
      User.find({ companyId: cidStr }).lean(),
      ObjectModel.find({ companyId: cidStr }).lean(),
      Material.find({ companyId: cidStr }).lean(),
      Transaction.find({ companyId: cidStr }).lean(),
      Message.find({ companyId: cidStr }).lean(),
      Group.find({ companyId: cidStr }).lean(),
      Subscription.find({ companyId: cidStr }).lean(),
    ]);
    const backupDoc = await CompanyBackup.create({
      companyId: cidStr,
      companyName: c.name,
      branchId: c.branchId,
      reason: 'company_deleted',
      deletedBy: { userId: actingUserId || '', name: actorName, role: actor?.role || 'dasturchi' },
      snapshot: { company: c, users, objects, materials, transactions, messages, groups, subscriptions },
    });

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

    await logAudit({
      userId: actingUserId || 'unknown',
      userName: actorName,
      userRole: actor?.role || 'dasturchi',
      action: 'delete',
      entity: 'company',
      entityId: cidStr,
      description: `Firma o'chirildi: "${c.name}" (${c.branchId}) — ${users.length} user, ${objects.length} obyekt, ${transactions.length} tranzaksiya. Zaxira: CompanyBackup#${backupDoc._id}`,
      oldValue: { name: c.name, branchId: c.branchId, status: c.status },
      companyId: cidStr,
      req,
    });

    res.json({
      message: 'Firma va ma\'lumotlari o\'chirildi (90 kun ichida tiklash mumkin)',
      backupId: String(backupDoc._id),
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

// GET /api/companies/backups — o'chirilgan firmalarning tiklash mumkin
// bo'lgan zaxira nusxalari ro'yxati (dasturchi uchun).
router.get('/backups/list', async (req, res) => {
  try {
    const backups = await CompanyBackup.find({ restoredAt: { $exists: false } })
      .select('companyId companyName branchId deletedBy createdAt snapshot.users snapshot.objects snapshot.transactions')
      .sort({ createdAt: -1 }).lean();
    res.json(backups.map(b => ({
      id: b._id,
      companyId: b.companyId,
      companyName: b.companyName,
      branchId: b.branchId,
      deletedBy: b.deletedBy,
      deletedAt: (b as any).createdAt,
      counts: {
        users: (b.snapshot as any)?.users?.length || 0,
        objects: (b.snapshot as any)?.objects?.length || 0,
        transactions: (b.snapshot as any)?.transactions?.length || 0,
      },
    })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST /api/companies/backups/:id/restore — o'chirilgan firmani TO'LIQ
// tiklaydi (o'sha eski _id'lar bilan, aloqalar buzilmasin uchun). Bir
// martalik: tiklangan zaxira qayta ishlatib bo'lmaydi.
router.post('/backups/:id/restore', async (req, res) => {
  try {
    const backup = await CompanyBackup.findOne({ _id: req.params.id, restoredAt: { $exists: false } });
    if (!backup) return res.status(404).json({ error: "Zaxira topilmadi yoki allaqachon tiklangan" });

    const existing = await Company.findById(backup.companyId).lean();
    if (existing) return res.status(409).json({ error: "Bu ID'dagi firma allaqachon mavjud — avval uni tekshiring" });

    const { company, users, objects, materials, transactions, messages, groups, subscriptions } = backup.snapshot as any;
    // insertMany({ordered:false}) — biror hujjat allaqachon mavjud bo'lsa
    // (masalan qisman tiklash qayta bosilsa) o'sha bittasini o'tkazib
    // yuborib, qolganini davom ettiradi, hammasini to'xtatib qo'ymaydi.
    const insertSafe = async (Model: any, docs: any[]) => {
      if (!docs?.length) return 0;
      try { const r = await Model.insertMany(docs, { ordered: false }); return r.length; }
      catch (e: any) { return e?.insertedDocs?.length ?? 0; }
    };
    await Company.create(company);
    const [uCount, oCount, mCount, tCount, msgCount, gCount, sCount] = await Promise.all([
      insertSafe(User, users), insertSafe(ObjectModel, objects), insertSafe(Material, materials),
      insertSafe(Transaction, transactions), insertSafe(Message, messages), insertSafe(Group, groups),
      insertSafe(Subscription, subscriptions),
    ]);

    backup.restoredAt = new Date();
    await backup.save();

    const actingUserId = (req as any).user?.userId;
    const actor = actingUserId ? await User.findById(actingUserId).lean().catch(() => null) : null;
    await logAudit({
      userId: actingUserId || 'unknown',
      userName: actor ? `${actor.firstName} ${actor.lastName || ''}`.trim() : 'Dasturchi',
      userRole: actor?.role || 'dasturchi',
      action: 'update',
      entity: 'company',
      entityId: backup.companyId,
      description: `Firma tiklandi: "${backup.companyName}" (zaxiradan CompanyBackup#${backup._id})`,
      companyId: backup.companyId,
      req,
    });

    res.json({ ok: true, companyId: backup.companyId, restored: { users: uCount, objects: oCount, materials: mCount, transactions: tCount, messages: msgCount, groups: gCount, subscriptions: sCount } });
  } catch (err) {
    console.error('companies restore error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
