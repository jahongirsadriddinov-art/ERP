import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import ObjectModel from '../models/Object';
import Material from '../models/Material';
import ProjectMedia from '../models/ProjectMedia';
import { parseSmeta } from '../services/smetaParser';
import { scoped, stamped } from '../middleware/scope';
import { requireOwnerOrAdmin } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { getTenant } from '../middleware/tenantContext';
import User from '../models/User';
import { getBackendUrl } from '../utils/backendUrl';
import { randomBytes } from 'crypto';

const router = Router();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

// Media URL bizning O'ZIMIZ (backend proksi/upload) manziliga tegishli bo'lishi
// SHART — aks holda ixtiyoriy tashqi (hatto zararli/aldov) havolani "loyiha
// rasmi" sifatida kiritish mumkin edi.
function isOwnMediaUrl(url: string): boolean {
  try {
    const own = new URL(getBackendUrl());
    const u = new URL(url);
    return u.hostname === own.hostname;
  } catch {
    return false;
  }
}

// XAVFSIZLIK — TOPILMA (audit): quyidagi ikkita yo'lda (yaratish, status
// o'zgartirish) HECH QANDAY rol tekshiruvi yo'q edi — oddiy ishchi ham
// yangi obyekt yaratishi yoki istalgan obyektni "tugallangan" deb
// belgilashi mumkin edi. Frontend (App.tsx) bu tugmalarni allaqachon
// faqat direktor/orinbosarga ko'rsatadi — endi backend ham AYNAN shu
// qoidani (requireOwnerOrAdmin) talab qiladi. GET / va smeta yuklash
// ATAYLAB cheklanmagan qoladi — BARCHA xodim loyihalar ro'yxatini
// ko'rishi kerak (masalan tranzaksiya/davomat uchun projectId tanlash).

// Create Object
router.post('/', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { name, budget, location, foremanId } = req.body;

    // Validate required fields
    const errors: { field: string; message: string }[] = [];
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      errors.push({ field: 'name', message: 'Obyekt nomi kamida 2 belgi bo\'lishi kerak' });
    }
    if (name && name.trim().length > 200) {
      errors.push({ field: 'name', message: 'Obyekt nomi 200 belgidan oshmasligi kerak' });
    }
    if (budget !== undefined && budget !== null && budget !== '') {
      const b = Number(budget);
      if (isNaN(b) || b < 0) errors.push({ field: 'budget', message: 'Byudjet manfiy bo\'lmasligi kerak' });
      if (b > 1e15) errors.push({ field: 'budget', message: 'Byudjet juda katta' });
    }
    if (errors.length) return res.status(400).json({ success: false, errors });

    const obj = new ObjectModel(stamped({
      name: name.trim(),
      budget: budget ? Number(budget) : undefined,
      location: location?.trim() || undefined,
      foremanId: foremanId || undefined,
    }));
    await obj.save();

    const t = getTenant();
    if (t?.userId) {
      const actor = await User.findById(t.userId).lean().catch(() => null);
      if (actor) {
        logAudit({
          userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
          action: 'create', entity: 'object', entityId: String(obj._id),
          description: `Yangi obyekt yaratildi: "${obj.name}"`,
          newValue: { name: obj.name, budget: obj.budget }, companyId: t.companyId, req,
        }).catch(() => {});
      }
    }

    res.status(201).json(obj);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Upload Smeta to Object — SSE progress stream
