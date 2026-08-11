import { Router } from 'express';
import { PushSubscription, sendPushToUser, getVapidPublicKey } from '../services/push';
import { getTenant } from '../middleware/tenantContext';
import { stamped } from '../middleware/scope';

const router = Router();

// GET /api/push/vapidPublicKey — frontend uchun public key
router.get('/vapidPublicKey', (_, res) => {
  res.json({ key: getVapidPublicKey() });
});

// POST /api/push/subscribe — push subscription saqlash
router.post('/subscribe', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "endpoint va keys (p256dh, auth) talab etiladi" });
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      stamped({ userId: tenant.userId, endpoint, keys }),
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// DELETE /api/push/unsubscribe
router.delete('/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) await PushSubscription.deleteOne({ endpoint });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// POST /api/push/test — test bildirishnoma (admin uchun)
router.post('/test', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    await sendPushToUser(tenant.userId, {
      title: '✅ QurilishERP',
      body: 'Push bildirishnomalar ishlayapti!',
      url: process.env.SITE_URL || '/',
      tag: 'test',
    });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

export default router;
