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
// XAVFSIZLIK — TOPILMA (audit): bu yerda hech qanday egalik tekshiruvi yo'q
// edi — router `optionalAuth` bilan ulangan, va handler `endpoint`ni
// to'g'ridan-to'g'ri so'rov tanasidan olib, egasidan qat'i nazar SHU
// endpoint'ga tegishli yozuvni o'chirardi. `endpoint` qiymati brauzer Push
// API'si tomonidan generatsiya qilinadigan uzun, taxmin qilib bo'lmaydigan
// URL bo'lsa-da, bu baribir IDOR naqshi: boshqa foydalanuvchining push
// obunasini o'zining ekanini isbotlamasdan o'chirish imkoni. Endi
// POST /subscribe'dagi bilan bir xil qoida — faqat tekshirilgan tenant
// kontekstidagi userId'ga tegishli yozuv o'chiriladi.
router.delete('/unsubscribe', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { endpoint } = req.body;
    if (endpoint) await PushSubscription.deleteOne({ endpoint, userId: tenant.userId });
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
