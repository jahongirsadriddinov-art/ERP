import { Router } from 'express';
import { getTenant } from '../middleware/tenantContext';
import { scoped } from '../middleware/scope';
import Material from '../models/Material';
import ObjectModel from '../models/Object';
import Transaction from '../models/Transaction';
import User from '../models/User';
import { logAudit } from '../services/audit';

const router = Router();

// Duplicate QR scan protection: userId:qrKey → timestamp
const recentScans = new Map<string, number>();
const SCAN_COOLDOWN_MS = 5000; // 5 seconds

// GET /api/qr/material/:id — QR uchun material ma'lumoti
router.get('/material/:id', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const mat = await Material.findOne(scoped({ _id: req.params.id })).lean();
    if (!mat) return res.status(404).json({ error: 'Material topilmadi' });

    res.json({
      type: 'material',
      id: mat._id,
      name: mat.name,
      unit: mat.unit,
      needed: mat.needed,
      sent: mat.sent,
      remaining: mat.remaining,
      objectId: mat.objectId,
    });
  } catch (err) {
    console.error('QR material error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/qr/object/:id — QR uchun obyekt ma'lumoti
router.get('/object/:id', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const obj = await ObjectModel.findOne(scoped({ _id: req.params.id })).lean();
    if (!obj) return res.status(404).json({ error: 'Obyekt topilmadi' });

    res.json({
      type: 'object',
      id: obj._id,
      name: obj.name,
      location: obj.location,
      status: obj.status,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST /api/qr/scan — QR scan natijasini qayta ishlash va log qilish
router.post('/scan', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const { qrData } = req.body;
    if (!qrData) return res.status(400).json({ error: 'QR ma\'lumoti kerak' });

    let parsed: any;
    try {
      parsed = typeof qrData === 'string' ? JSON.parse(qrData) : qrData;
    } catch {
      return res.status(400).json({ error: 'Noto\'g\'ri QR format' });
    }

    const { type, id } = parsed;
    if (!type || !id) return res.status(400).json({ error: 'QR ma\'lumoti noto\'g\'ri' });

    const actor = await User.findById(tenant.userId).lean();
    if (!actor) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    // Duplicate scan protection
    const scanKey = `${tenant.userId}:${type}:${id}`;
    const lastScan = recentScans.get(scanKey);
    if (lastScan && Date.now() - lastScan < SCAN_COOLDOWN_MS) {
      return res.status(409).json({ error: 'Bu QR az vaqt oldin skan qilindi. Biroz kuting.' });
    }
    recentScans.set(scanKey, Date.now());
    // Clean up old entries
    if (recentScans.size > 1000) {
      const cutoff = Date.now() - SCAN_COOLDOWN_MS;
      for (const [k, v] of recentScans) { if (v < cutoff) recentScans.delete(k); }
    }

    let entityData: any = null;

    if (type === 'material') {
      entityData = await Material.findOne(scoped({ _id: id })).lean();
      if (!entityData) return res.status(404).json({ error: 'Material topilmadi' });
    } else if (type === 'object') {
      entityData = await ObjectModel.findOne(scoped({ _id: id })).lean();
      if (!entityData) return res.status(404).json({ error: 'Obyekt topilmadi' });
    } else if (type === 'transaction') {
      entityData = await Transaction.findOne(scoped({ _id: id })).lean();
      if (!entityData) return res.status(404).json({ error: 'Tranzaksiya topilmadi' });
    } else {
      return res.status(400).json({ error: 'Noma\'lum QR turi' });
    }

    // Log the QR scan
    await logAudit({
      userId: String(actor._id),
      userName: `${actor.firstName || ''} ${actor.lastName || ''}`.trim(),
      userRole: actor.role,
      action: 'scan_qr',
      entity: type,
      entityId: String(id),
      description: `QR skan: ${type} #${id}`,
      companyId: actor.companyId,
      req,
    });

    res.json({ type, data: entityData });
  } catch (err) {
    console.error('QR scan error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/qr/generate — generate QR data payload (not image, client renders it)
router.get('/generate', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const { type, id } = req.query as { type: string; id: string };
    if (!type || !id) return res.status(400).json({ error: 'type va id kerak' });

    const allowedTypes = ['material', 'object', 'transaction'];
    if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'Noto\'g\'ri tur' });

    const payload = JSON.stringify({ type, id, v: 1 });
    res.json({ payload, type, id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
