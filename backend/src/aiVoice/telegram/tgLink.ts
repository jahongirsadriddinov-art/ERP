import AiEmployeeContact from '../../models/AiEmployeeContact';
import User from '../../models/User';
import { isObjectIdString } from '../lib/ids';

// Owner 2026-10-16: bog'lash kodi kerak emas — xodimning Telegram user id'si ERP bot bog'lanishidan olinadi
// (shaxsiy chat id == Telegram user id; guruh chatlari manfiy — olinmaydi). YAGONA yordamchi:
//  • bot'da telefon ulashilganda (services/bot.ts → aiTelegramLinked) darhol;
//  • qo'ng'iroq/kiruvchi/ro'yxatlarda kerak bo'lganda (lazy).
// Qoida o'zgarmagan: bitta Telegram id ↔ bitta xodim (partial unique indeks). Eskirgan egasi (uning User'i bu
// id'ga endi bog'lanmagan) bo'lsa — undan olib tashlanadi; aks holda konflikt, yozilmaydi. Log'da faqat mask.

const TG_ID_RE = /^\d{1,20}$/;
export const maskTgId = (id: string) => (id.length > 4 ? `…${id.slice(-4)}` : '…');

/** User yozuvidan bot bilgan Telegram user id (telegramUserId ustun, keyin musbat shaxsiy chat id). */
export function botLinkedTgId(u: { telegramChatId?: unknown; telegramUserId?: unknown } | null | undefined): string | undefined {
  if (!u) return undefined;
  for (const raw of [u.telegramUserId, u.telegramChatId]) {
    const v = raw === undefined || raw === null ? '' : String(raw).trim();
    if (TG_ID_RE.test(v) && v !== '0') return v;
  }
  return undefined;
}

/** 'yes' — xodim bot orqali shu id'ga bog'langan; 'none' — bot bog'lanishi yo'q; 'other' — boshqa id yoki xodim yo'q. */
async function linkState(employeeId: string, tgId: string): Promise<'yes' | 'none' | 'other'> {
  if (!isObjectIdString(employeeId)) return 'other';
  // Bloklangan xodim ham topiladi — rad etish keyin (checkActor → 'blocked', aniq sabab bilan)
  const u: any = await User.findById(employeeId).select('telegramChatId telegramUserId').lean();
  if (!u) return 'other';
  const b = botLinkedTgId(u);
  return b === tgId ? 'yes' : b ? 'other' : 'none';
}
const stillLinked = async (employeeId: string, tgId: string) => (await linkState(employeeId, tgId)) === 'yes';

/**
 * AiEmployeeContact.telegram.tgUserId'ni bot bog'lanishi bilan moslaydi. Natija — amaldagi tgUserId
 * (yo'q yoki konflikt — undefined). user berilsa qayta o'qilmaydi.
 */
export async function ensureContactTgUserId(
  companyId: string, employeeId: string, opts: { user?: any } = {},
): Promise<string | undefined> {
  if (!companyId || !isObjectIdString(employeeId)) return undefined;
  const user: any = opts.user !== undefined ? opts.user
    : await User.findOne({ _id: employeeId, companyId }).select('telegramChatId telegramUserId').lean();
  const ct: any = await AiEmployeeContact.findOne({ companyId, employeeId }).select('telegram.tgUserId').lean();
  const current = typeof ct?.telegram?.tgUserId === 'string' && TG_ID_RE.test(ct.telegram.tgUserId) ? ct.telegram.tgUserId : undefined;
  const derived = botLinkedTgId(user);
  if (!derived || derived === current) return current;

  const write = () => AiEmployeeContact.updateOne(
    { companyId, employeeId },
    {
      $set: { 'telegram.tgUserId': derived, 'telegram.resolveStatus': 'unknown' },
      $unset: { 'telegram.resolvedAt': 1 },
      $setOnInsert: { companyId, employeeId },
    },
    { upsert: true },
  );
  try {
    await write();
    return derived;
  } catch (e: any) {
    if (e?.code !== 11000) throw e;
  }
  // Boshqa xodimda shu id: u endi bu Telegram'ga bog'lanmagan bo'lsa — eskirgan, olib tashlanadi
  const other: any = await AiEmployeeContact.findOne({ 'telegram.tgUserId': derived }).select('employeeId').lean();
  if (other && String(other.employeeId) !== String(employeeId) && !(await stillLinked(String(other.employeeId), derived))) {
    await AiEmployeeContact.updateOne(
      { _id: other._id, 'telegram.tgUserId': derived },
      { $unset: { 'telegram.tgUserId': 1, 'telegram.resolvedAt': 1 }, $set: { 'telegram.resolveStatus': 'unknown' } },
    );
    try {
      await write();
      return derived;
    } catch (e: any) {
      if (e?.code !== 11000) throw e;
    }
  }
  console.warn(`[aiVoice/telegram] Telegram ${maskTgId(derived)} boshqa xodimga bog'langan — o'tkazib yuborildi`);
  return current;
}

