// Chek suratidan chiqimni o'qish (POST /api/transactions/scan-receipt) — tarmoqqa chidamli.
// Xato tuzatildi (error tracker: "API javob bermadi (tarmoq): POST /api/transactions/scan-receipt"): telefon
// fotosi og'ir yuklanar, server esa AI band bo'lsa daqiqalab javob bermasdi — proksi/mobil tarmoq so'rovni
// uzardi. Endi: surat kichraytiriladi (≤1600 px, JPEG 0.8), bosqichlar ko'rsatiladi, mijoz tomonda muddat
// (timeout) bor va natija aniq turga ajratiladi: muddat o'tdi / internet yo'q / bekor qilindi / qo'lda to'ldiring.
// Bekor qilish va oflayn — xato kuzatuvchiga yuborilmaydi (AbortError — TypeError emas; oflaynni api.ts biladi).

export type ScanStage = 'compress' | 'upload' | 'read';
export type ScanFailKind = 'timeout' | 'offline' | 'cancelled' | 'manual' | 'server';
export type ScanResult =
  | { ok: true; data: any }
  | { ok: false; kind: ScanFailKind; message: string };

export const SCAN_TIMEOUT_MS = 50_000; // server ~35 s ichida javob beradi; zaxira bilan
export const SCAN_MAX_DIM = 1600;
export const SCAN_QUALITY = 0.8;

export function scanFailMessage(kind: ScanFailKind, serverMsg?: string): string {
  switch (kind) {
    case 'timeout': return "Chekni o'qish juda uzoq davom etdi (internet sekin bo'lishi mumkin). Qayta urinib ko'ring yoki summani qo'lda kiriting.";
    case 'offline': return "Internet yo'q — chekni o'qib bo'lmaydi. Internet qaytgach qayta urinib ko'ring yoki summani qo'lda kiriting.";
    case 'cancelled': return '';
    case 'manual': return serverMsg || "Chekdan summani o'qib bo'lmadi — summani qo'lda to'ldiring.";
    default: return serverMsg || "Chekni o'qib bo'lmadi — qayta urinib ko'ring.";
  }
}

export interface ScanDeps {
  resize: (file: File, maxDim: number, quality: number) => Promise<string>;
  fetch: typeof fetch;
  url: string;
  isOnline?: () => boolean;
}

export async function scanReceiptFile(file: File, deps: ScanDeps, opts: { signal?: AbortSignal; timeoutMs?: number; onStage?: (s: ScanStage) => void } = {}): Promise<ScanResult> {
  const online = deps.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  let lastStage: ScanStage | null = null;
  const stage = (st: ScanStage) => { if (st !== lastStage) { lastStage = st; opts.onStage?.(st); } };
  const fail = (kind: ScanFailKind, serverMsg?: string): ScanResult => ({ ok: false, kind, message: scanFailMessage(kind, serverMsg) });
  if (!online()) return fail('offline');
  stage('compress');
  let dataUrl: string;
  try { dataUrl = await deps.resize(file, SCAN_MAX_DIM, SCAN_QUALITY); }
  catch { return fail('manual', "Suratni ochib bo'lmadi — boshqa surat tanlang yoki summani qo'lda kiriting."); }
  if (opts.signal?.aborted) return fail('cancelled');

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, opts.timeoutMs ?? SCAN_TIMEOUT_MS);
  const onOuterAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onOuterAbort);
  try {
    stage('upload');
    const req = deps.fetch(deps.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ image: dataUrl.split(',')[1] || '', mimeType: 'image/jpeg' }),
    });
    // Tana yuborilgach server AI bilan o'qiydi — foydalanuvchiga "o'qilmoqda" bosqichi
    const stageTimer = setTimeout(() => stage('read'), 1500);
    let r: Response;
    try { r = await req; } finally { clearTimeout(stageTimer); }
    stage('read');
    const d = await r.json().catch(() => ({} as any));
    if (r.ok) return { ok: true, data: d };
    if (r.status === 422 || d?.manual) return fail('manual', d?.error);
    return fail('server', d?.error);
  } catch {
    if (timedOut) return fail('timeout');
    if (opts.signal?.aborted) return fail('cancelled');
    if (!online()) return fail('offline');
    return fail('server', "Server bilan aloqa uzildi — qayta urinib ko'ring yoki summani qo'lda kiriting.");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}
