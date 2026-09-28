import { Router } from 'express';
import AuditLog from '../models/AuditLog';
import { getTenant } from '../middleware/tenantContext';
import User from '../models/User';
import { requireFeature } from '../middleware/requireFeature';

const router = Router();

// GET /api/audit-logs — admin/director only
router.get('/', requireFeature('audit_log'), async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const actor = await User.findById(tenant.userId).catch(() => null);
    if (!actor || !['direktor', 'orinbosar', 'dasturchi'].includes(actor.role)) {
      return res.status(403).json({ error: 'Faqat admin ko\'rishi mumkin' });
    }

    const {
      page = '1', limit = '50',
      userId, action, entity, entityId,
      from, to,
    } = req.query as Record<string, string>;

    const filter: any = {};

    // dasturchi sees all; others see only their company
    if (actor.role !== 'dasturchi') {
      filter.companyId = actor.companyId || tenant.companyId;
    }

    if (userId) filter.userId = userId;
    if (action) filter.action = action;
    if (entity) filter.entity = entity;
    if (entityId) filter.entityId = entityId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to + 'T23:59:59');
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      logs,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error('Audit log GET error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/audit-logs/export.csv — audit jurnalini CSV'ga (Excel'da ochiladi)
router.get('/export.csv', requireFeature('audit_log'), async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const actor = await User.findById(tenant.userId).catch(() => null);
    if (!actor || !['direktor', 'orinbosar', 'dasturchi'].includes(actor.role)) {
      return res.status(403).json({ error: "Faqat admin ko'rishi mumkin" });
    }
    const { from, to } = req.query as Record<string, string>;
    const filter: any = {};
    if (actor.role !== 'dasturchi') filter.companyId = actor.companyId || tenant.companyId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to + 'T23:59:59');
    }
    const logs: any[] = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(20000).lean();
    // CSV: formula-injection'ga qarshi (=,+,-,@ bilan boshlangan qiymatlar ' bilan himoyalanadi)
    const cell = (v: any) => {
      let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = ['Vaqt', 'Foydalanuvchi', 'Rol', 'Amal', "Bo'lim", 'ID', 'Tavsif', 'Eski qiymat', 'Yangi qiymat'];
    const rows = logs.map(l => [
      new Date(l.createdAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }),
      l.userName || l.userId || '', l.userRole || '', l.action || '', l.entity || '', l.entityId || '',
      l.description || '', l.oldValue ?? '', l.newValue ?? '',
    ].map(cell).join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\uFEFF' + [header.map(cell).join(';'), ...rows].join('\r\n'));
  } catch (err) {
    console.error('Audit export error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
