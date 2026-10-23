// Oflayn ombor (owner 2026-10-19: "oflayn rejimni kuchaytir, hamma funksiya ishlasin"): IndexedDB — localStorage'dan
// farqli o'laroq rasm/fayl (Blob) ham saqlay oladi va hajmi katta. Ikki do'kon:
//  • queue — internetsiz qilingan amallar (internet qaytganda tartib bilan yuboriladi);
//  • cache — avval ochilgan GET javoblari (ilovada internet yo'q bo'lsa ko'rsatiladi), foydalanuvchi bo'yicha.

export type QueuedBody =
  | { kind: 'json'; text: string }
  | { kind: 'form'; parts: Array<{ name: string; value: string } | { name: string; blob: Blob; filename: string }> }
  | { kind: 'none' };

export interface QueuedItem {
  id: string;            // X-Idempotency-Key ham shu
  url: string;
  method: string;
  body: QueuedBody;
  ts: number;
  attempts: number;
  label?: string;
  /** Qaytmas xato (4xx) yoki urinishlar tugadi — avtomatik yuborilmaydi, foydalanuvchi hal qiladi */
  failed?: boolean;
  lastError?: string;
  lastStatus?: number;
}

const DB_NAME = 'erp-offline';
const DB_VER = 1;
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then((d) => new Promise<T | undefined>((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const queueAdd = (item: QueuedItem) => tx('queue', 'readwrite', (s) => { s.put(item); });
export const queueRemove = (id: string) => tx('queue', 'readwrite', (s) => { s.delete(id); });
export const queueUpdate = (item: QueuedItem) => tx('queue', 'readwrite', (s) => { s.put(item); });
export async function queueAll(): Promise<QueuedItem[]> {
  const all = (await tx<QueuedItem[]>('queue', 'readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => a.ts - b.ts);
}

const CACHE_MAX_BYTES = 512 * 1024;   // bitta javob — 512 KB gacha
export async function cachePut(key: string, text: string): Promise<void> {
  if (text.length > CACHE_MAX_BYTES) return;
  await tx('cache', 'readwrite', (s) => { s.put({ key, text, at: Date.now() }); }).catch(() => undefined);
}
export async function cacheGet(key: string): Promise<{ text: string; at: number } | null> {
  const r = await tx<any>('cache', 'readonly', (s) => s.get(key)).catch(() => undefined);
  return r && typeof r.text === 'string' ? { text: r.text, at: Number(r.at) || 0 } : null;
}
/** Chiqishda (logout) — boshqa foydalanuvchi oldingisining ma'lumotini ko'rmasin. */
export const cacheClear = () => tx('cache', 'readwrite', (s) => { s.clear(); }).catch(() => undefined);

export async function serializeBody(body: BodyInit | null | undefined): Promise<QueuedBody | null> {
  if (body == null) return { kind: 'none' };
  if (typeof body === 'string') return { kind: 'json', text: body };
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const parts: Extract<QueuedBody, { kind: 'form' }>['parts'] = [];
    let total = 0;
    for (const [name, v] of (body as any).entries() as Iterable<[string, FormDataEntryValue]>) {
      if (typeof v === 'string') parts.push({ name, value: v });
      else {
        total += v.size;
        parts.push({ name, blob: v, filename: (v as File).name || 'file' });
      }
    }
    if (total > 60 * 1024 * 1024) return null;   // juda katta (video) — navbatga olinmaydi
    return { kind: 'form', parts };
  }
  return null;   // boshqa turdagi tana — navbatga olinmaydi
}

export function deserializeBody(b: QueuedBody): BodyInit | undefined {
  if (b.kind === 'none') return undefined;
  if (b.kind === 'json') return b.text;
  const fd = new FormData();
  for (const p of b.parts) {
    if ('blob' in p) fd.append(p.name, p.blob, p.filename);
    else fd.append(p.name, p.value);
  }
  return fd;
}
