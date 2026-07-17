const TelegramBot = require('node-telegram-bot-api');
import dotenv from 'dotenv';
import User from '../models/User';
import Transaction from '../models/Transaction';
import { initRegistrationScene, isInRegistration } from './registrationScene';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined');
}

export const bot = new TelegramBot(token, { polling: true });

// ─── Role-based keyboards ──────────────────────────────────────────────────────
const SITE_URL = process.env.SITE_URL || 'http://localhost:5173';
const isHttps = SITE_URL.startsWith('https');

const ADMIN_KEYBOARD = {
  keyboard: [
    isHttps
      ? [{ text: '🌐 Saytga kirish', web_app: { url: SITE_URL } }]
      : [{ text: '🌐 Saytga kirish: ' + SITE_URL }],
    [{ text: '📋 Kutilayotgan tasdiqlar' }],
    [{ text: '💰 Moliyaviy holat' }, { text: '🏗 Obyektlar' }],
    [{ text: '👥 Xodimlar ro\'yxati' }, { text: '📊 Hisobot' }],
  ],
  resize_keyboard: true,
};

const USER_KEYBOARD = {
  keyboard: [
    isHttps
      ? [{ text: '🌐 Saytga kirish', web_app: { url: SITE_URL } }]
      : [{ text: '🌐 Saytga kirish: ' + SITE_URL }],
    [{ text: '📦 Menga kelgan yukxatlar' }],
    [{ text: '📤 Yuborgan yukxatlarim' }],
    [{ text: '📬 Menga kelgan to\'lovlar' }],
  ],
  resize_keyboard: true,
};

const isAdmin = (role: string) => role === 'direktor' || role === 'orinbosar';

function fmt(n: number) {
  return n.toLocaleString('uz-UZ') + ' so\'m';
}

// ─── /start command ────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg: any) => {
  const chatId = msg.chat.id;
  // Deep-link token bilan /start bo'lsa (masalan "/start abc123") — registration
  // scene ushlaydi. Bu yerda darhol chiqamiz (double-reply bo'lmasin).
  if ((msg.text || '').trim().split(/\s+/).length > 1) return;
  // Check if this chatId already belongs to a user
  const existing = await User.findOne({ telegramChatId: chatId.toString() }).catch(() => null);
  if (existing) {
    const keyboard = isAdmin(existing.role) ? ADMIN_KEYBOARD : USER_KEYBOARD;
    bot.sendMessage(chatId,
      `✅ Xush kelibsiz, ${existing.firstName}!\n\nSiz tizimga ulanganmiz. Quyidagi menyudan foydalaning:`,
      { reply_markup: keyboard }
    );
    return;
  }

  bot.sendMessage(chatId,
    '👋 Assalomu alaykum! *QurilishERP* botiga xush kelibsiz.\n\nTizimga kirish uchun telefon raqamingizni yuboring:',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [[{ text: '📱 Telefon raqamni yuborish', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }
  );
});

// ─── Contact handler — register user ──────────────────────────────────────────
bot.on('contact', async (msg: any) => {
  const chatId = msg.chat.id;
  if (isInRegistration(chatId)) return; // self-signup scene o'zi ushlaydi
  const contact = msg.contact;

  if (!contact || contact.user_id !== msg.from?.id) {
    bot.sendMessage(chatId, '❗ Iltimos, o\'z raqamingizni yuboring.');
    return;
  }

  let phone = contact.phone_number;
  if (!phone.startsWith('+')) phone = '+' + phone;

  try {
    const user = await User.findOne({ phone });
    if (!user) {
      bot.sendMessage(chatId, '❌ Raqamingiz tizimda topilmadi. Administrator bilan bog\'laning.');
      return;
    }

    user.telegramChatId = chatId.toString();
    await user.save();

    bot.sendMessage(chatId,
      `✅ Raqamingiz tasdiqlandi!\n\n👤 *${user.firstName} ${user.lastName || ''}*\n🏷 Lavozim: ${user.role}\n\nEndi saytga qaytib, raqamingizni kiritgan holda "Kodni olish" tugmasini bosing.`,
      { parse_mode: 'Markdown', reply_markup: isAdmin(user.role) ? ADMIN_KEYBOARD : USER_KEYBOARD }
    );
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, '⚠️ Tizimda xatolik. Keyinroq qayta urinib ko\'ring.');
  }
});

