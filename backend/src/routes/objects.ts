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
import { planFactFor, type PlanFact } from '../services/planFact';
import { analyzeMedia } from '../services/photoAnalysis';
import { allowedObjectIds, canAccessObject } from '../middleware/objectScope';

const coordsFromBody = (lat: any, lng: any, radius: any) => {
  const out: any = {};
  const la = Number(lat), lo = Number(lng);
  if (lat != null && lng != null && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) { out.lat = la; out.lng = lo; }
  // Owner 2026-10-22: radius ixtiyoriy — bo'sh/0 = "Ishga keldim" joyi tekshirilmaydi; 50 m – 100 km
  if (radius === null || radius === '' || Number(radius) === 0) out.geofenceRadius = 0;
  else if (radius !== undefined) {
    const r = Number(radius);
    if (!Number.isFinite(r) || r < 50 || r > 100_000) out.radiusError = "Radius 50 metrdan 100 km gacha bo'lsin (yoki bo'sh qoldiring — tekshirilmaydi)";
    else out.geofenceRadius = Math.round(r);
  }
  return out;
};

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
    const { name, budget, location, foremanId, lat, lng, geofenceRadius } = req.body;

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
      ...(({ radiusError: _e, ...g }) => g)(coordsFromBody(lat, lng, geofenceRadius)),
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

// Smetani kim yuklaydi (owner 2026-10-22): yuklash obyektning BUTUN material ro'yxatini va byudjetini
// almashtiradi — ya'ni boshqalar qo'shgan ma'lumotni o'chiradi. Shu sabab faqat rahbar (direktor/o'rinbosar/ega)
// yoki shu obyektning prorabi (foremanId). Tekshiruv SSE boshlanishidan OLDIN — oddiy JSON 403/404 qaytadi.
async function canUploadSmeta(req: Request, res: Response, next: () => void) {
  const t = getTenant();
  const cleanup = () => { const f = (req as any).file; if (f?.path) fs.unlink(f.path, () => {}); };
  const obj: any = await ObjectModel.findOne(scoped({ _id: req.params.id })).select('foremanId').lean().catch(() => null);
  if (!obj) { cleanup(); return res.status(404).json({ error: 'Obyekt topilmadi' }); }
  const boss = !!t?.isOwner || ['direktor', 'orinbosar'].includes(String(t?.role));
  if (!boss && String(obj.foremanId || '') !== String(t?.userId || '')) {
    cleanup();
    return res.status(403).json({ error: "Smetani faqat direktor, o'rinbosar yoki obyekt prorabi yuklay oladi" });
  }
  return next();
}

// Upload Smeta to Object — SSE progress stream
// XAVFSIZLIK (audit 2026-10-22): smeta yuklash obyektning BARCHA materiallarini o'chirib qayta yozadi va
// byudjetni almashtiradi — avval hech qanday rol tekshiruvi yo'q edi (istalgan ishchi bajarardi). Endi
// /api/smeta/parse bilan bir xil qoida: rahbar yoki o'sha obyekt prorabi. Fayl qabul qilishdan OLDIN.
async function canEditSmeta(req: Request, res: Response, next: () => void) {
  const t = getTenant();
  const boss = !!t?.isOwner || ['direktor', 'orinbosar'].includes(String(t?.role));
  if (boss) return next();
  const own = /^[a-f0-9]{24}$/i.test(String(req.params.id))
    && !!(await ObjectModel.exists(scoped({ _id: String(req.params.id), foremanId: String(t?.userId || '') })).catch(() => null));
  if (!own) return res.status(403).json({ error: "Bu obyekt smetasini o'zgartirishga ruxsat yo'q" });
  return next();
}

