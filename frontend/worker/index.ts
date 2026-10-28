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

    // Sayt YAGONA manzildan ishlaydi: www.erp-firma.uz → erp-firma.uz (2026-10-28).
    // Ikki manzil yonma-yon ishlaganda sahifa www'dan ochilib, API va socket esa
    // www'siz manzilga ulanardi — bu ortiqcha cross-origin va chalkashlik edi
    // (brauzer konsolida www manzilidagi so'rovlar uzilib turardi).
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    const backend = (env.BACKEND_URL || DEFAULT_BACKEND).replace(/\/+$/, '');

    // Owner 2026-10-27: server Render'dan Railway'ga ko'chdi. Ilova endi doim `erp-firma.uz` ga
    // murojaat qiladi, Worker esa so'rovni amaldagi backendga uzatadi — server yana ko'chsa,
    // ilovani qayta yig'ish shart emas, faqat shu yerdagi manzil o'zgaradi. CORS ham yo'qoladi
    // (hammasi bitta manzil), WebSocket (socket.io) ham shu yo'l bilan o'tadi.
    if (PROXY.some((p) => url.pathname === p || url.pathname.startsWith(p))) {
      const target = backend + url.pathname + url.search;
      // MUHIM: so'rovni qismlardan qayta yig'ish MUMKIN EMAS — WebSocket "upgrade"
      // shunda yo'qoladi va socket.io 400 qaytarib, uzluksiz qayta ulanish
      // halqasiga tushadi (butun sayt/ilova sekinlashadi, 2026-10-28). Asl
      // so'rovning o'zidan nusxa olinsa, upgrade ham, oqim ko'rinishidagi tana
      // ham o'z holicha o'tadi.
      const proxied = new Request(target, request);
      proxied.headers.set('x-forwarded-host', url.host);
      proxied.headers.set('x-forwarded-proto', 'https');
      return fetch(proxied);
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
