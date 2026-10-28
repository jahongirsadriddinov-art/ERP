import { Router } from 'express';
import { getIceServers, getTurnUsageGB, isMeteredConfigured } from '../services/meteredTurn';

// TURN (qo'ng'iroq relay serveri) holati — dasturchi panelidagi "Server" bo'limi uchun
// (owner 2026-10-28: "admin paneldan kuzatishni qo'sh"). Qo'ng'iroq uzilib qolganda
// sababini DARHOL ko'rsatadi: credential muddati tugaganmi yoki trafik kvotasi tugayaptimi.
//
// Bepul tarifda oylik kvota 20 GB; kvota qiymati Metered API'dan kelmaydi, shuning uchun
// uni env orqali belgilash mumkin (METERED_QUOTA_GB), aks holda 20 deb olinadi.
const router = Router();

const CACHE_MS = 60_000;
let cache: { at: number; body: any } | null = null;

router.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!isMeteredConfigured()) return res.json({ configured: false });
  if (cache && Date.now() - cache.at < CACHE_MS) return res.json({ ...cache.body, cachedAt: cache.at });

  const quotaGB = Number(process.env.METERED_QUOTA_GB) > 0 ? Number(process.env.METERED_QUOTA_GB) : 20;
  // ICE ro'yxati olinsa — TURN ishlayapti; olinmasa sabab odatda credential muddati tugagani.
  const ice = await getIceServers().catch(() => null);
  const usageGB = ice ? await getTurnUsageGB().catch(() => null) : null;
  const body = {
    configured: true,
    ok: !!ice?.length,
    servers: ice?.length || 0,
    usageGB,
    quotaGB,
    percent: usageGB != null && quotaGB > 0 ? Math.min(100, Math.round((usageGB / quotaGB) * 1000) / 10) : null,
    problem: ice?.length ? null : 'credential',
  };
  cache = { at: Date.now(), body };
  res.json(body);
});

export default router;