router.post('/:id/smeta', canEditSmeta, upload.single('smeta'), canUploadSmeta, async (req: Request, res: Response) => {
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
// ── Plan-fakt (owner 2026-10-19) ────────────────────────────────────────────────────────────────────────────
// Rahbar — barcha obyektlar va pul ko'rsatkichlari; prorab — faqat o'z obyektlari, pulsiz (bajarilish/muddat/material).
function planFactVisible(list: PlanFact[], boss: boolean) {
  if (boss) return list;
  return list.map((p) => ({ ...p, budget: null, spent: 0, pendingSpend: 0, spentPct: null, forecastCost: null, forecastOverrun: null,
    notes: p.notes.filter((n) => !/byudjet/i.test(n)) }));
}
async function planFactScope(): Promise<{ filter: Record<string, unknown>; boss: boolean } | null> {
  const t = getTenant();
  const boss = !!t?.isOwner || ['direktor', 'orinbosar'].includes(String(t?.role));
  if (boss) return { filter: scoped({}), boss };
  if (['prorab', 'brigadir'].includes(String(t?.role))) {
    // Obyekt doirasi (owner 2026-10-23): faqat biriktirilgan obyektlar (projectIds + foremanId)
    const ids = (await allowedObjectIds()) || [];
    return { filter: scoped({ _id: { $in: ids } }), boss };
  }
  return null;
}
router.get('/plan-fact', async (_req, res) => {
  try {
    const sc = await planFactScope();
    if (!sc) return res.status(403).json({ error: "Ruxsat yo'q" });
    const list = await planFactFor({ ...sc.filter, status: { $ne: 'completed' } });
    res.json(planFactVisible(list, sc.boss));
  } catch (err) {
    console.error('[plan-fact]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});
router.get('/:id/plan-fact', async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(String(req.params.id))) return res.status(400).json({ error: "Noto'g'ri id" });
    const sc = await planFactScope();
    if (!sc) return res.status(403).json({ error: "Ruxsat yo'q" });
    // $and — doira filtridagi _id ($in) ustidan yozib yuborilmasin
    const [one] = await planFactFor({ $and: [sc.filter, { _id: req.params.id }] });
    if (!one) return res.status(404).json({ error: 'Obyekt topilmadi' });
    res.json(planFactVisible([one], sc.boss)[0]);
  } catch (err) {
    console.error('[plan-fact]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.get('/', async (req, res) => {
  try {
    // Obyekt doirasi (owner 2026-10-23): rahbardan boshqa rol faqat o'ziga biriktirilgan obyektlarni ko'radi
    const allowed = await allowedObjectIds();
    const objects = await ObjectModel.find(scoped(allowed === null ? {} : { _id: { $in: allowed } })).sort({ createdAt: -1 }).lean();
    // Owner 2026-10-22: byudjet va mijoz havolasi — faqat rahbarlarga (direktor/o'rinbosar/egasi)
    const tn = getTenant();
    const boss = !!tn?.isOwner || ['direktor', 'orinbosar'].includes(String(tn?.role)) || !!tn?.isDeveloper;
    // Bitta so'rov bilan barcha obyektlarning materiallari (avval har obyekt uchun alohida so'rov — N+1)
    const allMaterials = objects.length
      ? await Material.find({ objectId: { $in: objects.map((o: any) => o._id) } }).lean()
      : [];
    const byObject = new Map<string, any[]>();
    for (const m of allMaterials) {
      const k = String(m.objectId);
      const arr = byObject.get(k);
      if (arr) arr.push(m); else byObject.set(k, [m]);
    }
    const objectsWithMaterials = objects.map((obj: any) => {
      const materials = byObject.get(String(obj._id)) || [];
      if (boss) return { ...obj, materials };
      const { budget: _b, budgetAlertLevel: _l, clientShareToken: _t, ...rest } = obj;
      return { ...rest, materials };
    });
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
    const { name, budget, location, foremanId, lat, lng, geofenceRadius, startDate, endDate, progressManual } = req.body || {};
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
    // Plan-fakt: reja muddati (YYYY-MM-DD) va qo'lda bajarilish foizi (null — AI/material bahosiga qaytish)
    const asDate = (v: unknown) => (v === null || v === '' ? null : /^\d{4}-\d{2}-\d{2}/.test(String(v)) && !isNaN(Date.parse(String(v))) ? new Date(String(v)) : undefined);
    if (startDate !== undefined) { const d = asDate(startDate); if (d === undefined) return res.status(400).json({ error: "Boshlanish sanasi noto'g'ri" }); update.startDate = d; }
    if (endDate !== undefined) { const d = asDate(endDate); if (d === undefined) return res.status(400).json({ error: "Tugash sanasi noto'g'ri" }); update.endDate = d; }
    if (progressManual !== undefined) {
      if (progressManual === null || progressManual === '') update.progressManual = null;
      else { const n = Number(progressManual); if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ error: "Foiz 0-100 oralig'ida bo'lsin" }); update.progressManual = Math.round(n); }
    }
    const sd = update.startDate !== undefined ? update.startDate : before.startDate;
    const ed = update.endDate !== undefined ? update.endDate : before.endDate;
    if (sd && ed && new Date(ed) <= new Date(sd)) return res.status(400).json({ error: "Tugash sanasi boshlanishdan keyin bo'lsin" });
    const geo = coordsFromBody(lat, lng, geofenceRadius);
    if (geo.radiusError) return res.status(400).json({ error: geo.radiusError });
    Object.assign(update, geo);
    // Manzil o'zgarib, yangi nuqta berilmasa — eski nuqta noto'g'ri bo'lib qoladi: tozalaymiz (keyin manzildan qayta aniqlanadi)
    if (location !== undefined && lat === undefined && String(location || '').trim() !== String(before.location || '').trim()) { update.lat = undefined; update.lng = undefined; }

    const obj = await ObjectModel.findOneAndUpdate(scoped({ _id: req.params.id }), update, { returnDocument: 'after' });

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
    const obj = await ObjectModel.findOneAndUpdate(scoped({ _id: req.params.id }), { status }, { returnDocument: 'after' });

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

// DELETE /api/objects/:id — obyektni BUTUNLAY o'chiradi. Aniq talab:
// avval faqat status (tugallangan/to'xtatilgan) o'zgartirish mumkin edi,
// obyektni umuman o'chirish imkoni yo'q edi. Bog'liq Material va
// ProjectMedia yozuvlari ham birga o'chiriladi (aks holda "egasiz" qolib
// bazani chiqindiga to'ldirardi) — lekin tarixiy Tranzaksiya/Hujjat/
// Jihoz/Xavfsizlik yozuvlari SAQLANIB QOLADI (moliyaviy/audit tarix hech
// qachon o'chirilmaydi, faqat endi mavjud bo'lmagan obyektga ishora
// qiladi — bu allaqachon frontend/eksportda tolerantlik bilan ishlov
// beriladi, masalan export1c.ts'dagi `objectName.get(...) || ''`).
router.delete('/:id', requireOwnerOrAdmin, async (req, res) => {
  try {
    const obj = await ObjectModel.findOneAndDelete(scoped({ _id: req.params.id }));
    if (!obj) return res.status(404).json({ error: 'Obyekt topilmadi' });

    await Promise.all([
      Material.deleteMany({ objectId: req.params.id }),
      ProjectMedia.deleteMany({ objectId: req.params.id }),
    ]);

    const t = getTenant();
    if (t?.userId) {
      const actor = await User.findById(t.userId).lean().catch(() => null);
      if (actor) {
        logAudit({
          userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
          action: 'delete', entity: 'object', entityId: String(req.params.id),
          description: `Obyekt o'chirildi: "${obj.name}"`,
          oldValue: { name: obj.name, budget: obj.budget, location: obj.location, status: obj.status },
          companyId: t.companyId, req,
        }).catch(() => {});
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[objects delete]', err);
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
    if (!obj || !(await canAccessObject(req.params.id))) return res.status(404).json({ error: 'Obyekt topilmadi' });
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
    if (!obj || !(await canAccessObject(req.params.id))) return res.status(404).json({ error: 'Obyekt topilmadi' });

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
    // AI foto-nazorat — fonda (javobni kutdirmaydi): bosqich, foiz, xavfsizlik (services/photoAnalysis.ts)
    if (type === 'image') setImmediate(() => { analyzeMedia(String(media._id)).catch((e) => console.warn('[photoAnalysis]', e?.message)); });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST /api/objects/:id/media/:mediaId/analyze — AI foto-tahlilni qayta ishga tushirish (rahbar)
router.post('/:id/media/:mediaId/analyze', requireOwnerOrAdmin, async (req, res) => {
  try {
    const m: any = await ProjectMedia.findOne(scoped({ _id: req.params.mediaId, objectId: req.params.id })).select('_id type').lean();
    if (!m) return res.status(404).json({ error: 'Rasm topilmadi' });
    if (m.type !== 'image') return res.status(400).json({ error: 'Faqat rasm tahlil qilinadi' });
    const a = await analyzeMedia(String(m._id), { force: true });
    if (!a) return res.status(503).json({ error: "AI tahlil hozir mavjud emas (kunlik chegara yoki AI sozlanmagan)" });
    res.json(a);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// PATCH /api/objects/:id/media/:mediaId — rasm/video ostidagi izohni tahrirlash
// (yuklagan xodimning o'zi yoki direktor/o'rinbosar).
router.patch('/:id/media/:mediaId', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const media = await ProjectMedia.findOne(scoped({ _id: req.params.mediaId, objectId: req.params.id }));
    if (!media || !(await canAccessObject(req.params.id))) return res.status(404).json({ error: 'Topilmadi' });
    const isOwner = String(media.uploadedBy?.userId) === String(t.userId);
    const isBoss = t.role === 'direktor' || t.role === 'orinbosar';
    if (!isOwner && !isBoss) return res.status(403).json({ error: 'Faqat yuklagan xodim yoki admin tahrirlay oladi' });
    const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim().slice(0, 300) : '';
    media.caption = caption || undefined;
    await media.save();
    res.json({ id: media._id, type: media.type, url: media.url, caption: media.caption, uploadedBy: media.uploadedBy, createdAt: media.createdAt });
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
    if (!media || !(await canAccessObject(req.params.id))) return res.status(404).json({ error: 'Topilmadi' });
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
