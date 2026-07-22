const TelegramBot = require('node-telegram-bot-api');
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import User from '../models/User';
import Transaction from '../models/Transaction';
import Material from '../models/Material';
import Message from '../models/Message';
import Group from '../models/Group';
import { initRegistrationScene, isInRegistration } from './registrationScene';
import { emitToUser, emitToGroup } from './socket';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined');
}

export const bot = new TelegramBot(token, { polling: true });

// ─── Role-based keyboards ──────────────────────────────────────────────────────
const SITE_URL = process.env.SITE_URL || 'http://localhost:5173';
const isHttps = SITE_URL.startsWith('https');
// Bot media fayllarni /uploads orqali serverdan qaytarish uchun — bu backend'ning
// o'z ochiq manzili (SITE_URL frontend manzili, bunga mos kelmaydi).
const BACKEND_URL = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

const ADMIN_KEYBOARD = {
  keyboard: [
    isHttps
      ? [{ text: '🌐 Saytga kirish', web_app: { url: SITE_URL } }]
      : [{ text: '🌐 Saytga kirish: ' + SITE_URL }],
    [{ text: '💬 Chat' }],
    [{ text: '📋 Kutilayotgan tasdiqlar' }],
    [{ text: '💰 Moliyaviy holat' }, { text: '🏗 Obyektlar' }],
    [{ text: '👥 Xodimlar ro\'yxati' }, { text: '📊 Hisobot' }],
    [{ text: '💳 Obuna holati' }],
  ],
  resize_keyboard: true,
};

const USER_KEYBOARD = {
  keyboard: [
    isHttps
      ? [{ text: '🌐 Saytga kirish', web_app: { url: SITE_URL } }]
      : [{ text: '🌐 Saytga kirish: ' + SITE_URL }],
    [{ text: '💬 Chat' }],
    [{ text: '📦 Menga kelgan yukxatlar' }],
    [{ text: '📤 Yuborgan yukxatlarim' }],
    [{ text: '📬 Menga kelgan to\'lovlar' }],
  ],
  resize_keyboard: true,
};

// ─── Bot ichidan chat (kontakt/guruh tanlab yozish) ─────────────────────────────
// Xotiradagi holat: chatId → tanlangan suhbat. Server qayta ishga tushsa
// tozalanadi — foydalanuvchi "💬 Chat" tugmasini qayta bosadi, katta muammo emas.
interface BotChatSession { targetType: 'user' | 'group'; targetId: string; targetName: string; myUserId: string; }
const chatSessions = new Map<number, BotChatSession>();
const EXIT_CHAT_TEXT = '🔚 Chatni tugatish';
const chatExitKeyboard = { keyboard: [[{ text: EXIT_CHAT_TEXT }]], resize_keyboard: true };

