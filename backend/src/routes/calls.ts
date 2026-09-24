import { Router } from 'express';
import { getIceServers, getTurnUsageGB, isMeteredConfigured } from '../services/meteredTurn';
import { requireOwnerOrAdmin } from '../middleware/auth';

const router = Router();

// GET /api/calls/ice-config — video/ovozli qo'ng'iroq boshlashdan oldin
// CallOverlay shu yerdan ICE server ro'yxatini oladi. Metered sozlanmagan
// yoki xato bo'lsa `configured: false` qaytadi — frontend bunday holda
// eski (build vaqtida o'rnatilgan, statik) TURN konfiguratsiyasiga
// qaytadi, hech narsa buzilmaydi.
router.get('/ice-config', async (_req, res) => {
  try {
    const iceServers = await getIceServers();
    res.json({ configured: isMeteredConfigured() && !!iceServers, iceServers: iceServers || undefined });
  } catch (err) {
    console.error('[calls/ice-config]', err);
    res.json({ configured: false });
  }
});

// GET /api/calls/turn-usage — joriy TURN credential qancha trafik
// sarflaganini ko'rsatadi (faqat direktor/orinbosar).
router.get('/turn-usage', requireOwnerOrAdmin, async (_req, res) => {
  try {
    const usageInGB = await getTurnUsageGB();
    res.json({ configured: isMeteredConfigured(), usageInGB });
  } catch (err) {
    console.error('[calls/turn-usage]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
