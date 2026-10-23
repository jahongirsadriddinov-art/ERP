import User from '../models/User';
import Company from '../models/Company';
import AiEmployeeContact from '../models/AiEmployeeContact';
import { getBotInstance } from '../aiVoice/bot/instance';
import { invalidateActor } from '../aiVoice/actor';
import { onBotLinked } from '../aiVoice/telegram/tgLink';

/**
 * TELEGRAM IDENTIFIKATORI (owner 2026-10-23): "raqamimni o'zgartirdim — eski Telegram hamon tanilyapti, AI eski
 * akkauntga qo'ng'iroq qiladi, yangi raqamdan qo'ng'iroq qilsam 'band/noma'lum' deydi".
 *
 * Sabab: xodimning Telegram'i uch joyda saqlanadi — User.telegramChatId (bot), User.telegramUserId (ro'yxatdan
 * o'tishda yoziladi va AI uni chat id'dan USTUN qo'yadi — tgLink.botLinkedTgId) va AiEmployeeContact.telegram.tgUserId
 * (AI qo'ng'iroqlari/kiruvchi qo'ng'iroqni tanish). Avval telefon o'zgarganda hech biri tozalanmasdi, yangi
 * Telegram'dan kontakt ulashilganda esa faqat telegramChatId almashardi — telegramUserId va AI kontakti eski qolardi.
 *
 * Endi YAGONA joy:
 *  • onPhoneChanged — telefon qaysi yo'l bilan o'zgarmasin (profil, rahbar tahriri, AI amali): eski Telegram
 *    butunlay unutiladi (bot chati, Telegram user id, AI kontakti, faol AI sessiyalari, AI rejimi), eski chatga
 *    "raqam o'zgardi, akkaunt uzildi" xabari klaviaturasiz yuboriladi. Yangi Telegram /start + raqam ulashish bilan bog'lanadi.
 *  • linkTelegram — botda raqam ulashilganda: shu Telegram (chat + user id) boshqa xodimda bo'lsa undan toza ko'chadi,
 *    xodimning boshqa (eski) chati uziladi, AI kontakti darhol yangi id bilan yoziladi.
 * Bitta Telegram ↔ bitta xodim (chat ham, user id ham) shu yerda kafolatlanadi.
 */

const PRIVATE_CHAT_RE = /^\d{1,20}$/;

const DISCONNECTED = {
  uz: "📵 Hisobingizdagi telefon raqami o'zgardi — bu Telegram akkaunt endi uzildi.\nYangi raqamdagi Telegram'dan botga /start bosing va raqamni ulashing.",
  ru: '📵 Номер телефона в вашем профиле изменён — этот Telegram-аккаунт отключён.\nОткройте бота в Telegram с новым номером, нажмите /start и поделитесь номером.',
};
const MOVED = {
  uz: "📵 Hisobingiz boshqa Telegram akkauntga ulandi — bu akkaunt uzildi.",
  ru: '📵 Ваш профиль подключён к другому Telegram-аккаунту — этот аккаунт отключён.',
};

const pickLang = (l?: string) => (l === 'ru' ? 'ru' : 'uz');

/** AI tomonidagi Telegram bog'lanishini tozalaydi va AI sessiyalarini yakunlaydi (xatolar yutiladi). */
async function forgetAiTelegram(userIds: string[], reason: string): Promise<void> {
  if (!userIds.length) return;
  await AiEmployeeContact.updateMany(
    { employeeId: { $in: userIds } },
    {
      $unset: { 'telegram.tgUserId': 1, 'telegram.username': 1, 'telegram.resolvedAt': 1, 'telegram.checkedAt': 1, botAiModeUntil: 1, botBlockedAt: 1 },
      $set: { 'telegram.resolveStatus': 'unknown' },
    },
  ).catch((e) => console.error('[tgIdentity] AI kontakt:', (e as Error)?.message));
  for (const id of userIds) {
    invalidateActor(id);
    // Faol AI qo'ng'iroqlari (eski Telegram bilan) — darhol tugaydi. Dinamik import: sessions → settings zanjiri og'ir.
    void import('../aiVoice/sessions').then((m) => m.aiEndSessionsForUser(id, reason)).catch(() => undefined);
  }
}

