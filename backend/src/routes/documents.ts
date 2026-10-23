import { Router } from 'express';
import CompanyDocument from '../models/CompanyDocument';
import User from '../models/User';
import ObjectModel from '../models/Object';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { requireOwnerOrAdmin } from '../middleware/auth';
import { getBackendUrl } from '../utils/backendUrl';
import { logAudit } from '../services/audit';
import { allowedObjectIds, canAccessObject, optionalObjectAllowed, OBJECT_FORBIDDEN } from '../middleware/objectScope';

const router = Router();

function isOwnFileUrl(url: string): boolean {
  try {
    const own = new URL(getBackendUrl());
    const u = new URL(url);
    return u.hostname === own.hostname;
  } catch { return false; }
}

// Hujjat/shartnoma boshqaruvi — yuklash/ko'rish BARCHA xodimga ochiq
// (masalan prorab shartnoma shartlarini tekshirishi kerak bo'lishi mumkin),
// o'chirish faqat yuklagan xodim yoki admin.
router.get('/', async (req, res) => {
  try {
    const { objectId } = req.query as Record<string, string>;
    const filter: any = scoped();
    if (objectId) filter.objectId = String(objectId);
    // Obyekt doirasi (owner 2026-10-23): rahbar bo'lmagan xodim — biriktirilgan obyektlar hujjatlari + o'zi yuklaganlar
    const allowed = await allowedObjectIds();
    if (allowed !== null) {
      if (objectId && !allowed.includes(String(objectId))) return res.json([]);
      filter.$or = [{ objectId: { $in: allowed } }, { 'uploadedBy.userId': String(getTenant()?.userId || '') }];
    }
    const list = await CompanyDocument.find(filter).sort({ createdAt: -1 }).lean();
    res.json(list.map(d => ({ ...d, id: d._id })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.post('/', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { objectId, category, title, fileUrl, fileName, expiresAt } = req.body || {};
    // Hujjat muddati (owner 2026-10-19) — tugashidan 30/7/1 kun oldin eslatiladi (services/insights.ts)
    const exp = typeof expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(expiresAt) && !isNaN(Date.parse(expiresAt)) ? new Date(expiresAt) : undefined;
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Sarlavha kerak' });
    if (!fileUrl || !isOwnFileUrl(String(fileUrl))) return res.status(400).json({ error: "Fayl avval /api/messages/upload orqali yuklanishi kerak" });

    if (!(await optionalObjectAllowed(objectId))) return res.status(403).json(OBJECT_FORBIDDEN);
    const actor = await User.findById(t.userId).lean().catch(() => null);
    if (!actor) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    const doc = await CompanyDocument.create(stamped({
      objectId: objectId || undefined,
      category: ['contract', 'permit', 'invoice', 'other'].includes(category) ? category : 'other',
      title: String(title).trim(),
      fileUrl, fileName,
      ...(exp ? { expiresAt: exp } : {}),
      uploadedBy: { userId: t.userId, name: `${actor.firstName} ${actor.lastName || ''}`.trim(), role: actor.role },
    }));

    await logAudit({
      userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
      action: 'create', entity: 'document', entityId: String(doc._id),
      description: `Hujjat qo'shildi: "${doc.title}"`, companyId: t.companyId, req,
    });

    res.status(201).json({ ...doc.toObject(), id: doc._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Ichki elektron imzo — faqat direktor/o'rinbosar (shartnoma/ruxsatnoma
// kabi hujjatlarni tasdiqlash vakolati ularda). Hech qanday tashqi xizmatga
// (masalan DocuSign) hech narsa yuborilmaydi — faqat "kim, qachon"
// bizning bazamizda qayd etiladi, bu qurilish firmasining ICHKI hujjat
// tasdiqlash izini yetarlicha ta'minlaydi.
// PATCH /api/documents/:id/expiry — muddatni o'rnatish/o'chirish (rahbar)
router.patch('/:id/expiry', requireOwnerOrAdmin, async (req, res) => {
  try {
    const v = req.body?.expiresAt;
    const exp = v === null || v === '' ? null : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !isNaN(Date.parse(v)) ? new Date(v) : undefined;
    if (exp === undefined) return res.status(400).json({ error: "Sana noto'g'ri" });
    const doc = await CompanyDocument.findOneAndUpdate(scoped({ _id: req.params.id }), exp ? { $set: { expiresAt: exp } } : { $unset: { expiresAt: 1 } }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ...doc, id: (doc as any)._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.post('/:id/sign', requireOwnerOrAdmin, async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const doc = await CompanyDocument.findOne(scoped({ _id: req.params.id }));
    if (!doc) return res.status(404).json({ error: 'Topilmadi' });
    const actor = await User.findById(t.userId).lean().catch(() => null);
    if (!actor) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    if ((doc.signatures || []).some((s: any) => String(s.userId) === String(t.userId))) {
      return res.status(409).json({ error: 'Siz allaqachon imzolagansiz' });
    }
    doc.signatures = [...(doc.signatures || []), {
      userId: t.userId, name: `${actor.firstName} ${actor.lastName || ''}`.trim(), role: actor.role, signedAt: new Date(),
    }];
    await doc.save();

    await logAudit({
      userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
      action: 'update', entity: 'document', entityId: String(doc._id),
      description: `Hujjat imzolandi: "${doc.title}"`, companyId: t.companyId, req,
    });

    res.json({ ...doc.toObject(), id: doc._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// PATCH /api/documents/:id — sarlavha/turkum/obyektni tuzatish (owner 2026-10-22: o'zi qo'shganini — o'zi,
// hammasini — direktor/o'rinbosar). Fayl o'zi almashtirilmaydi (kerak bo'lsa o'chirib qayta yuklanadi);
// imzolangan hujjat matni o'zgarmasligi uchun imzodan keyin faqat rahbar tahrirlaydi.
router.patch('/:id', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const doc: any = await CompanyDocument.findOne(scoped({ _id: req.params.id }));
    if (!doc) return res.status(404).json({ error: 'Topilmadi' });
    const isUploader = String(doc.uploadedBy?.userId) === String(t.userId);
    const isBoss = !!t.isOwner || t.role === 'direktor' || t.role === 'orinbosar';
    if (!isUploader && !isBoss) return res.status(403).json({ error: "Faqat yuklagan xodim yoki admin o'zgartira oladi" });
    if (!isBoss && (doc.signatures || []).length) return res.status(409).json({ error: "Imzolangan hujjatni faqat direktor yoki o'rinbosar o'zgartira oladi" });
    const { title, category, objectId } = req.body || {};
    const set: Record<string, unknown> = {};
    if (title !== undefined) {
      const tt = String(title || '').trim().slice(0, 300);
      if (!tt) return res.status(400).json({ error: 'Sarlavha kerak' });
      set.title = tt;
    }
    if (category !== undefined) {
      if (!['contract', 'permit', 'invoice', 'other'].includes(category)) return res.status(400).json({ error: "Noto'g'ri turkum" });
      set.category = category;
    }
    if (objectId !== undefined) {
      if (objectId && !(await ObjectModel.exists(scoped({ _id: String(objectId) })).catch(() => null))) return res.status(400).json({ error: 'Obyekt topilmadi' });
      if (!(await optionalObjectAllowed(objectId))) return res.status(403).json(OBJECT_FORBIDDEN);
      set.objectId = objectId ? String(objectId) : undefined;
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: "O'zgartirish yo'q" });
    const before = { title: doc.title, category: doc.category, objectId: doc.objectId };
    doc.set(set);
    await doc.save();
    const actor = await User.findById(t.userId).lean().catch(() => null);
    if (actor) {
      logAudit({
        userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
        action: 'update', entity: 'document', entityId: String(doc._id),
        description: `Hujjat o'zgartirildi: "${before.title}"`, oldValue: before, newValue: set, companyId: t.companyId, req,
      }).catch(() => {});
    }
    res.json({ ...doc.toObject(), id: doc._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const doc = await CompanyDocument.findOne(scoped({ _id: req.params.id }));
    if (!doc) return res.status(404).json({ error: 'Topilmadi' });
    const isOwner = String(doc.uploadedBy?.userId) === String(t.userId);
    const isBoss = !!t.isOwner || t.role === 'direktor' || t.role === 'orinbosar';
    if (!isOwner && !isBoss) return res.status(403).json({ error: "Faqat yuklagan xodim yoki admin o'chira oladi" });
    const snapshot = doc.toObject();
    await doc.deleteOne();
    const actor = await User.findById(t.userId).lean().catch(() => null);
    if (actor) {
      logAudit({
        userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
        action: 'delete', entity: 'document', entityId: String(req.params.id),
        description: `Hujjat o'chirildi: "${snapshot.title}"`, oldValue: snapshot, companyId: t.companyId, req,
      }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