router.post('/:id/smeta', upload.single('smeta'), async (req: Request, res: Response) => {
  // ── SSE setup ──────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (data: object) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  const objId = req.params.id;
  const file = req.file;

  // Uzoq parse davomida proxy timeout bo'lmasligi uchun heartbeat
  const heartbeat = setInterval(() => send({ ping: true }), 15000);

  const cleanup = () => {
    clearInterval(heartbeat);
    if (file?.path) fs.unlink(file.path, () => {}); // vaqtinchalik faylni o'chirish (disk oqishi)
  };

  if (!file) {
    send({ error: true, msg: 'Fayl yuklanmadi' });
    clearInterval(heartbeat);
    return res.end();
  }

  try {
    send({ msg: 'Fayl qabul qilindi', percent: 5 });

    const obj = await ObjectModel.findOne(scoped({ _id: objId }));
    if (!obj) {
      send({ error: true, msg: 'Obyekt topilmadi' });
      return res.end();
    }

    // Mimetype aniqlash
    let mimetype = file.mimetype;
    const ext = (file.originalname || '').split('.').pop()?.toLowerCase();
    if (ext === 'pdf') mimetype = 'application/pdf';
    else if (ext === 'xlsx') mimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (ext === 'xls') mimetype = 'application/vnd.ms-excel';
    else if (ext === 'docx') mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    console.log(`Smeta yuklandi: ${file.originalname}, mimetype: ${mimetype}`);
    send({ msg: 'Smeta tahlil qilinmoqda...', percent: 12 });

    const parsedMaterials = await parseSmeta(
      file.path,
      mimetype,
      (msg, percent) => send({ msg, percent })
    );

    console.log(`Topilgan materiallar soni: ${parsedMaterials.length}`);

    // ── DATA-LOSS GUARD ──────────────────────────────────────────────────────
    // Parse hech narsa qaytarmasa (kvota tugagan, JSON kesilgan, format noto'g'ri)
    // eski materiallarni O'CHIRMAYMIZ — aks holda yomon qayta yuklash ma'lumotni yo'q qiladi.
    if (parsedMaterials.length === 0) {
      send({
        error: true,
        msg: "Smetadan material topilmadi — fayl formati yoki AI limiti. Eski ma'lumotlar saqlab qolindi.",
      });
      return res.end();
    }

    send({ msg: 'Materiallar ma\'lumotlar bazasiga saqlanmoqda...', percent: 85 });

    // Faqat parse muvaffaqiyatli bo'lgandan keyin almashtiramiz
    await Material.deleteMany({ objectId: obj._id });

    const docs = parsedMaterials.map((mat) => stamped({
      objectId: obj._id,
      name: mat.name,
      unit: mat.unit,
      needed: mat.quantity,
      remaining: mat.quantity,
      sent: 0,
      price: mat.price,
    }));
    const createdMaterials = await Material.insertMany(docs); // yuzlab qator uchun tez

    const totalBudget = parsedMaterials.reduce(
      (sum, mat) => sum + (mat.price && mat.quantity ? mat.price * mat.quantity : 0),
      0
    );

    obj.smetaFileUrl = file.originalname || file.path;
    if (totalBudget > 0) obj.budget = totalBudget;
    await obj.save();

    send({
      done: true,
      percent: 100,
      msg: `${createdMaterials.length} ta material saqlandi`,
      count: createdMaterials.length,
      materials: createdMaterials.map((m) => m.toObject()),
      object: obj.toObject(),
    });
  } catch (err) {
    console.error('Smeta upload xatosi:', err);
    send({ error: true, msg: 'Server xatoligi yuz berdi' });
  } finally {
    cleanup();
    res.end();
  }
});