// ─── Text message handler — main menu ─────────────────────────────────────────
bot.on('message', async (msg: any) => {
  if (msg.contact || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text;

  if (isInRegistration(chatId)) return; // self-signup scene o'zi ushlaydi
  if (text.startsWith('/start')) return; // /start va /start <token> — yuqorida/scene'da

  const user = await User.findOne({ telegramChatId: chatId.toString() }).catch(() => null);
  if (!user) {
    bot.sendMessage(chatId, '❗ Avval ro\'yxatdan o\'ting: /start');
    return;
  }

  const admin = isAdmin(user.role);

  // ── ADMIN commands ────────────────────────────────────────────────────────
  if (admin) {
    if (text === '📋 Kutilayotgan tasdiqlar') {
      try {
        const pending = await Transaction.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(10);
        if (pending.length === 0) {
          bot.sendMessage(chatId, '✅ Hozircha barcha tasdiqlar tugagan. Yangi tasdiq yo\'q.', { reply_markup: ADMIN_KEYBOARD });
          return;
        }
        for (const tx of pending) {
          let label = '';
          if (tx.type === 'transfer') {
            label = `📦 *Material yukxat*\n${tx.materialName} — ${tx.quantity} ${tx.unit}\nYuboruvchi: ${tx.fromUserName || '—'}`;
          } else {
            label = `💰 *To'lov*\n${tx.description}\nSumma: ${fmt(tx.amount || 0)}\nSana: ${tx.date || '—'}`;
          }
          await bot.sendMessage(chatId, label, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Tasdiqlash', callback_data: `confirm_${tx._id}` },
                { text: '❌ Rad etish', callback_data: `reject_${tx._id}` },
              ]],
            },
          });
        }
      } catch (err) {
        bot.sendMessage(chatId, '⚠️ Ma\'lumot olishda xatolik.');
      }
      return;
    }

    if (text === '💰 Moliyaviy holat') {
      try {
        const confirmed = await Transaction.find({ status: 'confirmed', type: { $ne: 'transfer' } });
        const total = confirmed.reduce((s: number, t: any) => s + (t.amount || 0), 0);
        const pending = await Transaction.find({ status: 'pending', type: { $ne: 'transfer' } });
        const pendTotal = pending.reduce((s: number, t: any) => s + (t.amount || 0), 0);
        bot.sendMessage(chatId,
          `📊 *Moliyaviy holat*\n\n✅ Tasdiqlangan chiqimlar: *${fmt(total)}*\n⏳ Kutilayotgan: *${fmt(pendTotal)}*\n\nFarq: *${fmt(total - pendTotal)}*`,
          { parse_mode: 'Markdown', reply_markup: ADMIN_KEYBOARD }
        );
      } catch {
        bot.sendMessage(chatId, '⚠️ Xatolik.', { reply_markup: ADMIN_KEYBOARD });
      }
      return;
    }

    if (text === '🏗 Obyektlar') {
      try {
        const ObjectModel = require('../models/Object').default;
        const objects = await ObjectModel.find({}).limit(20);
        if (objects.length === 0) {
          bot.sendMessage(chatId, 'Hozircha obyekt yo\'q.', { reply_markup: ADMIN_KEYBOARD });
          return;
        }
        const lines = objects.map((o: any, i: number) => `${i + 1}. *${o.name}*\n   📍 ${o.location || '—'} | Budjet: ${fmt(o.budget || 0)}`).join('\n\n');
        bot.sendMessage(chatId, `🏗 *Obyektlar ro'yxati:*\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: ADMIN_KEYBOARD });
      } catch {
        bot.sendMessage(chatId, '⚠️ Xatolik.', { reply_markup: ADMIN_KEYBOARD });
      }
      return;
    }

    if (text === '👥 Xodimlar ro\'yxati') {
      try {
        const users = await User.find({}).select('firstName lastName role phone');
        const lines = users.map(u => `• *${u.firstName} ${u.lastName || ''}* — ${u.role}\n  📞 ${u.phone}`).join('\n');
        bot.sendMessage(chatId, `👥 *Xodimlar:*\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: ADMIN_KEYBOARD });
      } catch {
        bot.sendMessage(chatId, '⚠️ Xatolik.', { reply_markup: ADMIN_KEYBOARD });
      }
      return;
    }

    if (text === '📊 Hisobot') {
      try {
        const allTx = await Transaction.find({});
        const transfers = allTx.filter((t: any) => t.type === 'transfer');
        const expenses = allTx.filter((t: any) => t.type !== 'transfer');
        const confExp = expenses.filter((t: any) => t.status === 'confirmed').reduce((s: number, t: any) => s + (t.amount || 0), 0);
        const pendCount = allTx.filter((t: any) => t.status === 'pending').length;
        bot.sendMessage(chatId,
          `📊 *Umumiy hisobot*\n\n📦 Jami yukxatlar: *${transfers.length}*\n💰 Jami chiqimlar: *${fmt(confExp)}*\n⏳ Kutilayotgan tasdiqlar: *${pendCount}*`,
          { parse_mode: 'Markdown', reply_markup: ADMIN_KEYBOARD }
        );
      } catch {
        bot.sendMessage(chatId, '⚠️ Xatolik.', { reply_markup: ADMIN_KEYBOARD });
      }
      return;
    }

    // Unknown admin message — show keyboard
    bot.sendMessage(chatId, 'Menyudan birini tanlang:', { reply_markup: ADMIN_KEYBOARD });
    return;
  }

  // ── NON-ADMIN commands ────────────────────────────────────────────────────
  if (text === '📦 Menga kelgan yukxatlar') {
    try {
      const txs = await Transaction.find({
        type: 'transfer',
        toUserId: user._id.toString(),
        status: { $in: ['pending', 'confirmed'] }
      }).sort({ createdAt: -1 }).limit(10);

      if (txs.length === 0) {
        bot.sendMessage(chatId, 'Hozircha siz uchun yukxat yo\'q.', { reply_markup: USER_KEYBOARD });
        return;
      }
      for (const tx of txs) {
        const statusLabel = tx.status === 'confirmed' ? '✅ Tasdiqlangan' : '⏳ Kutilmoqda';
        const msg_text = `📦 *${tx.materialName}*\nMiqdor: ${tx.quantity} ${tx.unit}\nHolat: ${statusLabel}\nYuboruvchi: ${tx.fromUserName || '—'}\nSana: ${tx.date || '—'}`;
        if (tx.status === 'pending') {
          await bot.sendMessage(chatId, msg_text, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Qabul qilish', callback_data: `confirm_${tx._id}` },
                { text: '❌ Rad etish', callback_data: `reject_${tx._id}` },
              ]],
            },
          });
        } else {
          await bot.sendMessage(chatId, msg_text, { parse_mode: 'Markdown' });
        }
      }
    } catch {
      bot.sendMessage(chatId, '⚠️ Xatolik.', { reply_markup: USER_KEYBOARD });
    }
    return;
  }

  if (text === '📤 Yuborgan yukxatlarim') {
    try {
      const txs = await Transaction.find({
        type: 'transfer',
        fromUserId: user._id.toString(),
      }).sort({ createdAt: -1 }).limit(10);

      if (txs.length === 0) {
        bot.sendMessage(chatId, 'Siz hali hech narsa yubormadingiz.', { reply_markup: USER_KEYBOARD });
        return;
      }
      const lines = txs.map(tx => {
        const st = tx.status === 'confirmed' ? '✅' : tx.status === 'rejected' ? '❌' : '⏳';
        return `${st} *${tx.materialName}* — ${tx.quantity} ${tx.unit}\nSana: ${tx.date || '—'}`;
      }).join('\n\n');
      bot.sendMessage(chatId, `📤 *Yuborgan yukxatlarim:*\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: USER_KEYBOARD });
    } catch {
      bot.sendMessage(chatId, '⚠️ Xatolik.', { reply_markup: USER_KEYBOARD });
    }
    return;
  }

  if (text === '📬 Menga kelgan to\'lovlar') {
    try {
      const txs = await Transaction.find({
        type: { $ne: 'transfer' },
        toUserId: user._id.toString(),
      }).sort({ createdAt: -1 }).limit(10);

      if (txs.length === 0) {
        bot.sendMessage(chatId, 'Sizga hali to\'lov yuborilmagan.', { reply_markup: USER_KEYBOARD });
        return;
      }
      for (const tx of txs) {
        const statusLabel = tx.status === 'confirmed' ? '✅ Tasdiqlangan' : '⏳ Kutilmoqda';
        const msg_text = `💰 *To'lov: ${fmt(tx.amount || 0)}*\nSabab: ${tx.description || '—'}\nHolat: ${statusLabel}\nSana: ${tx.date || '—'}`;
        if (tx.status === 'pending') {
          await bot.sendMessage(chatId, msg_text, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Qabul qilganman', callback_data: `confirm_${tx._id}` },
                { text: '❌ Rad etish', callback_data: `reject_${tx._id}` },
              ]],
            },
          });
        } else {
          await bot.sendMessage(chatId, msg_text, { parse_mode: 'Markdown' });
        }
      }
    } catch {
      bot.sendMessage(chatId, '⚠️ Xatolik.', { reply_markup: USER_KEYBOARD });
    }
    return;
  }

  // Unknown non-admin message
  bot.sendMessage(chatId, 'Menyudan birini tanlang:', { reply_markup: USER_KEYBOARD });
});

