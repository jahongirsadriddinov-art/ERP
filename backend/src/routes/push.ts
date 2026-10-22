import { Router } from 'express';
import { PushSubscription, sendPushToUser, getVapidPublicKey } from '../services/push';
import { getTenant } from '../middleware/tenantContext';
import { stamped } from '../middleware/scope';

const router = Router();

// GET /api/push/vapidPublicKey — frontend uchun public key
router.get('/vapidPublicKey', (_, res) => {
  res.json({ key: getVapidPublicKey() });
});

// XAVFSIZLIK (audit 2026-10-22): push yuborilganda server shu endpoint'ga POST qiladi — istalgan URL
// qabul qilinsa ichki tarmoq / bulut metadata xizmatiga so'rov yuborish (SSRF) mumkin edi. Faqat
// ma'lum Web Push xizmatlari (Chrome/Edge/Opera/Yandex — FCM, Firefox — Mozilla, Windows — WNS, Safari — Apple).
const PUSH_HOST_RE = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/i;
export function isAllowedPushEndpoint(v: unknown): boolean {
  if (typeof v !== 'string' || v.length > 2000) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && (u.port === '' || u.port === '443') && PUSH_HOST_RE.test(u.hostname);
  } catch { return false; }
}

// POST /api/push/subscribe — push subscription saqlash
router.post('/subscribe', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "endpoint va keys (p256dh, auth) talab etiladi" });
    }
    if (!isAllowedPushEndpoint(endpoint) || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
      return res.status(400).json({ error: "Push manzili noto'g'ri" });
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
