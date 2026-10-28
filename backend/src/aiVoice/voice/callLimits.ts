import AiCallSession from '../../models/AiCallSession';
import type { AiLang, AiSettingsData } from '../contracts';

// Foydalanuvchi o'zi AI'ga qo'ng'iroq qilishi (ilova + Telegram "Ochiq muloqot") uchun cheklovlar.
// Owner 2026-10-17:
//  • dasturchi / direktor / o'rinbosar — soatlik limit YO'Q;
//  • ishchi rollar — qisqa tanaffus (standart 90 s, limits.workerCallCooldownSec, 0..600) oldingi
//    ULANGAN qo'ng'iroq tugaganidan keyin; limits.userSessionsPerHour > 0 bo'lsa — oxirgi 60 daqiqadagi
//    ulangan qo'ng'iroqlar soni (sirpanuvchi oyna, 0 = cheklanmaydi);
//  • ulanmagan / muvaffaqiyatsiz urinishlar HECH QACHON sanalmaydi — faqat answeredAt bor sessiyalar.

export const UNLIMITED_CALL_ROLES = ['dasturchi', 'direktor', 'orinbosar'];
export const DEFAULT_WORKER_CALL_COOLDOWN_SEC = 90;
const HOUR_MS = 3_600_000;

export type CallLimitCheck = { ok: true } | { ok: false; code: 'cooldown' | 'hourly'; retryAfterSec: number };

export function workerCooldownSec(settings: Pick<AiSettingsData, 'limits'>): number {
  const v = Number((settings.limits as { workerCallCooldownSec?: unknown })?.workerCallCooldownSec);
  return Number.isFinite(v) ? Math.max(0, Math.min(600, Math.round(v))) : DEFAULT_WORKER_CALL_COOLDOWN_SEC;
}

export function isUnlimitedCallRole(role: string | undefined): boolean {
  return UNLIMITED_CALL_ROLES.includes(String(role || ''));
}

// Owner 2026-10-28: "nimaga «suhbatni tugatamiz» deb o'chirib qo'yadi — firma egasi va
// o'rinbosarlar limitsiz gaplasha olsin". Rahbarlar uchun suhbat uzunligi cheklovi olib
// tashlandi. Mutlaqo cheksiz emas: unutilgan yoki osilib qolgan qo'ng'iroq butun kecha
// ochiq turib pul yemasligi uchun 4 soatlik xavfsizlik shifti qoldirildi.
export const BOSS_CALL_MAX_SEC = 4 * 3600;

/** Yordamchi qo'ng'iroq uchun ruxsat etilgan uzunlik (sekund). */
export function assistantMaxDurationSec(p: {
  role?: string; isOwner?: boolean; settings: Pick<AiSettingsData, 'calls'>; hardCapSec?: number;
}): number {
  if (p.isOwner || isUnlimitedCallRole(p.role)) return BOSS_CALL_MAX_SEC;
  const base = Math.max(30, Math.round(Number(p.settings.calls.assistantMaxDurationSec) || 300));
  return p.hardCapSec ? Math.min(p.hardCapSec, base) : base;
}

export async function checkUserCallLimit(p: {
  companyId: string; employeeId: string; role: string; settings: Pick<AiSettingsData, 'limits'>; now?: Date;
}): Promise<CallLimitCheck> {
  if (isUnlimitedCallRole(p.role)) return { ok: true };
  const now = (p.now || new Date()).getTime();
  const cooldownMs = workerCooldownSec(p.settings) * 1000;
  const perHour = Math.max(0, Math.round(Number(p.settings.limits?.userSessionsPerHour) || 0));
  if (!cooldownMs && !perHour) return { ok: true };
  // Faqat foydalanuvchi boshlagan (inbound) va HAQIQATAN ulangan qo'ng'iroqlar
  const rows: any[] = await AiCallSession.find({
    companyId: p.companyId, employeeId: p.employeeId, direction: 'inbound',
    createdAt: { $gte: new Date(now - HOUR_MS - 15 * 60_000) }, answeredAt: { $exists: true },
  }).select('answeredAt endedAt isActive').sort({ createdAt: -1 }).limit(200).lean();
  if (cooldownMs) {
    let lastEnd = 0;
    for (const r of rows) {
      const t = r.isActive ? now : new Date(r.endedAt || r.answeredAt).getTime();
      if (t > lastEnd) lastEnd = t;
    }
    if (lastEnd && now - lastEnd < cooldownMs) {
      return { ok: false, code: 'cooldown', retryAfterSec: Math.max(1, Math.ceil((lastEnd + cooldownMs - now) / 1000)) };
    }
  }
  if (perHour) {
    const inHour = rows.map((r) => new Date(r.answeredAt).getTime()).filter((t) => t >= now - HOUR_MS).sort((a, b) => a - b);
    if (inHour.length >= perHour) {
      const oldest = inHour[inHour.length - perHour];
      return { ok: false, code: 'hourly', retryAfterSec: Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 1000)) };
    }
  }
  return { ok: true };
}

/** Foydalanuvchiga qisqa, aniq matn (necha soniya/daqiqadan keyin). */
export function callLimitMessage(lang: AiLang, r: Extract<CallLimitCheck, { ok: false }>): string {
  const sec = r.retryAfterSec;
  const ru = lang === 'ru';
  const when = sec <= 120
    ? (ru ? `через ${sec} сек.` : `${sec} soniyadan keyin`)
    : (ru ? `через ${Math.ceil(sec / 60)} мин.` : `${Math.ceil(sec / 60)} daqiqadan keyin`);
  if (r.code === 'cooldown') {
    return ru ? `Следующий звонок можно ${when} — пока продолжим текстом.` : `Keyingi qo'ng'iroq ${when} mumkin — hozircha matn bilan davom etamiz.`;
  }
  return ru ? `Лимит звонков за час исчерпан, можно ${when} — продолжим текстом.` : `Soatlik qo'ng'iroqlar soni tugadi, ${when} mumkin — matn bilan davom etamiz.`;
}