// Telegramdan kelgan faylni (photo/video/voice/document) yuklab, /uploads ichiga
// saqlaydi va saytdagi Message.mediaUrl bilan bir xil ko'rinishdagi to'liq URL qaytaradi.
async function downloadTelegramFileToUploads(fileId: string, ext: string): Promise<{ url: string; size: number }> {
  const fileLink = await bot.getFileLink(fileId);
  const resp = await fetch(fileLink);
  const buf = Buffer.from(await resp.arrayBuffer());
  const filename = `chat_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
  const destDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, filename), buf);
  return { url: `${BACKEND_URL}/uploads/${filename}`, size: buf.length };
}

// Bot suhbatidan yaratilgan xabarni saqlaydi, socket orqali saytga yuboradi.
async function relayBotMessageToSite(session: BotChatSession, data: {
  text?: string; type?: 'image' | 'video' | 'file' | 'audio' | 'location';
  mediaUrl?: string; fileName?: string; fileSize?: number; location?: { lat: number; lng: number };
}) {
  let companyId: string | undefined;
  if (session.targetType === 'group') {
    const group = await Group.findById(session.targetId).select('companyId').lean();
    companyId = group?.companyId;
  } else {
    const me = await User.findById(session.myUserId).select('companyId').lean();
    companyId = me?.companyId;
  }
  const msg = await Message.create({
    fromUserId: session.myUserId,
    toUserId: session.targetType === 'user' ? session.targetId : '',
    ...(session.targetType === 'group' && { groupId: session.targetId }),
    text: data.text || '',
    timestamp: new Date().toISOString(),
    read: false,
    ...(data.type && { type: data.type }),
    ...(data.mediaUrl && { mediaUrl: data.mediaUrl }),
    ...(data.fileName && { fileName: data.fileName }),
    ...(data.fileSize != null && { fileSize: data.fileSize }),
    ...(data.location && { location: data.location }),
    ...(companyId && { companyId }),
  });
  const payload = { ...msg.toObject(), id: msg._id };
  if (session.targetType === 'group') emitToGroup(session.targetId, 'message:new', payload);
  else { emitToUser(session.targetId, 'message:new', payload); emitToUser(session.myUserId, 'message:new', payload); }
}

const isAdmin = (role: string) => role === 'direktor' || role === 'orinbosar';
const isDev = (role: string) => role === 'dasturchi';

function fmt(n: number) {
  return Math.round(n).toLocaleString('uz-UZ') + ' so\'m';
}

const DEVELOPER_KEYBOARD = {
  keyboard: [
    isHttps
      ? [{ text: '🌐 Saytga kirish', web_app: { url: SITE_URL } }]
      : [{ text: '🌐 Saytga kirish: ' + SITE_URL }],
    [{ text: '🏢 Firmalar ro\'yxati' }, { text: '👥 Barcha foydalanuvchilar' }],
    [{ text: '💳 Barcha obunalar' }, { text: '📊 Umumiy statistika' }],
  ],
  resize_keyboard: true,
};

// ─── /start command ────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg: any) => {
  const chatId = msg.chat.id;
  // Deep-link token bilan /start bo'lsa (masalan "/start abc123") — registration
  // scene ushlaydi. Bu yerda darhol chiqamiz (double-reply bo'lmasin).
  if ((msg.text || '').trim().split(/\s+/).length > 1) return;
  // Check if this chatId already belongs to a user
  const existing = await User.findOne({ telegramChatId: chatId.toString() }).catch(() => null);
  if (existing) {
    const keyboard = isDev(existing.role) ? DEVELOPER_KEYBOARD : isAdmin(existing.role) ? ADMIN_KEYBOARD : USER_KEYBOARD;
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
      { parse_mode: 'Markdown', reply_markup: isDev(user.role) ? DEVELOPER_KEYBOARD : isAdmin(user.role) ? ADMIN_KEYBOARD : USER_KEYBOARD }
    );
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, '⚠️ Tizimda xatolik. Keyinroq qayta urinib ko\'ring.');
  }
});

// ─── Text message handler — main menu ─────────────────────────────────────────
bot.on('message', async (msg: any) => {
  const chatId = msg.chat.id;
  if (isInRegistration(chatId)) return; // self-signup scene o'zi ushlaydi

  // ── Bot ichidan chat rejimi — matn, rasm/video/ovoz/fayl/lokatsiya bo'lishi mumkin ──
  const activeChat = chatSessions.get(chatId);
  if (activeChat) {
    if (msg.text === EXIT_CHAT_TEXT) {
      chatSessions.delete(chatId);
      const u = await User.findById(activeChat.myUserId).catch(() => null);
      const kb = u && isDev(u.role) ? DEVELOPER_KEYBOARD : u && isAdmin(u.role) ? ADMIN_KEYBOARD : USER_KEYBOARD;
      bot.sendMessage(chatId, `Chat tugatildi (${activeChat.targetName}).`, { reply_markup: kb });
      return;
    }
    try {
      if (msg.text) {
        await relayBotMessageToSite(activeChat, { text: msg.text });
      } else if (msg.photo?.length) {
        const largest = msg.photo[msg.photo.length - 1];
        const { url, size } = await downloadTelegramFileToUploads(largest.file_id, '.jpg');
        await relayBotMessageToSite(activeChat, { type: 'image', mediaUrl: url, fileSize: size, text: msg.caption || '' });
      } else if (msg.video) {
        const { url, size } = await downloadTelegramFileToUploads(msg.video.file_id, '.mp4');
        await relayBotMessageToSite(activeChat, { type: 'video', mediaUrl: url, fileSize: size, text: msg.caption || '' });
      } else if (msg.voice) {
        const { url, size } = await downloadTelegramFileToUploads(msg.voice.file_id, '.ogg');
        await relayBotMessageToSite(activeChat, { type: 'audio', mediaUrl: url, fileSize: size });
      } else if (msg.document) {
        const ext = path.extname(msg.document.file_name || '') || '';
        const { url, size } = await downloadTelegramFileToUploads(msg.document.file_id, ext);
        await relayBotMessageToSite(activeChat, { type: 'file', mediaUrl: url, fileName: msg.document.file_name, fileSize: size, text: msg.caption || '' });
      } else if (msg.location) {
        await relayBotMessageToSite(activeChat, { type: 'location', location: { lat: msg.location.latitude, lng: msg.location.longitude } });
      } else {
        bot.sendMessage(chatId, 'Bu turdagi xabar hali qo\'llab-quvvatlanmaydi.');
        return;
      }
    } catch (err) {
      console.error('[bot chat relay]', err);
      bot.sendMessage(chatId, '⚠️ Yuborishda xatolik yuz berdi.');
    }
    return;
  }

  if (msg.contact || !msg.text) return;
  const text = msg.text;

  if (text.startsWith('/start')) return; // /start va /start <token> — yuqorida/scene'da

  const user = await User.findOne({ telegramChatId: chatId.toString() }).catch(() => null);
  if (!user) {
    bot.sendMessage(chatId, '❗ Avval ro\'yxatdan o\'ting: /start');
    return;
  }

  const admin = isAdmin(user.role);
  const developer = isDev(user.role);

  // ── Chat (kontakt yoki guruh tanlab yozish) — hamma rol uchun ────────────
  if (text === '💬 Chat') {
    try {
      const filter = user.companyId ? { companyId: user.companyId } : {};
      const [contacts, groups] = await Promise.all([
        User.find({ ...filter, _id: { $ne: user._id } }).select('firstName lastName role').limit(30).lean(),
        Group.find({ memberIds: String(user._id) }).select('name').limit(30).lean(),
      ]);
      if (contacts.length === 0 && groups.length === 0) {
        bot.sendMessage(chatId, 'Hozircha yozadigan kontakt yoki guruh yo\'q.');
        return;
      }
      const rows: any[][] = [];
      groups.forEach((g: any) => rows.push([{ text: `👥 ${g.name}`, callback_data: `chatpick_group_${g._id}` }]));
      contacts.forEach((c: any) => rows.push([{ text: `${c.firstName} ${c.lastName || ''}`.trim(), callback_data: `chatpick_user_${c._id}` }]));
      bot.sendMessage(chatId, 'Kimga yozmoqchisiz?', { reply_markup: { inline_keyboard: rows } });
    } catch (err) {
      console.error('[bot chat picker]', err);
      bot.sendMessage(chatId, '⚠️ Xatolik.');
    }
    return;
  }

  // ── DEVELOPER commands ────────────────────────────────────────────────────
  if (developer) {
    if (text === '🏢 Firmalar ro\'yxati') {
      try {
        const Company = require('../models/Company').default;
        const firms = await Company.find({}).select('name branchId status').lean();
        if (firms.length === 0) {
          bot.sendMessage(chatId, 'Firma yo\'q.', { reply_markup: DEVELOPER_KEYBOARD });
          return;
        }
        const lines = firms.map((c: any, i: number) =>
          `${i + 1}. *${c.name}* (${c.branchId || '—'}) — ${c.status || '?'}`
        ).join('\n');
        bot.sendMessage(chatId, `🏢 *Firmalar:*\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: DEVELOPER_KEYBOARD });
      } catch {
        bot.sendMessage(chatId, '⚠️ Xatolik.', { reply_markup: DEVELOPER_KEYBOARD });
      }
      return;
    }

    if (text === '👥 Barcha foydalanuvchilar') {
      try {
        const allUsers = await User.find({}).select('firstName lastName role phone companyId').lean().limit(30);
        const Company = require('../models/Company').default;
        const companies = await Company.find({}).select('name').lean();
        const cMap: Record<string, string> = {};
        (companies as any[]).forEach((c: any) => { cMap[String(c._id)] = c.name; });
        const lines = (allUsers as any[]).map(u =>
          `• *${u.firstName} ${u.lastName || ''}* — ${u.role}\n  ${u.phone || '—'} | ${cMap[String(u.companyId)] || '—'}`
        ).join('\n');
        bot.sendMessage(chatId, `👥 *Foydalanuvchilar:*\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: DEVELOPER_KEYBOARD });
      } catch {
        bot.sendMessage(chatId, '⚠️ Xatolik.', { reply_markup: DEVELOPER_KEYBOARD });
      }
      return;
    }

    if (text === '💳 Barcha obunalar') {
      try {
        const Subscription = require('../models/Subscription').default;
        const Company = require('../models/Company').default;
        const subs = await Subscription.find({}).sort({ createdAt: -1 }).limit(20).lean();
        if (subs.length === 0) {
          bot.sendMessage(chatId, 'Obuna yo\'q.', { reply_markup: DEVELOPER_KEYBOARD });
          return;
        }
        const companies = await Company.find({}).select('name').lean();
        const cMap: Record<string, string> = {};
        (companies as any[]).forEach((c: any) => { cMap[String(c._id)] = c.name; });
        const lines = (subs as any[]).map((s: any) => {
          const statusIcon = s.status === 'active' ? '✅' : s.status === 'pending' ? '⏳' : '❌';
          return `${statusIcon} *${cMap[String(s.companyId)] || '—'}* — ${s.selectedPlan || s.plan || '—'}`;
        }).join('\n');
        bot.sendMessage(chatId, `💳 *Obunalar:*\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: DEVELOPER_KEYBOARD });
      } catch {
        bot.sendMessage(chatId, '⚠️ Xatolik.', { reply_markup: DEVELOPER_KEYBOARD });
      }
      return;
    }

    if (text === '📊 Umumiy statistika') {
      try {
        const Company = require('../models/Company').default;
        const Subscription = require('../models/Subscription').default;
        const [firmCount, userCount, activeSubs, pendingSubs] = await Promise.all([
          Company.countDocuments({}),
          User.countDocuments({ role: { $ne: 'dasturchi' } }),
          Subscription.countDocuments({ status: 'active' }),
          Subscription.countDocuments({ status: 'pending' }),
        ]);
        bot.sendMessage(chatId,
          `📊 *Umumiy statistika*\n\n🏢 Firmalar: *${firmCount}*\n👥 Foydalanuvchilar: *${userCount}*\n✅ Faol obunalar: *${activeSubs}*\n⏳ Kutilayotgan: *${pendingSubs}*`,
          { parse_mode: 'Markdown', reply_markup: DEVELOPER_KEYBOARD }
        );
      } catch {
        bot.sendMessage(chatId, '⚠️ Xatolik.', { reply_markup: DEVELOPER_KEYBOARD });
      }
      return;
    }

    bot.sendMessage(chatId, 'Menyudan birini tanlang:', { reply_markup: DEVELOPER_KEYBOARD });
    return;
  }

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
        const filter = user.companyId ? { companyId: user.companyId } : {};
        const objects = await ObjectModel.find(filter).limit(20);
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
        const filter = user.companyId ? { companyId: user.companyId } : {};
        const companyUsers = await User.find(filter).select('firstName lastName role phone');
        const lines = companyUsers.map(u => `• *${u.firstName} ${u.lastName || ''}* — ${u.role}\n  📞 ${u.phone}`).join('\n');
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

  // ── Obuna holati (faqat rahbar/o'rinbosar va dasturchi) ──────────────────
  if (text === '💳 Obuna holati') {
    if (!admin && !developer) {
      bot.sendMessage(chatId, 'Bu bo\'lim faqat rahbar va o\'rinbosar uchun.', { reply_markup: USER_KEYBOARD });
      return;
    }
    try {
      const Subscription = require('../models/Subscription').default;
      const sub = user.companyId ? await Subscription.findOne({ companyId: user.companyId }).sort({ createdAt: -1 }) : null;
      if (!sub) {
        bot.sendMessage(chatId, '📭 Obuna ma\'lumoti topilmadi.', { reply_markup: admin ? ADMIN_KEYBOARD : USER_KEYBOARD });
        return;
      }
      const now = new Date();
      let statusText = '';
      if (sub.status === 'pending') statusText = '⏳ Admin tasdiqini kutmoqda';
      else if (sub.status === 'active') {
        const daysLeft = sub.currentPeriodEnd
          ? Math.max(0, Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / 86400000))
          : null;
        statusText = daysLeft !== null ? `✅ Faol (${daysLeft} kun qoldi)` : '✅ Faol';
      } else if (sub.status === 'expired') statusText = '🔴 Muddati tugagan';
      else if (sub.status === 'rejected') statusText = '❌ Rad etilgan';
      else statusText = sub.status;
      const endDate = sub.currentPeriodEnd ? sub.currentPeriodEnd.toLocaleDateString('uz-UZ') : '—';
      await bot.sendMessage(chatId,
        `💳 <b>Obuna holati</b>\n\nHolat: ${statusText}\nTugash: <b>${endDate}</b>\n\nSavollar uchun: <a href="https://t.me/Sadriddinov_Jahongir">@Sadriddinov_Jahongir</a>`,
        { parse_mode: 'HTML', reply_markup: developer ? DEVELOPER_KEYBOARD : admin ? ADMIN_KEYBOARD : USER_KEYBOARD }
      );
    } catch { bot.sendMessage(chatId, '⚠️ Xatolik.'); }
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

  // ── Chat uchun kontakt/guruh tanlash ──────────────────────────────────────
  if (data.startsWith('chatpick_user_') || data.startsWith('chatpick_group_')) {
    if (!user) { await bot.answerCallbackQuery(query.id, { text: 'Avval ro\'yxatdan o\'ting.' }); return; }
    const isGroup = data.startsWith('chatpick_group_');
    const targetId = data.replace(isGroup ? 'chatpick_group_' : 'chatpick_user_', '');
    try {
      let targetName = '';
      if (isGroup) {
        const g = await Group.findById(targetId).select('name memberIds').lean();
        if (!g || !g.memberIds.includes(String(user._id))) { await bot.answerCallbackQuery(query.id, { text: 'Guruh topilmadi.' }); return; }
        targetName = g.name;
      } else {
        const u = await User.findById(targetId).select('firstName lastName').lean();
        if (!u) { await bot.answerCallbackQuery(query.id, { text: 'Foydalanuvchi topilmadi.' }); return; }
        targetName = `${u.firstName} ${u.lastName || ''}`.trim();
      }
      chatSessions.set(chatId, { targetType: isGroup ? 'group' : 'user', targetId, targetName, myUserId: String(user._id) });
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId,
        `💬 Endi *${targetName}* bilan suhbatdasiz.\nMatn, rasm, video, ovozli xabar, fayl yoki lokatsiya yuborishingiz mumkin.\n\nChiqish uchun pastdagi tugmani bosing.`,
        { parse_mode: 'Markdown', reply_markup: chatExitKeyboard }
      );
    } catch (err) {
      console.error('[bot chatpick]', err);
      await bot.answerCallbackQuery(query.id, { text: '⚠️ Xatolik.' });
    }
    return;
  }

  // ── Obuna tasdiqlash/rad etish (dasturchi inline keyboard) ───────────────────
  if (data.startsWith('sub_approve_') || data.startsWith('sub_reject_')) {
    const isApprove = data.startsWith('sub_approve_');
    const subId = data.replace('sub_approve_', '').replace('sub_reject_', '');
    try {
      const Subscription = require('../models/Subscription').default;
      const Company = require('../models/Company').default;
      const { PLAN_CONFIG } = require('../routes/subscriptions');
      const sub = await Subscription.findById(subId);
      if (!sub) { await bot.answerCallbackQuery(query.id, { text: 'Obuna topilmadi!' }); return; }
      if (sub.status !== 'pending') { await bot.answerCallbackQuery(query.id, { text: 'Bu obuna allaqachon qayta ishlangan.' }); return; }
      if (isApprove) {
        const planKey = sub.selectedPlan || 'bepul';
        const planInfo = PLAN_CONFIG[planKey] || PLAN_CONFIG['bepul'] || PLAN_CONFIG['1month'];
        const now = new Date();
        const expiresAt = new Date(now.getTime() + planInfo.days * 86400000);
        sub.status = 'active'; sub.approvedAt = now; sub.currentPeriodStart = now; sub.currentPeriodEnd = expiresAt;
        await sub.save();
        await Company.findByIdAndUpdate(sub.companyId, { status: 'ACTIVE' }).catch(() => {});
        if (sub.userId) {
          const notUser = await User.findById(sub.userId).catch(() => null);
          if (notUser?.telegramChatId) {
            const expStr = expiresAt.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
            await bot.sendMessage(notUser.telegramChatId,
              `✅ <b>Tabriklaymiz!</b>\n\nSizning obunangiz tasdiqlandi!\n\n📦 Tarif: <b>${planInfo.label}</b>\n📅 Muddat: <b>${expStr}</b> gacha\n\nEndi tizimga kirishingiz mumkin:\n${process.env.SITE_URL || 'http://localhost:5173'}`,
              { parse_mode: 'HTML' }
            ).catch(() => {});
          }
        }
        await bot.answerCallbackQuery(query.id, { text: '✅ Obuna tasdiqlandi!' });
        await bot.editMessageText(`✅ Obuna tasdiqlandi (${planInfo.label})`, { chat_id: chatId, message_id: messageId }).catch(() => {});
      } else {
        sub.status = 'rejected'; sub.rejectedAt = new Date(); await sub.save();
        if (sub.userId) {
          const notUser = await User.findById(sub.userId).catch(() => null);
          if (notUser?.telegramChatId) {
            await bot.sendMessage(notUser.telegramChatId,
              `❌ <b>Obuna rad etildi</b>\n\nTo'lov va savollar uchun: <a href="https://t.me/Sadriddinov_Jahongir">@Sadriddinov_Jahongir</a>`,
              { parse_mode: 'HTML' }
            ).catch(() => {});
          }
        }
        await bot.answerCallbackQuery(query.id, { text: '❌ Obuna rad etildi.' });
        await bot.editMessageText('❌ Obuna rad etildi', { chat_id: chatId, message_id: messageId }).catch(() => {});
      }
    } catch (err) {
      console.error('Bot sub callback error:', err);
      await bot.answerCallbackQuery(query.id, { text: '⚠️ Xatolik!' });
    }
    return;
  }

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
      if (!user || String(tx.toUserId) !== String(user._id)) {
        await bot.answerCallbackQuery(query.id, { text: 'Bu sizga tegishli emas — faqat qabul qiluvchi tasdiqlashi mumkin!' });
        return;
      }

      tx.status = isConfirm ? 'confirmed' : 'rejected';
      if (isConfirm) {
        tx.confirmedDate = new Date().toISOString().split('T')[0];
        if (user) tx.confirmedById = user._id.toString();
      }
      await tx.save();

      // Material qoldig'ini yangilash + moliyaviy chiqim yozuvi yaratish
      // (veb-ilovadagi PATCH /:id/confirm bilan bir xil mantiq).
      let expenseTx: any = null;
      if (isConfirm && tx.type === 'transfer' && tx.projectId && tx.materialName && tx.quantity) {
        try {
          await Material.findOneAndUpdate(
            { objectId: tx.projectId, name: tx.materialName },
            { $inc: { sent: tx.quantity, remaining: -tx.quantity } }
          );
          const mat = await Material.findOne({ objectId: tx.projectId, name: tx.materialName });
          const unitPrice = tx.price ?? mat?.price;
          if (unitPrice) {
            expenseTx = await Transaction.create({
              type: 'material',
              status: 'confirmed',
              date: tx.date,
              amount: unitPrice * tx.quantity,
              description: `Material: ${tx.materialName} (${tx.quantity} ${tx.unit})`,
              projectId: tx.projectId,
              createdById: tx.fromUserId,
              confirmedById: tx.confirmedById,
              confirmedDate: tx.confirmedDate,
              sourceTransferId: String(tx._id),
              companyId: tx.companyId,
            });
          }
        } catch (matErr) {
          console.error('[bot] material/expense update error:', matErr);
        }
      }

      // Realtime — ochiq veb-sessiyalarni darhol yangilash
      const txPayload = { ...tx.toObject(), id: tx._id };
      if (tx.toUserId) emitToUser(String(tx.toUserId), 'transaction:update', txPayload);
      if (tx.fromUserId) emitToUser(String(tx.fromUserId), 'transaction:update', txPayload);
      if (expenseTx) {
        const expPayload = { ...expenseTx.toObject(), id: expenseTx._id };
        if (tx.fromUserId) emitToUser(String(tx.fromUserId), 'transaction:new', expPayload);
        if (tx.toUserId) emitToUser(String(tx.toUserId), 'transaction:new', expPayload);
      }

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
