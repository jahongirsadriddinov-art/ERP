// ─── API base ────────────────────────────────────────────────────────────────
// Production (erp-firma.uz) va local o'rtasida sozlanadigan baza.
// .env / .env.production dagi VITE_API_URL orqali boshqariladi.
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
let _authFetchInstalled = false;
function installAuthFetch() {
  if (_authFetchInstalled || typeof window === 'undefined' || !window.fetch) return;
  _authFetchInstalled = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url =
        typeof input === 'string' ? input :
        input instanceof URL ? input.href :
        (input as Request).url;
      // Faqat o'z API'imizga (API_BASE) yuborilgan so'rovlarga token qo'shamiz.
      if (url && url.indexOf(API_BASE) === 0) {
        const token = localStorage.getItem('token');
        if (token) {
          const headers = new Headers(
            init?.headers || (input instanceof Request ? input.headers : undefined)
          );
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
            init = { ...init, headers };
          }
        }
      }
    } catch {
      /* interceptor hech qachon asosiy fetch'ni sindirmasin */
    }
    return orig(input as any, init);
  };
}
installAuthFetch();

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
  // To'liq (absolyut) URL saqlaymiz — qabul qiluvchi ham yuklay oladi
  return { url: `${API_BASE}${d.url}`, fileName: d.fileName, fileSize: d.fileSize };
}

// ─── Deterministik smeta parser (AI'siz, POST /api/smeta/parse) ──────────────
// Butun ParseResult qaytaradi: resources (guruhlangan), works (bo'limli), totals, meta.
export async function parseSmetaFile(file: File): Promise<any> {
  const fd = new FormData();
  fd.append('smeta', file);
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