/** Eski chat: AI rejimi/jadval qoralamasi tozalanadi va qisqa xabar klaviaturasiz yuboriladi. */
async function disconnectChat(chatId: string | undefined, lang: string | undefined, kind: 'phone' | 'moved'): Promise<void> {
  if (!chatId || !PRIVATE_CHAT_RE.test(String(chatId))) return;
  try {
    const hooks = await import('../aiVoice/bot/botHooks');
    hooks.aiBotResetChat(Number(chatId));
  } catch { /* AI moduli yo'q — muhim emas */ }
  const bot = getBotInstance();
  if (!bot) return;
  const text = (kind === 'phone' ? DISCONNECTED : MOVED)[pickLang(lang)];
  await bot.sendMessage(String(chatId), text, { reply_markup: { remove_keyboard: true } }).catch(() => undefined);
}

/**
 * Telefon raqami o'zgardi (user.phone allaqachon saqlangan). Eski Telegram identifikatori butunlay unutiladi.
 * Firma egasining raqami Company.phone'da ham yangilanadi (eski raqamga teng bo'lsa).
 */
export async function onPhoneChanged(userId: string, oldPhone?: string, newPhone?: string): Promise<void> {
  try {
    const u: any = await User.findById(userId).select('telegramChatId telegramUserId language isOwner companyId').lean();
    if (!u) return;
    await User.updateOne({ _id: userId }, {
      $unset: {
        telegramChatId: 1, telegramUserId: 1, phoneVerifiedAt: 1, lastReminderMsgId: 1,
        telegramVerificationCode: 1, telegramVerificationCodeExpires: 1,
      },
    });
    await forgetAiTelegram([String(userId)], 'phone_changed');
    if (u.isOwner && u.companyId && oldPhone && newPhone) {
      await Company.updateOne({ _id: u.companyId, phone: oldPhone }, { $set: { phone: newPhone } }).catch(() => undefined);
    }
    await disconnectChat(u.telegramChatId, u.language, 'phone');
  } catch (e) {
    console.error('[tgIdentity] onPhoneChanged:', (e as Error)?.message);
  }
}

/**
 * Botda raqam ulashildi: Telegram (shaxsiy chat + user id) shu xodimga bog'lanadi.
 * Natija — yangilangan telegramChatId (chaqiruvchi xotiradagi user'ni moslashi uchun).
 */
export async function linkTelegram(userId: string, chatId: string, tgUserId?: string): Promise<void> {
  const uid = String(userId);
  const chat = String(chatId);
  const tg = tgUserId && PRIVATE_CHAT_RE.test(String(tgUserId)) ? String(tgUserId) : (PRIVATE_CHAT_RE.test(chat) ? chat : undefined);
  const ids = [...new Set([chat, tg].filter(Boolean) as string[])];

  // 1) Shu Telegram boshqa xodimga bog'langan bo'lsa — undan uziladi (bitta Telegram ↔ bitta xodim)
  const others: any[] = await User.find({ _id: { $ne: uid }, $or: [{ telegramChatId: { $in: ids } }, { telegramUserId: { $in: ids } }] })
    .select('_id').lean();
  const otherIds = others.map((o) => String(o._id));
  if (otherIds.length) {
    await User.updateMany({ _id: { $in: otherIds } }, { $unset: { telegramChatId: 1, telegramUserId: 1, lastReminderMsgId: 1 } });
    await forgetAiTelegram(otherIds, 'telegram_moved');
  }
  // Boshqa xodimning AI kontaktida shu id qolgan bo'lsa (eski kod bilan bog'lash) — u ham tozalanadi
  if (tg) {
    const stale: any[] = await AiEmployeeContact.find({ 'telegram.tgUserId': tg, employeeId: { $ne: uid } }).select('employeeId').lean();
    if (stale.length) await forgetAiTelegram(stale.map((s) => String(s.employeeId)), 'telegram_moved');
  }

  // 2) Xodimning o'zidagi boshqa (eski) Telegram — uziladi va xabar beriladi
  const me: any = await User.findById(uid).select('telegramChatId telegramUserId language').lean();
  if (!me) return;
  const oldChat = me.telegramChatId && String(me.telegramChatId) !== chat ? String(me.telegramChatId) : undefined;
  const oldTg = me.telegramUserId && String(me.telegramUserId) !== tg ? String(me.telegramUserId) : undefined;
  await User.updateOne({ _id: uid }, tg
    ? { $set: { telegramChatId: chat, telegramUserId: tg } }
    : { $set: { telegramChatId: chat }, $unset: { telegramUserId: 1 } });
  if (oldChat || oldTg) {
    await forgetAiTelegram([uid], 'telegram_moved');
    await disconnectChat(oldChat, me.language, 'moved');
  }

  // 3) AI kontakti — darhol yangi Telegram id bilan (qo'ng'iroqlar va kiruvchi qo'ng'iroqni tanish)
  invalidateActor(uid);
  await onBotLinked(uid);
}
