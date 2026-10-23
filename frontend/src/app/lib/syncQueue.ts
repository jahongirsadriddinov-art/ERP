// Oflayn navbat (api.ts) qayta yuborish qoidalari — sof funksiyalar (sinovlanadi).
//
// XATO TUZATILDI ("1 ta o'zgarish yuborilishini kutmoqda" abadiy turadi): avval
//  • tarmoq xatosi (TypeError — masalan proksi 413/CORS bilan uzib qo'ysa) urinishlar soniga qo'shilmasdi va navbat
//    boshida turib qolib, keyingi hamma yozuvlarni ham to'sardi — har 30 s'da jimgina takror, abadiy;
//  • 5xx/409/429 — 20 marta jim urinib, keyin yozuv IZSIZ o'chirilardi (ma'lumot yo'qolardi, sababi noma'lum).
// Endi: har bir urinish hisoblanadi; qaytmas xato (4xx) yoki urinishlar tugasa — yozuv "xato" (failed) deb
// sababi bilan belgilanadi, avtomatik qayta yuborilmaydi va foydalanuvchiga ko'rsatiladi ("Qayta urinish",
// "Batafsil" → bekor qilish). Navbatni boshqa yozuvlar uchun to'smaydi.

import type { QueuedItem } from './offlineStore';

export const MAX_ATTEMPTS = 8;

export type ReplayOutcome =
  | { action: 'done' }
  | { action: 'retry'; reason: string }
  | { action: 'failed'; reason: string };

/** Javob statusi (yoki tarmoq xatosi: status = 0) bo'yicha keyingi qadam. */
export function classifyReplay(status: number, attemptsAfter: number, serverError?: string): ReplayOutcome {
  const why = (s: string) => (serverError ? `${s}: ${String(serverError).slice(0, 160)}` : s);
  if (status >= 200 && status < 300) return { action: 'done' };
  // Shu kalit hali bajarilmoqda / juda ko'p so'rov / vaqt tugadi / server xatosi — vaqtinchalik
  const transient = status === 0 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  if (transient) {
    const reason = status === 0 ? "Server bilan aloqa yo'q" : why(`Server xatosi (${status})`);
    return attemptsAfter >= MAX_ATTEMPTS ? { action: 'failed', reason: `${reason} — ${MAX_ATTEMPTS} marta urinildi` } : { action: 'retry', reason };
  }
  if (status === 401) return { action: 'failed', reason: why('Kirish muddati tugagan (401) — qayta kiring') };
  if (status === 403) return { action: 'failed', reason: why('Ruxsat yo\'q (403)') };
  if (status === 404) return { action: 'failed', reason: why('Topilmadi (404) — yozuv o\'chirilgan bo\'lishi mumkin') };
  if (status === 413) return { action: 'failed', reason: 'Fayl juda katta (413)' };
  return { action: 'failed', reason: why(`Server qabul qilmadi (${status})`) };
}

/** Navbat holati: yuborilishi kutilayotganlar va xato bilan to'xtaganlar. */
export function summarizeQueue(items: Pick<QueuedItem, 'failed'>[]): { pending: number; failed: number } {
  let pending = 0, failed = 0;
  for (const it of items) { if (it.failed) failed++; else pending++; }
  return { pending, failed };
}

/** Avtomatik yuboriladiganlar (xato deb belgilanganlar emas), vaqt tartibida. */
export const replayable = <T extends Pick<QueuedItem, 'failed' | 'ts'>>(items: T[]): T[] =>
  items.filter((i) => !i.failed).sort((a, b) => a.ts - b.ts);

const LABELS: Array<[RegExp, string]> = [
  [/^\/api\/transactions\/[^/]+\/(confirm|approve|reject)/, 'Tasdiqlash/rad etish'],
  [/^\/api\/transactions/, 'Moliya yozuvi (chiqim/kirim/o\'tkazma)'],
  [/^\/api\/attendance/, 'Davomat'],
  [/^\/api\/messages/, 'Xabar'],
  [/^\/api\/groups/, 'Guruh'],
  [/^\/api\/objects/, 'Obyekt'],
  [/^\/api\/materials/, 'Material'],
  [/^\/api\/equipment/, 'Jihoz'],
  [/^\/api\/documents/, 'Hujjat'],
  [/^\/api\/daily-reports/, 'Kunlik hisobot'],
  [/^\/api\/users/, 'Xodim'],
  [/^\/api\/payroll/, 'Oylik'],
];

/** Foydalanuvchiga tushunarli nom: "Moliya yozuvi — qo'shish". */
export function queueItemLabel(item: Pick<QueuedItem, 'url' | 'method' | 'label'>): string {
  if (item.label) return item.label;
  let path = item.url;
  try { path = new URL(item.url, 'http://x').pathname; } catch { /* */ }
  const base = LABELS.find(([re]) => re.test(path))?.[1] || path.replace(/^\/api\//, '').split('/')[0] || 'Amal';
  const verb = item.method === 'DELETE' ? "o'chirish" : item.method === 'POST' ? "qo'shish" : "o'zgartirish";
  return `${base} — ${verb}`;
}

export type SyncView = 'hidden' | 'offline' | 'error' | 'syncing' | 'pending' | 'synced';

/** Qaysi holat ko'rsatiladi — ilova navbati (api.ts) va service worker navbati birlashtiriladi. */
export function syncView(s: { offline: boolean; app: { count: number; failed: number; status: string }; sw: { count: number; status: string } }): { view: SyncView; pending: number; failed: number } {
  const pending = (s.app.count || 0) + (s.sw.count || 0);
  const failed = s.app.failed || 0;
  if (s.offline) return { view: 'offline', pending, failed };
  if (s.app.status === 'syncing' || s.sw.status === 'syncing') return { view: 'syncing', pending, failed };
  if (failed > 0) return { view: 'error', pending, failed };
  if (pending > 0) return { view: 'pending', pending, failed };
  if (s.app.status === 'synced' || s.sw.status === 'synced') return { view: 'synced', pending, failed };
  return { view: 'hidden', pending, failed };
}
