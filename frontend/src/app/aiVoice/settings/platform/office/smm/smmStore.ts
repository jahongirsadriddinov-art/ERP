// SMM rasm/videolari — QURILMADA saqlanadi (owner 2026-10-23: "server emas, qurilma"). IndexedDB ("aiOffice.smm");
// serverdagi post faqat shu yerdagi id'ga havola qiladi (metama'lumot). IndexedDB bo'lmasa (maxfiy oyna) — shu seans xotirasida.
// O'lcham ko'rsatiladi, o'chirish va "kompyuterga saqlash" (yuklab olish) mavjud.

export interface SmmLocal { id: string; kind: "image" | "video"; mime: string; size: number; w?: number; h?: number; source: string; taskId?: string; index?: number; title?: string; added: number }
const DB = "aiOffice.smm", STORE = "media", VER = 1;
const mem = new Map<string, { meta: SmmLocal; blob: Blob }>();

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "meta.id" }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
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

export const newMediaId = () => `loc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => { try { f(); } catch { /* */ } });

export const smmStore = {
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  async put(blob: Blob, meta: Omit<SmmLocal, "id" | "size" | "mime" | "added"> & { id?: string }): Promise<SmmLocal> {
    const m: SmmLocal = { ...meta, id: meta.id || newMediaId(), mime: blob.type || (meta.kind === "video" ? "video/webm" : "image/jpeg"), size: blob.size, added: Date.now() };
    mem.set(m.id, { meta: m, blob });
    await tx("readwrite", (s) => s.put({ meta: m, blob }));
    emit();
    return m;
  },
  async get(id: string): Promise<{ meta: SmmLocal; blob: Blob } | null> {
    const hit = mem.get(id);
    if (hit) return hit;
    const r = await tx<{ meta: SmmLocal; blob: Blob }>("readonly", (s) => s.get(id) as IDBRequest<{ meta: SmmLocal; blob: Blob }>);
    if (r) mem.set(id, r);
    return r || null;
  },
  async list(): Promise<SmmLocal[]> {
    const rows = (await tx<{ meta: SmmLocal }[]>("readonly", (s) => s.getAll() as IDBRequest<{ meta: SmmLocal }[]>)) || [];
    const all = new Map<string, SmmLocal>();
    for (const r of rows) all.set(r.meta.id, r.meta);
    for (const v of mem.values()) all.set(v.meta.id, v.meta);
    return [...all.values()].sort((a, b) => b.added - a.added);
  },
  async remove(id: string) {
    mem.delete(id);
    const u = urls.get(id);
    if (u) { URL.revokeObjectURL(u); urls.delete(id); }
    await tx("readwrite", (s) => s.delete(id));
    emit();
  },
};

const urls = new Map<string, string>();
/** Qurilmadagi fayl uchun blob: URL (bir marta yaratiladi). null — bu qurilmada yo'q. */
export async function smmUrl(id: string): Promise<string | null> {
  const u = urls.get(id);
  if (u) return u;
  const r = await smmStore.get(id);
  if (!r) return null;
  const n = URL.createObjectURL(r.blob);
  urls.set(id, n);
  return n;
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  const u = URL.createObjectURL(blob);
  a.href = u;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

export const extOf = (mime: string) => (mime === "video/mp4" ? "mp4" : mime === "video/webm" ? "webm" : mime === "image/png" ? "png" : "jpg");
export const fmtBytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
