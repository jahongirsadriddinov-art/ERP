import { Router } from 'express';
import CompanyDocument from '../models/CompanyDocument';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { requireOwnerOrAdmin } from '../middleware/auth';
import { getBackendUrl } from '../utils/backendUrl';
import { logAudit } from '../services/audit';

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
    if (objectId) filter.objectId = objectId;
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
    const { objectId, category, title, fileUrl, fileName } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Sarlavha kerak' });
    if (!fileUrl || !isOwnFileUrl(String(fileUrl))) return res.status(400).json({ error: "Fayl avval /api/messages/upload orqali yuklanishi kerak" });

    const actor = await User.findById(t.userId).lean().catch(() => null);
    if (!actor) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    const doc = await CompanyDocument.create(stamped({
      objectId: objectId || undefined,
      category: ['contract', 'permit', 'invoice', 'other'].includes(category) ? category : 'other',
      title: String(title).trim(),
      fileUrl, fileName,
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

router.delete('/:id', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const doc = await CompanyDocument.findOne(scoped({ _id: req.params.id }));
    if (!doc) return res.status(404).json({ error: 'Topilmadi' });
    const isOwner = String(doc.uploadedBy?.userId) === String(t.userId);
    const isBoss = t.role === 'direktor' || t.role === 'orinbosar';
    if (!isOwner && !isBoss) return res.status(403).json({ error: "Faqat yuklagan xodim yoki admin o'chira oladi" });
    await doc.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
