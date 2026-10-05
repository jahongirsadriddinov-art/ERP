// ─── API base ────────────────────────────────────────────────────────────────
// Production (hozir: erp-ebon-seven-91.vercel.app → qurilisherp-backend.onrender.com)
// va local o'rtasida sozlanadigan baza. .env / .env.production dagi
// VITE_API_URL orqali boshqariladi — domen hech qayerda qattiq yozilmagan.
// Qaysi mijoz: Windows ilova (Tauri), Android ilova (Capacitor) yoki sayt
export const CLIENT_KIND: string = (() => {
  try {
    const w = window as any;
    if (w.__TAURI_INTERNALS__) return 'app-windows';
    if (w.Capacitor?.isNativePlatform?.()) return `app-${w.Capacitor.getPlatform?.() || 'android'}`;
  } catch { /* */ }
  return 'web';
})();

export const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:5000';

/** Nisbiy yo'lni to'liq API URL ga aylantiradi. Misol: api('/api/objects') */
export const api = (path: string): string =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

// ─── Auth interceptor ────────────────────────────────────────────────────────
// Barcha API_BASE so'rovlariga localStorage'dagi JWT tokenni avtomatik qo'shadi.
// Shu tufayli App.tsx dagi yuzlab inline fetch'larni o'zgartirmasdan turib,
// backend tenant izolyatsiyasi ishlaydi. Bir marta o'rnatiladi (idempotent).
// ─── Oflayn navbat (asosan ilovalar uchun) ───────────────────────────────────
// Web'da Service Worker (public/sw.js) internet yo'qda POST so'rovlarni navbatga oladi.
// Windows ilovasida (Tauri) SW umuman ishlamaydi, Android'da ham kafolat yo'q — shu sabab
// shu yerda ham xuddi o'sha naqsh: obyektdagi ishchi internet yo'qda chiqim, xabar yoki
// davomatni yuborsa — qurilmada saqlanadi va internet qaytishi bilan o'zi yuboriladi.
// Takror yuborilmasligi uchun har bir yozuv o'z X-Idempotency-Key kaliti bilan boradi.
const QUEUE_KEY = 'erp_offline_queue_v1';
const QUEUEABLE = [/\/api\/transactions$/, /\/api\/messages$/, /\/api\/attendance\/[\w-]+$/];
type QueuedReq = { id: string; url: string; body: string; ts: number };
const readQueue = (): QueuedReq[] => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } };
const writeQueue = (q: QueuedReq[]) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* */ } };
const emitQueue = (status: 'pending' | 'syncing' | 'synced' | 'idle') => {
  try { window.dispatchEvent(new CustomEvent('erp:offline-queue', { detail: { count: readQueue().length, status } })); } catch { /* */ }
};
export const offlineQueueCount = () => readQueue().length;
function isQueueable(url: string, init?: RequestInit) {
  if ((init?.method || 'GET').toUpperCase() !== 'POST' || typeof init?.body !== 'string') return false;
  if (url.indexOf(API_BASE) !== 0) return false;
  // SW boshqarayotgan bo'lsa (web) — navbatni o'sha yuritadi, ikki marta saqlamaymiz
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) return false;
  const path = url.slice(API_BASE.length).split('?')[0];
  return QUEUEABLE.some(re => re.test(path));
}
function enqueue(url: string, body: string): Response {
  const id = `off_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  writeQueue([...readQueue(), { id, url, body, ts: Date.now() }].slice(-200));
  emitQueue('pending');
  let echo: any = {};
  try { echo = JSON.parse(body); } catch { /* */ }
  // Chaqiruvchi (masalan handleAddExpense) ro'yxatga vaqtinchalik yozuv qo'sha olishi uchun
  return new Response(JSON.stringify({ ...echo, _id: id, id, queued: true, offline: true, status: echo.status || 'pending' }),
    { status: 202, headers: { 'Content-Type': 'application/json' } });
}
let flushing = false;
async function flushQueue(orig: typeof fetch) {
  if (flushing || !readQueue().length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  flushing = true;
  emitQueue('syncing');
  let failed = false;
  try {
    for (const item of readQueue()) {
      const token = localStorage.getItem('token');
      let r: Response;
      try {
        r = await orig(item.url, {
          method: 'POST', body: item.body,
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': item.id, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
      } catch { failed = true; break; }
      if (r.status >= 500) { failed = true; break; }
      // 2xx — yuborildi; 4xx — qayta urinishdan foyda yo'q (masalan ruxsat) — navbatdan chiqariladi
      writeQueue(readQueue().filter(q => q.id !== item.id));
    }
  } finally {
    flushing = false;
    emitQueue(readQueue().length ? 'pending' : failed ? 'pending' : 'synced');
  }
}

let _authFetchInstalled = false;
function installAuthFetch() {
  if (_authFetchInstalled || typeof window === 'undefined' || !window.fetch) return;
  _authFetchInstalled = true;
  const orig = window.fetch.bind(window);
  const flush = () => { flushQueue(orig).catch(() => {}); };
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
  setInterval(flush, 30_000);
  setTimeout(flush, 3000);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (isQueueable(rawUrl, init)) {
      if (navigator.onLine === false) return Promise.resolve(enqueue(rawUrl, init!.body as string));
      return authFetch(input, init).catch(err => {
        // Tarmoq xatosi (server javob bermadi) — navbatga olinadi
        if (err instanceof TypeError) return enqueue(rawUrl, init!.body as string);
        throw err;
      });
    }
    return authFetch(input, init);
  };
  async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let isOwnApi = false;
    try {
      const url =
        typeof input === 'string' ? input :
        input instanceof URL ? input.href :
        (input as Request).url;
      // Faqat o'z API'imizga (API_BASE) yuborilgan so'rovlarga token qo'shamiz.
      if (url && url.indexOf(API_BASE) === 0) {
        isOwnApi = true;
        const token = localStorage.getItem('token');
        const headers = new Headers(
          init?.headers || (input instanceof Request ? input.headers : undefined)
        );
        if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
        // Sayt va ilova texnik ishlar rejimida ALOHIDA boshqariladi — backend qaysi biri ekanini shundan biladi
        if (!headers.has('X-Client')) headers.set('X-Client', CLIENT_KIND);
        init = { ...init, headers };
      }
    } catch {
      /* interceptor hech qachon asosiy fetch'ni sindirmasin */
    }
    const res = await orig(input as any, init);
    // Ish jarayonida texnik ishlar yoqilsa — ilova/sayt darhol "texnik ishlar" ekraniga o'tsin
    if (isOwnApi && res.status === 503) {
      res.clone().json().then(d => { if (d?.maintenance) window.dispatchEvent(new CustomEvent('erp:maintenance')); }).catch(() => {});
    }
    return res;
  };
}
installAuthFetch();

// ─── Backend keep-alive ping (Render.com free tier 15-min spindown'ga qarshi) ─
// Har 14 daqiqada /health ga so'rov yuboriladi — server uyquga ketmaydi.
// Faqat production'da ishlaydi (localhost'da shart emas).
(function startKeepAlivePing() {
  if (typeof window === 'undefined') return;
  if (API_BASE.includes('localhost') || API_BASE.includes('127.0.0.1')) return;
  const ping = () => fetch(`${API_BASE}/health`, { method: 'GET' }).catch(() => {});
  ping(); // birinchi marta darhol
  setInterval(ping, 14 * 60 * 1000); // keyin har 14 daqiqada
})();

// ─── Chat media yuklash (blob emas — serverga, hamma ko'radi) ────────────────
export async function uploadChatMedia(
  file: File | Blob,
  filename?: string
): Promise<{ url: string; fileName?: string; fileSize?: number }> {
  const fd = new FormData();
  fd.append('file', file, filename || (file as File).name || 'media');
  const res = await fetch(api('/api/messages/upload'), { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Media yuklanmadi');
  const d = await res.json();
  // Cloudinary full URL bo'lsa prefix qo'shmaymiz, local relative bo'lsa qo'shamiz
  const finalUrl = d.url?.startsWith('http') ? d.url : `${API_BASE}${d.url}`;
  return { url: finalUrl, fileName: d.fileName, fileSize: d.fileSize };
}

// ─── Deterministik smeta parser (AI'siz, POST /api/smeta/parse) ──────────────
// Butun ParseResult qaytaradi: resources (guruhlangan), works (bo'limli), totals, meta.
export async function parseSmetaFile(file: File, objectId?: string): Promise<any> {
  const fd = new FormData();
  fd.append('smeta', file);
  if (objectId) fd.append('objectId', objectId);
  const res = await fetch(api('/api/smeta/parse'), { method: 'POST', body: fd });
  if (!res.ok) {
    let msg = 'Smeta o\'qilmadi';
    try { const d = await res.json(); msg = d.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// ─── Smeta upload (SSE) — bitta umumiy oqim ──────────────────────────────────
export interface SmetaUploadResult {
  ok: boolean;
  materials: any[];
  budget?: number;
  error?: string;
}

/**
 * Obyektga smeta faylini yuklaydi va SSE progress oqimini o'qiydi.
 * AddObjectModal va ObjectDetailPage ikkalasi ham shuni ishlatadi (dublikat yo'q).
 */
export async function uploadSmeta(
  objectId: string,
  file: File,
  onProgress?: (msg: string, percent: number) => void
): Promise<SmetaUploadResult> {
  const fd = new FormData();
  fd.append('smeta', file);

  let res: Response;
  try {
    res = await fetch(api(`/api/objects/${objectId}/smeta`), { method: 'POST', body: fd });
  } catch {
    return { ok: false, materials: [], error: 'Server bilan bog\'lanib bo\'lmadi' };
  }

  if (!res.ok || !res.body) {
    return { ok: false, materials: [], error: 'Xatolik yuz berdi' };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let materials: any[] = [];
  let budget: number | undefined;
  let error: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        const d = JSON.parse(line.slice(5).trim());
        if (d.ping) continue; // heartbeat
        if (d.msg && onProgress) onProgress(d.msg, d.percent ?? 0);
        else if (d.percent != null && onProgress) onProgress('', d.percent);
        if (d.error) error = d.msg || 'Xatolik yuz berdi';
        if (d.done) {
          materials = d.materials || [];
          budget = d.object?.budget;
        }
      } catch {
        /* to'liq bo'lmagan JSON bo'lagi — keyingi chunkda to'ldiriladi */
      }
    }
  }

  if (error && materials.length === 0) return { ok: false, materials: [], budget, error };
  if (materials.length === 0) {
    return { ok: false, materials: [], budget, error: error || 'Material topilmadi' };
  }
  return { ok: true, materials, budget };
}
