import { Router } from 'express';
import Notification from '../models/Notification';
import { getTenant } from '../middleware/tenantContext';

const router = Router();

// GET /api/notifications — current user's notifications
router.get('/', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const { page = '1', limit = '30', unread } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const filter: any = { recipientId: tenant.userId };
    if (unread === 'true') filter.read = false;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipientId: tenant.userId, read: false }),
    ]);

    res.json({ notifications, total, unreadCount, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (err) {
    console.error('Notifications GET error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const count = await Notification.countDocuments({ recipientId: tenant.userId, read: false });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// PATCH /api/notifications/:id/read — mark single as read
router.patch('/:id/read', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientId: tenant.userId },
      { read: true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ id: notif._id, read: notif.read });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// PATCH /api/notifications/read-all — mark all as read
router.patch('/read-all', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    await Notification.updateMany({ recipientId: tenant.userId, read: false }, { read: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// DELETE /api/notifications/:id
router.delete('/:id', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    await Notification.findOneAndDelete({ _id: req.params.id, recipientId: tenant.userId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