// ─── Inline button handler — confirm / reject ──────────────────────────────────
bot.on('callback_query', async (query: any) => {
  const data: string = query.data || '';
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;

  const user = await User.findOne({ telegramChatId: chatId?.toString() }).catch(() => null);

  if (data.startsWith('confirm_') || data.startsWith('reject_')) {
    const isConfirm = data.startsWith('confirm_');
    const txId = data.replace('confirm_', '').replace('reject_', '');

    try {
      const tx = await Transaction.findById(txId);
      if (!tx) {
        await bot.answerCallbackQuery(query.id, { text: 'Tranzaksiya topilmadi!' });
        return;
      }
      if (tx.status !== 'pending') {
        await bot.answerCallbackQuery(query.id, { text: 'Bu tranzaksiya allaqachon qayta ishlangan.' });
        return;
      }

      tx.status = isConfirm ? 'confirmed' : 'rejected';
      if (isConfirm) {
        tx.confirmedDate = new Date().toISOString().split('T')[0];
        if (user) tx.confirmedById = user._id.toString();
      }
      await tx.save();

      const resultText = isConfirm ? '✅ Tasdiqlandi!' : '❌ Rad etildi!';
      await bot.answerCallbackQuery(query.id, { text: resultText });

      // Edit the original message to remove inline buttons
      const label = tx.type === 'transfer' ? `${tx.materialName} — ${tx.quantity} ${tx.unit}` : `${tx.description} — ${fmt(tx.amount || 0)}`;
      await bot.editMessageText(
        `${isConfirm ? '✅' : '❌'} *${isConfirm ? 'Tasdiqlandi' : 'Rad etildi'}*: ${label}`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
      ).catch(() => {});

      // Notify the other party
      const notifyUserId = isConfirm
        ? (tx.fromUserId || tx.createdById)
        : (tx.toUserId);

      if (notifyUserId) {
        const notifyUser = await User.findById(notifyUserId).catch(() => null);
        if (notifyUser && notifyUser.telegramChatId) {
          const notifyMsg = isConfirm
            ? `✅ ${user?.firstName || 'Qabul qiluvchi'} sizning "${label}" ni qabul qildi!`
            : `❌ ${user?.firstName || 'Qabul qiluvchi'} "${label}" ni rad etdi.`;
          await bot.sendMessage(notifyUser.telegramChatId, notifyMsg).catch(console.error);
        }
      }
    } catch (err) {
      console.error('Bot callback error:', err);
      await bot.answerCallbackQuery(query.id, { text: '⚠️ Xatolik yuz berdi.' });
    }
  }
});

// ─── Notification helpers (called from routes) ────────────────────────────────
export async function notifyUser(userId: string, message: string) {
  try {
    const user = await User.findById(userId);
    if (user && user.telegramChatId) {
      await bot.sendMessage(user.telegramChatId, message, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    console.error('Notify error:', err);
  }
}

export async function notifyAdmins(message: string, inlineKeyboard?: any[][]) {
  try {
    const admins = await User.find({ role: { $in: ['direktor', 'orinbosar'] }, telegramChatId: { $exists: true, $ne: '' } });
    for (const admin of admins) {
      if (!admin.telegramChatId) continue;
      const opts: any = { parse_mode: 'Markdown' };
      if (inlineKeyboard) opts.reply_markup = { inline_keyboard: inlineKeyboard };
      await bot.sendMessage(admin.telegramChatId, message, opts).catch(console.error);
    }
  } catch (err) {
    console.error('NotifyAdmins error:', err);
  }
}

// v1.2 self-signup scene'ni ulaymiz (alohida fayl, eski handlerlar buzilmaydi)
initRegistrationScene(bot);

console.log('✅ Telegram bot ishga tushdi (rol asosida menyu)');
