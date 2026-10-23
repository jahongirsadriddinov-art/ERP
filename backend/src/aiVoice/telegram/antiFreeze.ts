import AiChannelConnection from '../../models/AiChannelConnection';
import AiTgAccount from '../../models/AiTgAccount';

// Anti-freeze (owner 2026-10-23): AI Telegram akkauntlari Telegram tomonidan muzlatilmoqda. Worker (tgcall-worker
// freeze.py/limits.py) har akkaunt holatini (ok / frozen / spam_limited / banned / unauthorized) va bugungi
// ishlatilishini health'da va darhol 'account.health' voqeasida yuboradi. Bu yerda:
//  • holat bazaga yoziladi (AiTgAccount.health / platforma — AiChannelConnection.health);
//  • holat O'ZGARGANDA (atomar — bir necha instansiya/health tick ikki marta yubormasin) dasturchiga Telegram bot
//    orqali o'zbekcha yo'riqnoma (@SpamBot / apellyatsiya havolasi);
//  • cheklangan akkaunt qo'ng'iroq/DM uchun tanlanmaydi (companyAccounts.pickPoolAccount);
//  • profil o'zgartirish — akkauntga kuniga 1 marta (PROFILE_COOLDOWN_MS).

export type TgHealthState = 'ok' | 'frozen' | 'spam_limited' | 'banned' | 'unauthorized';
export interface TgHealth { state: TgHealthState; reason?: string; since?: number; until?: number; appealUrl?: string }
export interface TgUsageKind { hour: number; day: number; capHour: number; capDay: number }
export interface TgUsage { warmup: boolean; warmupUntil?: number; call?: TgUsageKind; cold?: TgUsageKind; dm?: TgUsageKind; reply?: TgUsageKind; import?: TgUsageKind }

const STATES: TgHealthState[] = ['ok', 'frozen', 'spam_limited', 'banned', 'unauthorized'];
const USAGE_KINDS = ['call', 'cold', 'dm', 'reply', 'import'] as const;
/** Worker call.place/dm.send rad sabablari: akkaunt cheklangan (boshqa akkauntga o'tish kerak). */
export const RESTRICT_REASONS = new Set(['account_frozen', 'spam_limited', 'account_banned', 'account_unauthorized']);
/** Vaqtinchalik chegara (soat/kun/pauza yoki FloodWait) — boshqa akkaunt yoki keyinroq. */
export const LIMIT_REASONS = new Set(['rate_limited', 'flood_wait']);
export const PROFILE_COOLDOWN_MS = 24 * 3600_000;

const num = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : undefined;
};