// Get Objects
router.get('/', async (req, res) => {
  try {
    const objects = await ObjectModel.find(scoped()).sort({ createdAt: -1 }).lean();
    const objectsWithMaterials = await Promise.all(
      objects.map(async (obj) => {
        const materials = await Material.find({ objectId: obj._id }).lean();
        return { ...obj, materials };
      })
    );
    res.json(objectsWithMaterials);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Loyihani tahrirlash (nom/byudjet/manzil/prorab) — yaratilgandan keyin
// o'zgartirish imkoni yo'q edi (aniq bo'shliq: xato yozilgan nom yoki
// byudjetni tuzatish uchun loyihani o'chirib qayta yaratishdan boshqa
// yo'l yo'q edi).
router.patch('/:id', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { name, budget, location, foremanId } = req.body || {};
    const before = await ObjectModel.findOne(scoped({ _id: req.params.id })).lean();
    if (!before) return res.status(404).json({ error: 'Obyekt topilmadi' });

    const update: any = {};
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (trimmed.length < 2 || trimmed.length > 200) {
        return res.status(400).json({ error: 'Obyekt nomi 2-200 belgi oralig\'ida bo\'lishi kerak' });
      }
      update.name = trimmed;
    }
    if (budget !== undefined) {
      const b = budget === null || budget === '' ? undefined : Number(budget);
      if (b !== undefined && (isNaN(b) || b < 0 || b > 1e15)) {
        return res.status(400).json({ error: "Byudjet noto'g'ri" });
      }
      update.budget = b;
    }
    if (location !== undefined) update.location = location ? String(location).trim() : undefined;
    if (foremanId !== undefined) update.foremanId = foremanId || undefined;

    const obj = await ObjectModel.findOneAndUpdate(scoped({ _id: req.params.id }), update, { new: true });

    const t = getTenant();
    if (t?.userId) {
      const actor = await User.findById(t.userId).lean().catch(() => null);
      if (actor) {
        logAudit({
          userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
          action: 'update', entity: 'object', entityId: String(req.params.id),
          description: `Obyekt tahrirlandi: "${before.name}"`,
          oldValue: { name: before.name, budget: before.budget, location: before.location, foremanId: before.foremanId },
          newValue: update, companyId: t.companyId, req,
        }).catch(() => {});
      }
    }

    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Update Object Status
router.patch('/:id/status', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'paused', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Noto\'g\'ri status' });
    }
    const before = await ObjectModel.findOne(scoped({ _id: req.params.id })).lean();
    if (!before) return res.status(404).json({ error: 'Obyekt topilmadi' });
    const obj = await ObjectModel.findOneAndUpdate(scoped({ _id: req.params.id }), { status }, { new: true });

    const t = getTenant();
    if (t?.userId && before.status !== status) {
      const actor = await User.findById(t.userId).lean().catch(() => null);
      if (actor) {
        logAudit({
          userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
          action: 'update', entity: 'object', entityId: String(req.params.id),
          description: `Obyekt holati o'zgartirildi: "${before.name}" — ${before.status} → ${status}`,
          oldValue: { status: before.status }, newValue: { status }, companyId: t.companyId, req,
        }).catch(() => {});
      }
    }

    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ── Ish jarayoni rasm/video (ProjectMedia) ──────────────────────────────────
// Aniq talab: "oddiy ishchi... boshqa hamma o'zi qo'lda yuborayotgan
// narsasini kiritadigan qil" — FAQAT direktor/o'rinbosar EMAS, BARCHA
// xodim (ishchi, brigadir, prorab ham) qo'shishi/ko'rishi mumkin, chunki
// ob'ektda bevosita ishlayotgan aynan ular. Fayl aloqasi mavjud
// /api/messages/upload (Cloudinary) orqali OLDINDAN yuklanadi, bu yerga
// faqat natijaviy URL yuboriladi.

// GET /api/objects/:id/media — shu obyektning barcha rasm/videolari.
router.get('/:id/media', async (req, res) => {
  try {
    const obj = await ObjectModel.findOne(scoped({ _id: req.params.id })).select('_id').lean();
    if (!obj) return res.status(404).json({ error: 'Obyekt topilmadi' });
    const media = await ProjectMedia.find({ objectId: req.params.id }).sort({ createdAt: -1 }).lean();
    res.json(media.map(m => ({ id: m._id, type: m.type, url: m.url, caption: m.caption, uploadedBy: m.uploadedBy, createdAt: m.createdAt })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST /api/objects/:id/media — yangi rasm/video qo'shish (ISTALGAN xodim).
router.post('/:id/media', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { url, type, caption } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Fayl URL kerak' });
    if (!isOwnMediaUrl(url)) return res.status(400).json({ error: "Fayl avval /api/messages/upload orqali yuklanishi kerak" });
    if (!['image', 'video'].includes(type)) return res.status(400).json({ error: "Tur 'image' yoki 'video' bo'lishi kerak" });

    const obj = await ObjectModel.findOne(scoped({ _id: req.params.id })).select('_id').lean();
    if (!obj) return res.status(404).json({ error: 'Obyekt topilmadi' });

    const actor = await User.findById(t.userId).lean().catch(() => null);
    if (!actor) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    const media = await ProjectMedia.create(stamped({
      objectId: req.params.id,
      type,
      url,
      caption: caption ? String(caption).slice(0, 300) : undefined,
      uploadedBy: { userId: t.userId, name: `${actor.firstName} ${actor.lastName || ''}`.trim(), role: actor.role },
    }));

    res.status(201).json({ id: media._id, type: media.type, url: media.url, caption: media.caption, uploadedBy: media.uploadedBy, createdAt: media.createdAt });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// DELETE /api/objects/:id/media/:mediaId — faqat yuklagan xodimning o'zi
// yoki direktor/orinbosar o'chira oladi.
router.delete('/:id/media/:mediaId', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const media = await ProjectMedia.findOne(scoped({ _id: req.params.mediaId, objectId: req.params.id }));
    if (!media) return res.status(404).json({ error: 'Topilmadi' });
    const isOwner = String(media.uploadedBy?.userId) === String(t.userId);
    const isBoss = t.role === 'direktor' || t.role === 'orinbosar';
    if (!isOwner && !isBoss) return res.status(403).json({ error: 'Faqat yuklagan xodim yoki admin o\'chira oladi' });
    await media.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ── Mijoz portali (client portal) ───────────────────────────────────────────
// Aniq bo'shliq (agent auditida topilgan): mijoz/buyurtmachi loyiha
// jarayonini kuzatish uchun HECH QANDAY imkoniyatga ega emas edi. To'liq
// alohida login tizimi qurish o'rniga — eng oddiy, xavfsiz yechim: har bir
// obyekt uchun taxmin qilib bo'lmaydigan (32 bayt tasodifiy) HAVOLA, login
// talab qilmaydi, faqat O'QISH uchun (moliyaviy tafsilotlarsiz — faqat
// nom/holat/progress/rasm-video). routes/publicClient.ts shu tokenni o'qiydi.
router.post('/:id/client-link', requireOwnerOrAdmin, async (req, res) => {
  try {
    const obj = await ObjectModel.findOne(scoped({ _id: req.params.id }));
    if (!obj) return res.status(404).json({ error: 'Obyekt topilmadi' });
    obj.clientShareToken = randomBytes(24).toString('hex');
    await obj.save();
    // MUHIM: BACKEND (/api/...) emas, FRONTEND sahifasi (main.tsx'da /client/:token
    // ni ushlab, ClientViewPage'ni render qiladi, u o'zi ICHIDAN backend
        // API'ni chaqiradi) — mijoz to'g'ridan-to'g'ri API JSON'ini emas, chiroyli sahifani ko'rishi kerak.
    const frontendUrl = process.env.SITE_URL || 'http://localhost:5173';
    res.json({ token: obj.clientShareToken, url: `${frontendUrl.replace(/\/$/, '')}/client/${obj.clientShareToken}` });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.delete('/:id/client-link', requireOwnerOrAdmin, async (req, res) => {
  try {
    const obj = await ObjectModel.findOneAndUpdate(scoped({ _id: req.params.id }), { $unset: { clientShareToken: 1 } });
    if (!obj) return res.status(404).json({ error: 'Obyekt topilmadi' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
