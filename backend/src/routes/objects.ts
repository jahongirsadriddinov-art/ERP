import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import ObjectModel from '../models/Object';
import Material from '../models/Material';
import { parseSmeta } from '../services/smetaParser';
import { scoped, stamped } from '../middleware/scope';

const router = Router();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

// Create Object
router.post('/', async (req, res) => {
  try {
    const { name, budget, location, foremanId } = req.body;
    const obj = new ObjectModel(stamped({ name, budget, location, foremanId }));
    await obj.save();
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

// Update Object Status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'paused', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Noto\'g\'ri status' });
    }
    const obj = await ObjectModel.findOneAndUpdate(scoped({ _id: req.params.id }), { status }, { new: true });
    if (!obj) return res.status(404).json({ error: 'Obyekt topilmadi' });
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