export function sanitizeHealth(h: unknown): TgHealth | null {
  if (!h || typeof h !== 'object') return null;
  const o = h as Record<string, unknown>;
  const state = STATES.find((s) => s === o.state);
  if (!state) return null;
  const out: TgHealth = { state };
  if (state === 'ok') return out;
  if (typeof o.reason === 'string' && /^[a-z_]{1,40}$/.test(o.reason)) out.reason = o.reason;
  const since = num(o.since, 1); const until = num(o.until, 1);
  if (since) out.since = since;
  if (until) out.until = until;
  if (typeof o.appealUrl === 'string' && /^(https:\/\/|tg:\/\/)[^\s<>"']{1,290}$/.test(o.appealUrl)) out.appealUrl = o.appealUrl;
  return out;
}

export function sanitizeUsage(u: unknown): TgUsage | null {
  if (!u || typeof u !== 'object') return null;
  const o = u as Record<string, any>;
  const out: TgUsage = { warmup: o.warmup === true };
  const wu = num(o.warmupUntil, 1);
  if (out.warmup && wu) out.warmupUntil = wu;
  for (const k of USAGE_KINDS) {
    const v = o[k];
    if (!v || typeof v !== 'object') continue;
    const hour = num(v.hour, 0, 100_000); const day = num(v.day, 0, 100_000);
    const capHour = num(v.capHour, 0, 100_000); const capDay = num(v.capDay, 0, 100_000);
    if (hour !== undefined && day !== undefined && capHour !== undefined && capDay !== undefined) out[k] = { hour, day, capHour, capDay };
  }
  return out;
}

/** Bazadagi health (until — Date) → cheklov hozir amaldami. */
export function healthBlocked(h: any, now: Date = new Date()): boolean {
  if (!h || !h.state || h.state === 'ok') return false;
  if ((h.state === 'frozen' || h.state === 'spam_limited') && h.until && new Date(h.until).getTime() <= now.getTime()) return false;
  return true;
}

/** Mongo filtri: health cheklovi amalda bo'lmagan akkauntlar. */
export const healthyFilter = (now: Date): any => ({
  $or: [
    { 'health.state': { $in: [null, 'ok'] } },
    { 'health.state': { $in: ['frozen', 'spam_limited'] }, 'health.until': { $lte: now } },
  ],
});

const toDb = (h: TgHealth, now: Date) => ({
  state: h.state, at: now,
  ...(h.reason ? { reason: h.reason } : {}), ...(h.since ? { since: new Date(h.since) } : {}),
  ...(h.until ? { until: new Date(h.until) } : {}), ...(h.appealUrl ? { appealUrl: h.appealUrl } : {}),
});

const tashkent = (ms: number) => `${new Date(ms + 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')} (Toshkent)`;

/** Dasturchiga yuboriladigan o'zbekcha xabar (holat o'zgarganda). */
export function healthMessage(name: string, h: TgHealth, prev?: string): string {
  const who = `"${name}"`;
  const until = h.until ? tashkent(h.until) : '';
  const appeal = h.appealUrl ? `\n   Apellyatsiya havolasi: ${h.appealUrl}` : '';
  switch (h.state) {
    case 'frozen':
      return `🧊 AI Telegram akkaunti MUZLATILDI: ${who}\n`
        + `Telegram uni spam tizimi bo'yicha muzlatgan (freeze)${until ? `, muddat: ${until} gacha` : ''}.\n`
        + `AI bu akkauntdan qo'ng'iroq/xabar qilmaydi — ish boshqa sog' akkauntlarga o'tdi.\n\n`
        + `Nima qilish kerak:\n`
        + `1) Shu raqamli Telegram'ni telefonda oching (ilova o'zi "akkaunt muzlatilgan" deb ko'rsatadi).\n`
        + `2) @SpamBot ga /start yozing va ko'rsatmaga amal qiling.${appeal}\n`
        + `3) Apellyatsiyada qisqa yozing: bu kompaniyaning ish akkaunti, xodimlarga ish bo'yicha qo'ng'iroq qiladi, ommaviy xabar yubormaydi.\n`
        + `4) Muzlatish olib tashlanguncha akkauntni o'chirmang, qayta kirmang va profilini o'zgartirmang.\n`
        + `Maslahat: virtual raqam emas, eski (kamida bir necha oylik) haqiqiy SIM-kartali akkaunt va O'zbekistondagi proksi (TG_PROXIES) ishlating.`;
    case 'spam_limited':
      return `⚠️ AI Telegram akkauntiga SPAM CHEKLOVI qo'yildi: ${who}\n`
        + `Telegram notanish odamlarga yozish/qo'ng'iroq qilishni chekladi (PEER_FLOOD). AI bu akkauntdan`
        + `${until ? ` ${until} gacha` : ''} chiquvchi qo'ng'iroq/xabar qilmaydi (o'zi yozganlarga javob beradi).\n\n`
        + `Nima qilish kerak:\n1) Akkauntni telefonda oching → @SpamBot → /start.\n`
        + `2) "Bu xato" / apellyatsiya tugmasini bosing va qisqa izoh yozing.\n`
        + `3) Xodimlar AI akkauntini kontaktlariga qo'shsa yoki unga bir marta yozsa — cheklov ularga ta'sir qilmaydi.`;
    case 'banned':
      return `⛔ AI Telegram akkaunti BLOKLANDI (ban): ${who}\n`
        + `Telegram bu raqamni o'chirgan/bloklagan. AI undan foydalanmaydi.\n\n`
        + `Nima qilish kerak:\n1) Raqamni telefonda Telegram'ga kiritib ko'ring — "banned" desa, recover@telegram.org ga raqam bilan xat yozing.\n`
        + `2) Dasturchi panelida bu akkauntni o'chirib, boshqa (eski, haqiqiy SIM) raqam ulang.`;
    case 'unauthorized':
      return `🔑 AI Telegram akkaunti sessiyasi bekor qilindi: ${who}\n`
        + `Telegram sessiyani tugatdi (AUTH_KEY_UNREGISTERED / SESSION_REVOKED) — kimdir "Faol seanslar"dan chiqargan yoki Telegram o'zi.\n`
        + `Dasturchi panelida (AI platforma → AI akkauntlari) akkauntni qayta ulang.`;
    default:
      return `✅ AI Telegram akkaunti yana ishlayapti: ${who}${prev ? ` (avval: ${prev})` : ''}.`;
  }
}

async function notify(text: string): Promise<void> {
  try {
    const { notifyDeveloper } = await import('../../services/bot');
    await notifyDeveloper(text, { plain: true });
  } catch (e) {
    console.error('[aiVoice/telegram] dasturchiga xabar yuborilmadi:', (e as Error).message);
  }
}

/**
 * Akkaunt holatini yozish. Holat (state) o'zgargan bo'lsa — atomar shart bilan bitta yozuvchi dasturchiga xabar beradi.
 * Qaytaradi: true — holat o'zgardi.
 */
export async function applyAccountHealth(id: string, raw: unknown, now: Date = new Date()): Promise<boolean> {
  const h = sanitizeHealth(raw);
  if (!h) return false;
  const prev: any = await AiTgAccount.findById(id).select('health label displayName username phoneMasked').lean();
  if (!prev) return false;
  const prevState = prev.health?.state || 'ok';
  if (prevState === h.state) {
    // Holat o'sha — faqat tafsilot (masalan muzlatish tugash sanasi/apellyatsiya havolasi) yangilanadi
    if (h.state !== 'ok') await AiTgAccount.updateOne({ _id: id, 'health.state': h.state }, { $set: { health: { ...toDb(h, now), at: prev.health?.at || now } } });
    return false;
  }
  const cond = prevState === 'ok' ? { $in: [null, 'ok'] } : prevState;
  const r = await AiTgAccount.updateOne({ _id: id, 'health.state': cond }, { $set: { health: toDb(h, now) } });
  if (!r.modifiedCount) return false;     // boshqa instansiya allaqachon yozdi (va xabar berdi)
  const name = prev.label || prev.displayName || (prev.username ? `@${prev.username}` : '') || prev.phoneMasked || `…${String(id).slice(-4)}`;
  await notify(healthMessage(String(name), h, prevState));
  return true;
}

/** Platforma akkaunti (AiChannelConnection) holati — xuddi shunday. */
export async function applyPlatformHealth(raw: unknown, now: Date = new Date()): Promise<boolean> {
  const h = sanitizeHealth(raw);
  if (!h) return false;
  const filter = { scope: 'platform', companyId: null, type: 'telegram_user' } as const;
  const prev: any = await AiChannelConnection.findOne(filter).select('health username displayName phoneMasked').lean();
  if (!prev) return false;
  const prevState = prev.health?.state || 'ok';
  if (prevState === h.state) {
    if (h.state !== 'ok') await AiChannelConnection.updateOne({ ...filter, 'health.state': h.state }, { $set: { health: { ...toDb(h, now), at: prev.health?.at || now } } });
    return false;
  }
  const cond = prevState === 'ok' ? { $in: [null, 'ok'] } : prevState;
  const r = await AiChannelConnection.updateOne({ ...filter, 'health.state': cond }, { $set: { health: toDb(h, now) } });
  if (!r.modifiedCount) return false;
  const name = `platforma akkaunti${prev.username ? ` @${prev.username}` : prev.phoneMasked ? ` ${prev.phoneMasked}` : ''}`;
  await notify(healthMessage(name, h, prevState));
  return true;
}

/** Bazadagi health → DTO (ms). */
export function healthDto(h: any, now: Date = new Date()): (TgHealth & { active: boolean }) | undefined {
  if (!h || !h.state) return undefined;
  const out: any = { state: h.state, active: healthBlocked(h, now) };
  if (h.reason) out.reason = h.reason;
  if (h.since) out.since = new Date(h.since).getTime();
  if (h.until) out.until = new Date(h.until).getTime();
  if (h.appealUrl) out.appealUrl = h.appealUrl;
  return out;
}

/** Profil o'zgartirish: oxirgisidan 24 soat o'tmagan bo'lsa — necha soniya qoldi; aks holda 0. */
export function profileCooldownSec(changedAt: unknown, now: Date = new Date()): number {
  if (!changedAt) return 0;
  const left = new Date(changedAt as any).getTime() + PROFILE_COOLDOWN_MS - now.getTime();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}
