// AI ofis — shu kompyuterda saqlanadigan musiqa/videolar (owner 2026-10-23): katta fayl serverga yuklanmaydi — tanlangan
// zahoti URL.createObjectURL bilan o'ynaydi va (xohlasa) IndexedDB'da saqlanadi ("Bu kompyuterda saqlangan"). Serverga faqat
// "Serverga yuklash" bosilsa. IndexedDB bo'lmasa (maxfiy oyna) — faqat shu seans davomida.

export interface LocalItem { id: string; name: string; size: number; type: string; kind: "audio" | "video"; added: number }
const DB = "aiOffice.media", STORE = "files", VER = 1;
const mem = new Map<string, { meta: LocalItem; blob: Blob }>();

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "meta.id" }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const q = fn(db.transaction(STORE, mode).objectStore(STORE));
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
};

export const localMedia = {
  async add(file: File, kind: "audio" | "video", keep: boolean): Promise<LocalItem> {
    const meta: LocalItem = { id: Math.random().toString(36).slice(2, 12), name: file.name.replace(/\.[^.]+$/, "").slice(0, 120), size: file.size, type: file.type, kind, added: Date.now() };
    mem.set(meta.id, { meta, blob: file });
    if (keep) await tx("readwrite", (s) => s.put({ meta, blob: file }));
    return meta;
  },
  async list(kind?: "audio" | "video"): Promise<LocalItem[]> {
    const rows = (await tx<{ meta: LocalItem }[]>("readonly", (s) => s.getAll() as IDBRequest<{ meta: LocalItem }[]>)) || [];
    const all = new Map<string, LocalItem>();
    for (const r of rows) all.set(r.meta.id, r.meta);
    for (const v of mem.values()) all.set(v.meta.id, v.meta);
    return [...all.values()].filter((x) => !kind || x.kind === kind).sort((a, b) => a.added - b.added);
  },
  async blob(id: string): Promise<Blob | null> {
    const m = mem.get(id);
    if (m) return m.blob;
    const r = await tx<{ meta: LocalItem; blob: Blob }>("readonly", (s) => s.get(id) as IDBRequest<{ meta: LocalItem; blob: Blob }>);
    if (r) mem.set(id, r);
    return r?.blob || null;
  },
  async remove(id: string) { mem.delete(id); revoke(id); await tx("readwrite", (s) => s.delete(id)); },
};

const urls = new Map<string, string>();
/** Mahalliy fayl uchun (bir marta yaratiladigan) blob: URL. */
export async function localUrl(id: string): Promise<string | null> {
  const u = urls.get(id);
  if (u) return u;
  const b = await localMedia.blob(id);
  if (!b) return null;
  const n = URL.createObjectURL(b);
  urls.set(id, n);
  return n;
}
function revoke(id: string) { const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); } }
export const fmtSize = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
/** Serverga yuklash chegarasi (/api/messages/upload — 60 MB). */
export const UPLOAD_LIMIT = 60 * 1024 * 1024;
