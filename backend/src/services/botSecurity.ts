// Telegram bot xavfsizligi uchun kichik, yon ta'sirsiz yordamchilar — bot.ts'ni import qilmaydi
// (u import paytida botni ishga tushiradi), shu sabab sinovlarda alohida tekshirish mumkin.
import crypto from 'crypto';
import type { RequestHandler } from 'express';
import User from '../models/User';
import { safeEqual } from '../utils/tokens';

export const BOT_WEBHOOK_PATH = '/api/bot/webhook';
export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

// Webhook maxfiy kaliti bot tokenidan DETERMINISTIK hosil qilinadi — har bir instance (va har 5 daqiqalik
// qayta ro'yxatdan o'tkazish) bir xil qiymat beradi, alohida env o'zgaruvchi shart emas.
// base64url → faqat [A-Za-z0-9_-], 43 belgi (Telegram cheklovi: 1-256 belgi).
export function deriveWebhookSecret(botToken: string): string {
  return crypto.createHmac('sha256', botToken).update('webhook').digest('base64url');
}

// POST /api/bot/webhook — faqat Telegram'ning o'zi yuborgan (to'g'ri X-Telegram-Bot-Api-Secret-Token
// sarlavhali) so'rovlar botga uzatiladi. Aks holda istalgan kishi soxta update (contact, callback_query)
// yuborib boshqa foydalanuvchi nomidan harakat qila olardi.
export function createBotWebhookHandler(processUpdate: (update: any) => void, secret: string): RequestHandler {
  return (req, res) => {
    const given = String(req.get(TELEGRAM_SECRET_HEADER) || '');
    if (!secret || !given || !safeEqual(given, secret)) {
      res.sendStatus(401);
      return;
    }
    try {
      processUpdate(req.body);
    } catch {
      // Noto'g'ri payload — jim o'tkazib yuboramiz (bot handlerlari o'z xatolarini loglar)
    }
    res.sendStatus(200);
  };
}

// Obunani tasdiqlash/rad etish (sub_approve_/sub_reject_) — FAQAT dasturchi. Tugmalar register.ts'da
// DEVELOPER_CHAT_ID chatiga yuboriladi — u chat dasturchi hisobiga bog'lanmagan bo'lsa ham (masalan, guruh)
// tasdiqlash ishlashda davom etsin (server sozlamasi; webhook endi maxfiy sarlavha bilan — chatId soxta emas).
export function canDecideSubscription(
  user: { role?: string | null } | null | undefined,
  chatId?: string | number | null,
  devChatId: string | undefined = process.env.DEVELOPER_CHAT_ID,
): boolean {
  if (!!user && user.role === 'dasturchi') return true;
  return !!devChatId && chatId != null && String(chatId) === String(devChatId).trim();
}

// Firma rahbarlari (direktor/o'rinbosar) — FAQAT berilgan firma ichidan. companyId bo'lmasa — hech kim
// (aks holda xabar barcha firmalar rahbarlariga ketib qolardi).
export async function sendToCompanyAdmins(
  send: (chatId: string, text: string, opts: any) => Promise<any>,
  companyId: string,
  message: string,
  inlineKeyboard?: any[][],
): Promise<number> {
  if (!companyId) return 0;
  const admins = await User.find({
    companyId: String(companyId),
    role: { $in: ['direktor', 'orinbosar'] },
    telegramChatId: { $exists: true, $ne: '' },
  }).select('telegramChatId').lean();
  let sent = 0;
  for (const admin of admins as any[]) {
    if (!admin.telegramChatId) continue;
    const opts: any = { parse_mode: 'Markdown' };
    if (inlineKeyboard) opts.reply_markup = { inline_keyboard: inlineKeyboard };
    await send(admin.telegramChatId, message, opts).then(() => { sent++; }, console.error);
  }
  return sent;
}