/** Kiruvchi qo'ng'iroq: Telegram id bo'yicha xodim (kontakt yo'q bo'lsa — bot bog'lanishidan, darhol backfill). */
export async function findEmployeeByTgId(tgId: string): Promise<{ companyId: string; employeeId: string } | null> {
  if (!TG_ID_RE.test(tgId)) return null;
  const ct: any = await AiEmployeeContact.findOne({ 'telegram.tgUserId': tgId }).select('companyId employeeId').lean();
  const ctState = ct ? await linkState(String(ct.employeeId), tgId) : 'other';
  if (ct && ctState === 'yes') return { companyId: String(ct.companyId), employeeId: String(ct.employeeId) };
  // Bot bog'lanishi: telegramUserId yoki shaxsiy chat id (bitta chat — bitta xodim, bot.ts kafolatlaydi)
  const users: any[] = await User.find({
    $or: [{ telegramUserId: tgId }, { telegramChatId: tgId }], isBlocked: { $ne: true }, companyId: { $exists: true, $ne: null },
  }).select('companyId telegramChatId telegramUserId role').limit(3).lean();
  const linked = users.filter((u) => u.companyId && u.role !== 'dasturchi' && botLinkedTgId(u) === tgId);
  if (linked.length !== 1) {
    // Eski (kod bilan bog'langan) kontakt — faqat xodimning bot bog'lanishi umuman yo'q bo'lsa amal qiladi
    return ct && ctState === 'none' ? { companyId: String(ct.companyId), employeeId: String(ct.employeeId) } : null;
  }
  const u = linked[0];
  const got = await ensureContactTgUserId(String(u.companyId), String(u._id), { user: u });
  return got === tgId ? { companyId: String(u.companyId), employeeId: String(u._id) } : null;
}

/** Bot'da telefon ulashildi (services/bot.ts) — darhol backfill. Xatolar yutiladi (bot oqimi to'xtamasin). */
export async function onBotLinked(userId: string): Promise<void> {
  try {
    if (!isObjectIdString(userId)) return;
    const u: any = await User.findById(userId).select('companyId telegramChatId telegramUserId role').lean();
    if (!u?.companyId || u.role === 'dasturchi') return;
    await ensureContactTgUserId(String(u.companyId), String(u._id), { user: u });
  } catch (e) {
    console.error('[aiVoice/telegram] bot bog\'lanishi backfill xatosi:', (e as Error)?.name || 'Error');
  }
}

/**
 * Ommaviy backfill (ishga tushganda va worker maintenance'da): ERP botga bog'langan, lekin AI kontaktida tgUserId
 * yo'q/boshqa bo'lgan xodimlar. Faqat DB yozuvi (Telegram'ga so'rov yo'q). Natija — yangilanganlar soni.
 */
export async function backfillTgLinks(limit = 500): Promise<number> {
  const users: any[] = await User.find({
    $or: [{ telegramChatId: { $exists: true, $nin: [null, ''] } }, { telegramUserId: { $exists: true, $nin: [null, ''] } }],
    companyId: { $exists: true, $ne: null }, isBlocked: { $ne: true }, role: { $ne: 'dasturchi' },
  }).select('companyId telegramChatId telegramUserId').limit(Math.max(1, Math.min(5000, limit))).lean();
  if (!users.length) return 0;
  const contacts: any[] = await AiEmployeeContact.find({ employeeId: { $in: users.map((u) => String(u._id)) } })
    .select('companyId employeeId telegram.tgUserId').lean();
  const have = new Map(contacts.map((c) => [`${c.companyId}:${c.employeeId}`, c?.telegram?.tgUserId]));
  let n = 0;
  for (const u of users) {
    const d = botLinkedTgId(u);
    if (!d || have.get(`${u.companyId}:${u._id}`) === d) continue;
    try {
      if ((await ensureContactTgUserId(String(u.companyId), String(u._id), { user: u })) === d) n++;
    } catch { /* bitta yozuv xatosi boshqalarni to'xtatmaydi */ }
  }
  return n;
}
