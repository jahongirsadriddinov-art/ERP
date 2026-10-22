import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import mongoose from 'mongoose';
import type { Request, Response, NextFunction } from 'express';
import ErrorEvent, { ErrorSource } from '../models/ErrorEvent';
import { checkRate } from '../utils/rateLimit';

// ─── Markaziy xato kuzatuvi (owner 2026-10-22) ───────────────────────────────────────────────
// Server (Express 5xx, ushlanmagan xato, process darajasi), bot, fon ishlari (worker) va frontend
// (JS xatosi, React qulashi, API muvaffaqiyatsizligi) xatolari BIR joyga — ErrorEvent kolleksiyasiga
// yoziladi. Bir xil xato fingerprint bo'yicha guruhlanadi (count/foydalanuvchilar soni). YANGI xato
// (yoki "Hal qilindi" deb belgilangani qaytsa) — dasturchiga Telegram botda qisqa, oddiy tilda xabar:
// qayerda (sahifa/marshrut/fayl:qator), nima, nechta foydalanuvchi, birinchi/oxirgi vaqt.
// Hech qachon o'zi xato tashlamaydi — kuzatuv ilovani buzmasligi kerak.

// ── Maxfiy ma'lumotni tozalash ──
const REDACTIONS: Array<[RegExp, string]> = [
  [/\b(mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|rediss|amqps?):\/\/[^\s:@/]+:[^\s@/]+@/gi, '$1://[redacted]@'],
  [/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '[bot-token]'],
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[jwt]'],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/([?&#](?:token|access_token|refresh_token|key|apikey|api_key|secret|password|pass|sig|signature|hash|otp|code)=)[^&\s#"']+/gi, '$1[redacted]'],
  [/\b(password|passwd|pwd|parol|pass|token|secret|api[_-]?key|apikey|authorization|otp|pin|pinHash|cookie|session[_-]?id)\b(["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi, '$1$2[redacted]'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[api-key]'],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[api-key]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/(?<![\w])\+?998[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g, '[phone]'],
  [/(?<![\w])\+\d[\d\s()-]{8,16}\d(?!\d)/g, '[phone]'],
  [/\b(?:\d{4}[ -]?){3}\d{4}\b/g, '[card]'],
];

export function redact(input: unknown, max = 4000): string {
  let s = typeof input === 'string' ? input : input == null ? '' : String(input);
  if (s.length > max * 2) s = s.slice(0, max * 2);
  for (const [re, rep] of REDACTIONS) s = s.replace(re, rep);
  return s.slice(0, max);
}

// ── Guruhlash ──
/** URL yo'lini shablonga aylantiradi: /api/objects/65ab…/x?y=1 → /api/objects/:id/x (ID/token/raqamlar yo'q). */
export function normalizePath(p: unknown): string {
  let s = String(p || '');
  try { if (/^https?:\/\//i.test(s)) s = new URL(s).pathname; } catch { /* */ }
  s = s.split(/[?#]/)[0] || '/';
  return s.split('/').map((seg) => {
    if (!seg) return seg;
    if (/^[0-9a-f]{24}$/i.test(seg)) return ':id';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':uuid';
    if (/^\d+$/.test(seg)) return ':n';
    if (seg.length >= 20 && /^[A-Za-z0-9_.~-]+$/.test(seg)) return ':token';
    return seg;
  }).join('/').slice(0, 200);
}

function normalizeMessage(m: string): string {
  return m
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
    .replace(/\b[0-9a-f]{24}\b/gi, 'ID')
    // Qiymat bo'lishi mumkin bo'lgan qo'shtirnoqli matnlar (raqamli yoki uzun) umumlashtiriladi; "reading 'x'" kabilar qoladi
    .replace(/(["'`])([^"'`]{0,120})\1/g, (all, q: string, inner: string) => (/\d/.test(inner) || inner.length > 24 ? `${q}…${q}` : all))
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

const CWD = process.cwd().replace(/\\/g, '/');
/** Stack'dan ilovaning o'z kodidagi birinchi qatorni topadi: "src/routes/objects.ts:120 (handler)". */
export function topFrame(stack?: string): string | undefined {
  if (!stack) return undefined;
  for (const raw of stack.split('\n').slice(1, 40)) {
    const line = raw.trim();
    if (!line.startsWith('at ') && !/@/.test(line)) continue;
    if (/node_modules|node:internal|\(node:|<anonymous>|native/.test(line)) continue;
    const m = line.match(/^at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/) || line.match(/^(?:(.*?)@)?(.+?):(\d+):(\d+)$/);
    if (!m) continue;
    let file = m[2].replace(/\\/g, '/').replace(/^file:\/\//, '');
    if (file.startsWith(CWD)) file = file.slice(CWD.length + 1);
    try { if (/^https?:\/\//.test(file)) file = new URL(file).pathname.replace(/^\//, ''); } catch { /* */ }
    const fn = m[1] ? ` (${m[1].replace(/^async\s+/, '').slice(0, 60)})` : '';
    return `${file}:${m[3]}${fn}`.slice(0, 200);
  }
  return undefined;
}

/** Fingerprint uchun kod joyi: qator raqami va bundle hash'isiz (har deploy'da o'zgaradi). */
function frameKey(frame?: string): string {
  if (!frame) return '';
  return frame.replace(/:\d+(?=\s|$)/, '').replace(/-[A-Za-z0-9_-]{6,12}(\.js)/, '$1');
}

function trimStack(stack?: string): string | undefined {
  if (!stack) return undefined;
  const lines = String(stack).split('\n').slice(0, 30).map((l) => l.replace(new RegExp(CWD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?', 'g'), ''));
  return redact(lines.join('\n').replace(/\\/g, '/'), 4000);
}

export interface CaptureInput {
  source: ErrorSource;
  kind?: string;
  message: string;
  stack?: string;
  componentStack?: string;
  route?: string;
  method?: string;
  status?: number;
  page?: string;
  action?: string;
  breadcrumbs?: string[];
  userId?: string;
  companyId?: string;
  role?: string;
  appVersion?: string;
  platform?: string;
  userAgent?: string;
  /** Telegram xabari yuborilmasin (masalan, mijoz xabar bergan 5xx — server allaqachon xabar bergan). */
  silent?: boolean;
}

export function fingerprintOf(i: Pick<CaptureInput, 'source' | 'kind' | 'message' | 'stack' | 'route' | 'method' | 'status'>): string {
  const route = i.route ? `${(i.method || '').toUpperCase()} ${normalizePath(i.route)}` : '';
  // API xatolarida (5xx) xabar ko'pincha bir xil ("Server xatoligi") — marshrut + status ajratadi
  const parts = [i.source, i.kind || '', normalizeMessage(redact(i.message, 1000)), frameKey(topFrame(i.stack)), route, i.kind === 'api' ? String(i.status || '') : ''];
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

// ── Telegram xabari ──
type Notifier = (text: string) => Promise<void>;
let notifier: Notifier = async (text) => {
  const { notifyDeveloper } = await import('./bot');
  await notifyDeveloper(text, { plain: true });
};
/** Testlar (yoki boshqa kanal) uchun almashtirish. */
export function setErrorNotifier(fn: Notifier) { notifier = fn; }

const SOURCE_LABEL: Record<ErrorSource, string> = { server: 'server', client: 'sayt/ilova', bot: 'Telegram bot', worker: 'fon ishi' };
const fmtTime = (d: Date) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
// Matn autentifikatsiyasiz kelishi mumkin (frontend) — havola/mention bo'lib ketmasin
const plain = (v: unknown, n = 300) => String(v ?? '').replace(/https?:\/\/\S+/gi, '[url]').replace(/@(\w)/g, '@​$1').slice(0, n);

export function formatAlert(ev: {
  source: ErrorSource; kind?: string; message: string; where?: string; topFrame?: string; page?: string; action?: string;
  platform?: string; appVersion?: string; status?: number; count: number; userIds?: string[]; firstSeen: Date; lastSeen: Date; lastRole?: string;
}, reopened: boolean): string {
  const head = reopened ? '♻️ Hal qilingan xato yana chiqdi' : '🐞 Yangi xato';
  const lines = [`${head} — ${SOURCE_LABEL[ev.source]}${ev.kind ? ` (${plain(ev.kind, 30)})` : ''}`];
  if (ev.where) lines.push(`📍 Qayerda: ${plain(ev.where, 160)}`);
  if (ev.topFrame) lines.push(`📄 Kod: ${plain(ev.topFrame, 160)}`);
  if (ev.page && !(ev.where || '').includes(ev.page)) lines.push(`🖥 Ekran: ${plain(ev.page, 120)}`);
  if (ev.action) lines.push(`👆 Oxirgi amal: ${plain(ev.action, 120)}`);
  lines.push(`❗ Nima: ${plain(ev.message, 300)}`);
  const users = ev.userIds?.length || 0;
  lines.push(`👥 Foydalanuvchilar: ${users}${ev.lastRole ? ` (${plain(ev.lastRole, 20)})` : ''} · marta: ${ev.count}`);
  if (ev.platform || ev.appVersion) lines.push(`📱 ${plain(ev.platform || '', 20)}${ev.appVersion ? ' v' + plain(ev.appVersion, 20) : ''}`);
  lines.push(`🕒 Birinchi: ${fmtTime(ev.firstSeen)} · oxirgi: ${fmtTime(ev.lastSeen)}`);
  lines.push('🔎 Batafsil: Dasturchi paneli → Xatolar');
  return lines.join('\n');
}

const ALERTS_PER_HOUR = 20;
async function maybeNotify(ev: Parameters<typeof formatAlert>[0] & { fingerprint: string }, reopened: boolean) {
  // Qayta chiqqan xato — bir fingerprint uchun 6 soatda bir martadan ko'p emas
  if (reopened && !checkRate(`errtrack-reopen:${ev.fingerprint}`, 1, 6 * 60 * 60 * 1000).allowed) return;
  if (!checkRate('errtrack-alert', ALERTS_PER_HOUR, 60 * 60 * 1000).allowed) return;
  await notifier(formatAlert(ev, reopened));
}

// ── Saqlash ──
// Bir fingerprint bo'yicha bazaga yozish daqiqasiga ≤30 ta; ortiqchasi xotirada yig'ilib keyingi yozuvga qo'shiladi
const pending = new Map<string, number>();
const memSeen = new Map<string, number>(); // baza ulanmagan paytda "yangimi?" tekshiruvi
const MAX_USERS = 200;
const MAX_OCC = 20;

const clip = (v: unknown, n: number) => (v == null || v === '' ? undefined : redact(String(v), n));

export async function captureError(input: CaptureInput): Promise<void> {
  try {
    if (!input || !input.message) return;
    const message = redact(input.message, 1000) || 'Nomaʼlum xato';
    const stack = trimStack(input.stack);
    const route = input.route ? normalizePath(input.route) : undefined;
    const method = input.method ? String(input.method).toUpperCase().slice(0, 10) : undefined;
    const fingerprint = fingerprintOf({ ...input, route });
    const frame = topFrame(input.stack);
    const page = clip(input.page, 200);
    const where = route ? `${method || ''} ${route}`.trim() + (input.status ? ` → ${input.status}` : '') : page;
    const now = new Date();

    if (!checkRate(`errtrack-w:${fingerprint}`, 30, 60_000).allowed) {
      pending.set(fingerprint, (pending.get(fingerprint) || 0) + 1);
      if (pending.size > 1000) pending.delete(pending.keys().next().value as string);
      return;
    }
    const inc = 1 + (pending.get(fingerprint) || 0);
    pending.delete(fingerprint);

    const base = {
      source: input.source, kind: clip(input.kind, 40), message, where, topFrame: frame, route, method,
      status: typeof input.status === 'number' ? input.status : undefined, page, action: clip(input.action, 200),
      platform: clip(input.platform, 20), appVersion: clip(input.appVersion, 40),
    };

    if (mongoose.connection.readyState !== 1) {
      // Baza yo'q (ishga tushish/uzilish) — hech bo'lmaganda dasturchiga xabar boradi
      const isNew = !memSeen.has(fingerprint);
      memSeen.set(fingerprint, now.getTime());
      if (memSeen.size > 500) memSeen.delete(memSeen.keys().next().value as string);
      if (isNew && !input.silent) {
        await maybeNotify({ ...base, fingerprint, count: inc, userIds: input.userId ? [input.userId] : [], firstSeen: now, lastSeen: now, lastRole: input.role }, false);
      }
      return;
    }

    const userId = clip(input.userId, 40);
    const companyId = clip(input.companyId, 40);
    const occurrence = { at: now, where, route, method, status: base.status, page, action: base.action, userId, companyId, role: clip(input.role, 20), appVersion: base.appVersion, platform: base.platform };
    const set: Record<string, unknown> = {
      lastSeen: now, message, where, page, action: base.action, status: base.status,
      appVersion: base.appVersion, platform: base.platform, userAgent: clip(input.userAgent, 300),
      lastUserId: userId, lastCompanyId: companyId, lastRole: occurrence.role,
    };
    if (stack) set.stack = stack;
    if (input.componentStack) set.componentStack = redact(input.componentStack, 3000);
    if (input.breadcrumbs?.length) set.breadcrumbs = input.breadcrumbs.slice(-5).map((b) => redact(b, 150));
    const addToSet: Record<string, unknown> = {};
    if (userId) addToSet.userIds = userId;
    if (companyId) addToSet.companyIds = companyId;

    const before = await ErrorEvent.findOneAndUpdate(
      { fingerprint },
      {
        $set: set,
        $inc: { count: inc },
        $setOnInsert: { fingerprint, source: input.source, kind: base.kind, topFrame: frame, route, method, firstSeen: now, resolved: false, reopenedCount: 0 },
        ...(Object.keys(addToSet).length ? { $addToSet: addToSet } : {}),
        $push: { occurrences: { $each: [occurrence], $slice: -MAX_OCC } },
      },
      { upsert: true, returnDocument: 'before' },
    ).lean();

    // Foydalanuvchilar ro'yxati cheksiz o'smasin
    if (before && (before.userIds?.length || 0) >= MAX_USERS) {
      await ErrorEvent.updateOne({ fingerprint }, { $push: { userIds: { $each: [], $slice: -MAX_USERS }, companyIds: { $each: [], $slice: -MAX_USERS } } });
    }

    let reopened = false;
    if (before?.resolved) {
      reopened = true;
      await ErrorEvent.updateOne({ fingerprint }, { $set: { resolved: false, resolvedAt: null, resolvedBy: null }, $inc: { reopenedCount: 1 } });
    }
    if ((!before || reopened) && !input.silent) {
      const userIds = Array.from(new Set([...(before?.userIds || []), ...(userId ? [userId] : [])]));
      await maybeNotify({
        ...base, fingerprint, count: (before?.count || 0) + inc, userIds, lastRole: occurrence.role,
        firstSeen: before?.firstSeen || now, lastSeen: now,
      }, reopened);
    }
  } catch (e) {
    // Kuzatuvning o'zi xato bersa — faqat log (rekursiyasiz: original console.error)
    origConsoleError('[errorTracker] yozilmadi:', (e as Error)?.message);
  }
}

// ── Express integratsiyasi ──
interface ReqStore { error?: { message: string; stack?: string } }
const reqStorage = new AsyncLocalStorage<ReqStore>();
const origConsoleError = console.error.bind(console);

/** So'rov paytida console.error(err) qilingan oxirgi xatoni eslab qoladi — ko'p marshrutlar
 *  `catch (e) { console.error(e); res.status(500)... }` qiladi: 5xx bo'lganda "nima" shundan olinadi. */
function rememberError(args: unknown[]) {
  const store = reqStorage.getStore();
  if (!store) return;
  const err = args.find((a) => a instanceof Error) as Error | undefined;
  if (err) { store.error = { message: err.message || err.name, stack: err.stack }; return; }
  const text = args.map((a) => (typeof a === 'string' ? a : (a as any)?.message || '')).filter(Boolean).join(' ');
  if (text && !store.error) store.error = { message: text.slice(0, 500) };
}

let consoleHooked = false;
export function hookConsoleError() {
  if (consoleHooked) return;
  consoleHooked = true;
  console.error = (...args: unknown[]) => {
    try { rememberError(args); } catch { /* */ }
    origConsoleError(...args);
  };
}

/** Eng birinchi middleware: har so'rovga kontekst + javob 5xx bo'lsa xatoni yozadi. */
export function errorCaptureMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const store: ReqStore = {};
    res.on('finish', () => {
      const status = res.statusCode;
      if (status < 500) return;
      const err = (res.locals as any).capturedError as Error | undefined;
      const known = err ? { message: err.message || String(err), stack: err.stack } : store.error;
      // 503 sababsiz — ataylab (texnik ishlar rejimi, xizmat o'chiq): xato emas
      if (status === 503 && !known) return;
      const u = req.user;
      const routePath = (req as any).route?.path;
      const route = typeof routePath === 'string' && req.baseUrl ? `${req.baseUrl}${routePath === '/' ? '' : routePath}` : (req.originalUrl || req.url);
      void captureError({
        source: String(req.originalUrl || '').startsWith('/api/bot') ? 'bot' : 'server',
        kind: 'http',
        message: known?.message || `HTTP ${status}`,
        stack: known?.stack,
        route, method: req.method, status,
        userId: u?.userId, companyId: u?.companyId, role: u?.role,
        platform: String(req.headers['x-client'] || '').slice(0, 20) || undefined,
      });
    });
    reqStorage.run(store, () => next());
  };
}

/** Global Express xato middleware'idan chaqiriladi — haqiqiy xato obyektini finish hook'ga uzatadi. */
export function markRequestError(res: Response, err: unknown) {
  if (err instanceof Error) (res.locals as any).capturedError = err;
  else if (err) (res.locals as any).capturedError = new Error(String((err as any)?.message || err));
}

/** process darajasidagi xatolar (unhandledRejection/uncaughtException). */
export function captureProcessError(kind: string, reason: unknown) {
  const err = reason instanceof Error ? reason : new Error(String((reason as any)?.message ?? reason));
  const stack = err.stack || '';
  const source: ErrorSource = /services[\\/](bot|botExpense|registrationScene)|aiVoice[\\/]telegram|node-telegram-bot-api/.test(stack) ? 'bot' : 'server';
  return captureError({ source, kind, message: err.message || String(reason), stack });
}

export const __test = { pending, memSeen, normalizeMessage, frameKey };
