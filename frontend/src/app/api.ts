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

// Qurilma belgilari (bepul sinovni bitta qurilmaga bir marta berish uchun): doimiy ID va qurilma "barmoq izi"
// (ekran, tizim, brauzer, grafik karta — xotira tozalansa ham o'zgarmaydi). Shaxsiy ma'lumot yig'ilmaydi — faqat xesh.
export const DEVICE_ID: string = (() => {
  try {
    let id = localStorage.getItem('erp_device_id') || (document.cookie.match(/(?:^|; )erp_did=([^;]+)/) || [])[1] || '';
    if (!/^[A-Za-z0-9_-]{16,}$/.test(id)) id = 'd_' + Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('erp_device_id', id);
    document.cookie = `erp_did=${id}; max-age=${5 * 365 * 86400}; path=/; SameSite=Lax`;
    return id;
  } catch { return ''; }
})();
let DEVICE_FP = '';
(async () => {
  try {
    const n: any = navigator;
    let gl = '';
    try { const c = document.createElement('canvas').getContext('webgl') as any; const ext = c?.getExtension('WEBGL_debug_renderer_info'); gl = ext ? `${c.getParameter(ext.UNMASKED_VENDOR_WEBGL)}|${c.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : ''; } catch { /* */ }
    let cv = '';
    try { const c = document.createElement('canvas'); c.width = 220; c.height = 40; const x = c.getContext('2d')!; x.textBaseline = 'top'; x.font = "16px 'Arial'"; x.fillStyle = '#f60'; x.fillRect(10, 5, 90, 20); x.fillStyle = '#069'; x.fillText('QurilishERP ✓ 2026', 4, 12); cv = c.toDataURL(); } catch { /* */ }
    const raw = [n.platform, n.hardwareConcurrency, n.deviceMemory, screen.width + 'x' + screen.height, screen.colorDepth, window.devicePixelRatio,
      Intl.DateTimeFormat().resolvedOptions().timeZone, (n.languages || []).join(','), n.maxTouchPoints, gl, cv].join('§');
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    DEVICE_FP = 'f_' + Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
  } catch { /* */ }
})();

export const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:5000';

/** Nisbiy yo'lni to'liq API URL ga aylantiradi. Misol: api('/api/objects') */
export const api = (path: string): string =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

import { queueAdd, queueAll, queueRemove, queueUpdate, serializeBody, deserializeBody, cachePut, cacheGet, type QueuedItem } from './lib/offlineStore';

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
// 2026-10-19 (owner: "oflayn rejim — hamma funksiya ishlasin"): navbat IndexedDB'da (lib/offlineStore) — rasm va
// fayllar ham saqlanadi; deyarli barcha o'zgartiruvchi amallar (POST/PUT/PATCH/DELETE) navbatga olinadi. Kirish,
// to'lov, real vaqt (qo'ng'iroq) kabi faqat onlayn ma'noli yo'llar bundan mustasno. Har bir amal birinchi
// urinishdanoq X-Idempotency-Key bilan boradi — javob yo'lda yo'qolsa ham server uni ikki marta bajarmaydi.
const LEGACY_QUEUE_KEY = 'erp_offline_queue_v1';
const NOT_QUEUEABLE = [
  /^\/api\/auth/, /^\/api\/register/, /^\/api\/payments/, /^\/api\/admin\/subscriptions/, /^\/api\/pin/,
  /^\/api\/sessions/, /^\/api\/ai-voice/, /^\/api\/ai\//, /^\/api\/calls/, /^\/api\/push/, /^\/api\/errors/,
  /^\/api\/qr/, /^\/api\/promocodes/, /^\/api\/smeta\/parse/, /^\/api\/dev\//, /^\/api\/companies/, /^\/api\/admin/,
  /^\/api\/messages\/read/, /^\/api\/notifications/, /^\/api\/gps/,
  /^\/api\/import/, /^\/api\/insights/, /^\/api\/objects\/[^/]+\/(media\/[^/]+\/analyze|client-link)/,
];
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let queueCount = 0;
try { queueCount = Number(localStorage.getItem('erp_offline_queue_count') || 0) || 0; } catch { /* */ }
const setCount = (n: number) => { queueCount = n; try { localStorage.setItem('erp_offline_queue_count', String(n)); } catch { /* */ } };
const emitQueue = (status: 'pending' | 'syncing' | 'synced' | 'idle') => {
  try { window.dispatchEvent(new CustomEvent('erp:offline-queue', { detail: { count: queueCount, status } })); } catch { /* */ }
};
export const offlineQueueCount = () => queueCount;
const refreshCount = async () => { try { setCount((await queueAll()).length); } catch { /* */ } };

function pathOf(url: string): string {
  return url.slice(API_BASE.length).split('?')[0];
}
function isQueueable(url: string, init?: RequestInit) {
  const method = (init?.method || 'GET').toUpperCase();
  if (!MUTATING.has(method) || url.indexOf(API_BASE) !== 0) return false;
  const p = pathOf(url);
  if (!p.startsWith('/api/')) return false;
  return !NOT_QUEUEABLE.some(re => re.test(p));
}
const newId = () => `off_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

async function enqueue(url: string, init: RequestInit, id: string): Promise<Response> {
  const body = await serializeBody(init.body as any);
  if (!body) throw new TypeError('offline: bu turdagi so\'rovni saqlab bo\'lmaydi');
  await queueAdd({ id, url, method: (init.method || 'POST').toUpperCase(), body, ts: Date.now(), attempts: 0 });
  await refreshCount();
  emitQueue('pending');
  let echo: any = {};
  if (body.kind === 'json') { try { echo = JSON.parse(body.text); } catch { /* */ } }
  // Chaqiruvchi (masalan handleAddExpense) ro'yxatga vaqtinchalik yozuv qo'sha olishi uchun — server javobiga o'xshash
  return new Response(JSON.stringify({ ...(echo && typeof echo === 'object' ? echo : {}), _id: id, id, queued: true, offline: true, status: echo?.status || 'pending', ok: true }),
    { status: 202, headers: { 'Content-Type': 'application/json', 'X-Offline-Queued': '1' } });
}

// Eski (localStorage) navbatdagi yozuvlar yangi navbatga ko'chiriladi — hech narsa yo'qolmaydi
async function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_QUEUE_KEY);
    if (!raw) return;
    const old: Array<{ id: string; url: string; body: string; ts: number }> = JSON.parse(raw) || [];
    for (const o of old) await queueAdd({ id: o.id, url: o.url, method: 'POST', body: { kind: 'json', text: o.body }, ts: o.ts, attempts: 0 });
    localStorage.removeItem(LEGACY_QUEUE_KEY);
    await refreshCount();
  } catch { /* */ }
}

let flushing = false;
async function flushQueue(orig: typeof fetch) {
  if (flushing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  let items: QueuedItem[] = [];
  try { items = await queueAll(); } catch { return; }
  if (!items.length) { if (queueCount) { setCount(0); emitQueue('idle'); } return; }
  flushing = true;
  emitQueue('syncing');
  let failed = false;
  try {
    for (const item of items) {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'X-Idempotency-Key': item.id, 'X-Client': CLIENT_KIND, 'X-Offline-Replay': '1' };
      if (item.body.kind === 'json') headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      let r: Response;
      try {
        r = await orig(item.url, { method: item.method, body: deserializeBody(item.body), headers });
      } catch { failed = true; break; }
      // 5xx / 409 (shu kalit hali bajarilmoqda) / 429 — keyinroq yana; 2xx va boshqa 4xx — navbatdan chiqariladi
      if (r.status >= 500 || r.status === 409 || r.status === 429) {
        item.attempts += 1;
        if (item.attempts >= 20) await queueRemove(item.id).catch(() => undefined);
        else await queueUpdate(item).catch(() => undefined);
        failed = true; break;
      }
      await queueRemove(item.id).catch(() => undefined);
      if (r.status >= 400) {
        try { window.dispatchEvent(new CustomEvent('erp:offline-rejected', { detail: { url: item.url, status: r.status } })); } catch { /* */ }
      }
    }
  } finally {
    flushing = false;
    await refreshCount();
    emitQueue(queueCount ? 'pending' : failed ? 'pending' : 'synced');
    if (!queueCount && !failed) { try { window.dispatchEvent(new CustomEvent('erp:offline-synced')); } catch { /* */ } }
  }
}

// ── O'qish keshi (ilovalar: Windows/Android'da SW yo'q) — GET javoblari foydalanuvchi bo'yicha saqlanadi ──
const CACHE_GET = [/^\/api\/(objects|users|transactions|materials|equipment|documents|payroll|attendance|messages|groups|company|dashboard|notifications\/unread-count|announcements|safety|sign-docs)/];
function cacheKeyFor(url: string): string | null {
  if (url.indexOf(API_BASE) !== 0) return null;
  const p = pathOf(url);
  if (!CACHE_GET.some(re => re.test(p))) return null;
  const tok = localStorage.getItem('token') || '';
  if (!tok) return null;
  return `${tok.slice(-24)}|${url.slice(API_BASE.length)}`;
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
  setTimeout(() => { void migrateLegacy().then(refreshCount).then(() => emitQueue(queueCount ? 'pending' : 'idle')); }, 500);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (typeof input === 'string' && isQueueable(rawUrl, init)) {
      const id = newId();
      const headers = new Headers(init?.headers);
      if (!headers.has('X-Idempotency-Key')) headers.set('X-Idempotency-Key', id);
      headers.set('X-Offline-Queue', 'app');   // web'da SW bu so'rovni o'zi navbatga olmasin (navbat shu yerda)
      const init2: RequestInit = { ...init, headers };
      if (navigator.onLine === false) return enqueue(rawUrl, init2, headers.get('X-Idempotency-Key') || id);
      try {
        return await authFetch(input, init2);
      } catch (err) {
        // Tarmoq xatosi (server javob bermadi) — navbatga olinadi; saqlab bo'lmasa asl xato
        if (err instanceof TypeError) {
          try { return await enqueue(rawUrl, init2, headers.get('X-Idempotency-Key') || id); } catch { throw err; }
        }
        throw err;
      }
    }
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const ck = method === 'GET' && typeof input === 'string' ? cacheKeyFor(rawUrl) : null;
    if (!ck) return authFetch(input, init);
    try {
      const res = await authFetch(input, init);
      if (res.ok) res.clone().text().then(t => cachePut(ck, t)).catch(() => {});
      return res;
    } catch (err) {
      const hit = await cacheGet(ck);
      if (hit) return new Response(hit.text, { status: 200, headers: { 'Content-Type': 'application/json', 'X-Offline-Cache': String(hit.at) } });
      throw err;
    }
  };
  function isOwnApiUrl(u: string): boolean {
    try {
      const base = new URL(API_BASE || window.location.origin, window.location.href);
      const target = new URL(u, window.location.href);
      return target.origin === base.origin && target.pathname.startsWith(base.pathname.replace(/\/$/, '') || '/');
    } catch { return false; }
  }
  async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let isOwnApi = false;
    try {
      const url =
        typeof input === 'string' ? input :
        input instanceof URL ? input.href :
        (input as Request).url;
      // Faqat o'z API'imizga (API_BASE) yuborilgan so'rovlarga token qo'shamiz. XAVFSIZLIK (audit 2026-10-19):
      // satr prefiksi emas — origin aniq solishtiriladi ("…onrender.com.evil.com" ga token ketmasin).
      if (url && isOwnApiUrl(url)) {
        isOwnApi = true;
        const token = localStorage.getItem('token');
        const headers = new Headers(
          init?.headers || (input instanceof Request ? input.headers : undefined)
        );
        if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
        // Sayt va ilova texnik ishlar rejimida ALOHIDA boshqariladi — backend qaysi biri ekanini shundan biladi
        if (!headers.has('X-Client')) headers.set('X-Client', CLIENT_KIND);
        if (DEVICE_ID) headers.set('X-Device-Id', DEVICE_ID);
        if (DEVICE_FP) headers.set('X-Device-Fp', DEVICE_FP);
        init = { ...init, headers };
      }
    } catch {
      /* interceptor hech qachon asosiy fetch'ni sindirmasin */
    }
    const res = await orig(input as any, init);
    // Ish jarayonida texnik ishlar yoqilsa — ilova/sayt darhol "texnik ishlar" ekraniga o'tsin
    if (isOwnApi && res.status === 423) window.dispatchEvent(new CustomEvent('erp:checkin-required'));
    // Hisob o'chirilgan / sessiya bekor / token yaroqsiz (masalan dasturchi firmani o'chirdi) — darhol chiqish
    if (isOwnApi && res.status === 401) {
      res.clone().json().then(d => {
        if (d?.accountGone || d?.sessionRevoked || d?.tokenInvalid) window.dispatchEvent(new CustomEvent('erp:session-ended'));
      }).catch(() => {});
    }
    if (isOwnApi && res.status === 402) {
      res.clone().json().then(d => {
        if (!d?.subscriptionStatus) return;
        try { sessionStorage.setItem('erp_subBlocked', String(d.subscriptionStatus)); } catch { /* ixtiyoriy */ }
        window.dispatchEvent(new CustomEvent('erp:subscription-blocked'));
      }).catch(() => {});
    }
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
