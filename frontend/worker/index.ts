// Cloudflare Worker — sayt + fayl ko'prigi (owner 2026-10-27: Render'da bepul 5 GB trafik tugab,
// butun xizmat to'xtab qoldi). Eng ko'p trafikni ilova fayllari (APK/EXE) va yuklangan media yeydi.
//
// Endi ular `erp-firma.uz/files/...` orqali beriladi: Worker birinchi marta Render'dan oladi va
// Cloudflare chetida keshlaydi; keyingi barcha yuklab olishlar keshdan ketadi — Render'ga trafik
// tushmaydi. Qolgan barcha yo'llar avvalgidek saytning statik fayllariga ketadi.

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Render'dagi backend manzili (wrangler.jsonc > vars) */
  BACKEND_URL?: string;
}

const DEFAULT_BACKEND = 'https://erpfirma-backend.up.railway.app';
/** APK/EXE — nomi versiya bilan o'zgaradi, shuning uchun uzoq kesh; media ham o'zgarmaydi. */
const ONE_YEAR = 'public, max-age=31536000, immutable';
const ONE_DAY = 'public, max-age=86400, stale-while-revalidate=604800';

/** Backendga uzatiladigan yo'llar — API, sog'liq tekshiruvi, socket va yuklangan fayllar. */
const PROXY = ['/api/', '/socket.io/', '/uploads/', '/health', '/webhook'];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const backend = (env.BACKEND_URL || DEFAULT_BACKEND).replace(/\/+$/, '');

    // Owner 2026-10-27: server Render'dan Railway'ga ko'chdi. Ilova endi doim `erp-firma.uz` ga
    // murojaat qiladi, Worker esa so'rovni amaldagi backendga uzatadi — server yana ko'chsa,
    // ilovani qayta yig'ish shart emas, faqat shu yerdagi manzil o'zgaradi. CORS ham yo'qoladi
    // (hammasi bitta manzil), WebSocket (socket.io) ham shu yo'l bilan o'tadi.
    if (PROXY.some((p) => url.pathname === p || url.pathname.startsWith(p))) {
      const target = backend + url.pathname + url.search;
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.set('x-forwarded-host', url.host);
      headers.set('x-forwarded-proto', 'https');
      return fetch(target, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual',
      });
    }

    if (url.pathname.startsWith('/files/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      // /files/<nom> → <backend>/uploads/<nom>
      const target = `${backend}/uploads/${url.pathname.slice('/files/'.length)}${url.search}`;

      const cache = caches.default;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      const hit = await cache.match(cacheKey);
      if (hit) return hit;

      const upstream = await fetch(target, {
        method: 'GET',
        headers: { 'user-agent': request.headers.get('user-agent') || 'QurilishERP-Worker' },
        // Cloudflare chetida ham saqlanadi — bir xil fayl Render'dan qayta so'ralmaydi
        cf: { cacheEverything: true, cacheTtl: 86400 },
      });
      if (!upstream.ok) return new Response('Topilmadi', { status: upstream.status });

      const isApp = /\.(apk|exe|msi|dmg)$/i.test(url.pathname);
      const res = new Response(upstream.body, upstream);
      res.headers.set('Cache-Control', isApp ? ONE_YEAR : ONE_DAY);
      res.headers.set('Access-Control-Allow-Origin', '*');
      res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      res.headers.delete('set-cookie');
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
    }

    return env.ASSETS.fetch(request);
  },
};
