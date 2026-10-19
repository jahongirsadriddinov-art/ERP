import { Router } from 'express';

// Server holati (owner 2026-10-19): UptimeRobot monitorlari dasturchi panelida. Faqat READ-ONLY API kalit
// (UPTIMEROBOT_API_KEY, Render env) — kalit brauzerga chiqmaydi, backend o'zi so'raydi; javob 60 s keshlanadi.
const router = Router();

type Monitor = { id: number; name: string; url: string; status: 'up' | 'down' | 'paused' | 'pending'; uptime: { d1: number | null; d7: number | null; d30: number | null }; responseMs: number | null };

let cache: { at: number; data: Monitor[] } | null = null;
const TTL_MS = 60_000;

const STATUS: Record<number, Monitor['status']> = { 0: 'paused', 1: 'pending', 2: 'up', 8: 'down', 9: 'down' };
const pct = (v: unknown): number | null => {
  if (v === undefined || v === null || String(v).trim() === '') return null;   // ma'lumot yo'q — "0%" emas
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

export function mapMonitors(raw: any): Monitor[] {
  const list = Array.isArray(raw?.monitors) ? raw.monitors : [];
  return list.slice(0, 50).map((m: any) => {
    const r = String(m?.custom_uptime_ratio || '').split('-');
    return {
      id: Number(m?.id) || 0,
      name: String(m?.friendly_name || m?.url || '').slice(0, 80),
      url: String(m?.url || '').slice(0, 200),
      status: STATUS[Number(m?.status)] || 'pending',
      uptime: { d1: pct(r[0]), d7: pct(r[1]), d30: pct(r[2]) },
      responseMs: Number.isFinite(Number(m?.average_response_time)) ? Math.round(Number(m.average_response_time)) : null,
    };
  });
}

router.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const key = (process.env.UPTIMEROBOT_API_KEY || '').trim();
  if (!key) return res.json({ configured: false, monitors: [] });
  if (cache && Date.now() - cache.at < TTL_MS) return res.json({ configured: true, monitors: cache.data, cachedAt: cache.at });
  try {
    const r = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({ api_key: key, format: 'json', custom_uptime_ratios: '1-7-30', response_times_average: '60' }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || j?.stat !== 'ok') {
      console.warn('[uptime] UptimeRobot javobi:', r.status, String(j?.error?.type || j?.error?.message || '').slice(0, 80));
      return res.status(502).json({ configured: true, error: 'uptimerobot_error', monitors: cache?.data || [] });
    }
    cache = { at: Date.now(), data: mapMonitors(j) };
    return res.json({ configured: true, monitors: cache.data, cachedAt: cache.at });
  } catch (e) {
    console.warn('[uptime] UptimeRobot so\'rovi xatosi:', (e as Error)?.name || 'Error');
    return res.status(502).json({ configured: true, error: 'uptimerobot_unreachable', monitors: cache?.data || [] });
  }
});

export default router;
