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
import { tb, langLabel, BotLang } from '../i18n/bot';

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

// Klaviaturalar til bo'yicha — foydalanuvchining o'zi tanlagan (yoki saytdan
// sinxronlangan) tiliga qarab tugma matnlari o'zgaradi.
const openSiteBtn = (lang?: BotLang) => isHttps
  ? { text: tb(lang, 'kb_openSite'), web_app: { url: SITE_URL } }
  : { text: tb(lang, 'kb_openSiteUrl', { url: SITE_URL }) };

const ADMIN_KEYBOARD = (lang?: BotLang) => ({
  keyboard: [
    [openSiteBtn(lang)],
    [{ text: tb(lang, 'kb_chat') }],
    [{ text: tb(lang, 'kb_pendingApprovals') }],
    [{ text: tb(lang, 'kb_financeStatus') }, { text: tb(lang, 'kb_objects') }],
    [{ text: tb(lang, 'kb_staffList') }, { text: tb(lang, 'kb_report') }],
    [{ text: tb(lang, 'kb_subscriptionStatus') }, { text: tb(lang, 'kb_language') }],
  ],
  resize_keyboard: true,
});

const USER_KEYBOARD = (lang?: BotLang) => ({
  keyboard: [
    [openSiteBtn(lang)],
    [{ text: tb(lang, 'kb_chat') }],
    [{ text: tb(lang, 'kb_incomingTransfers') }],
    [{ text: tb(lang, 'kb_sentTransfers') }],
    [{ text: tb(lang, 'kb_incomingPayments') }],
    [{ text: tb(lang, 'kb_language') }],
  ],
  resize_keyboard: true,
});

// ─── Bot ichidan chat (kontakt/guruh tanlab yozish) ─────────────────────────────
// Xotiradagi holat: chatId → tanlangan suhbat. Server qayta ishga tushsa
// tozalanadi — foydalanuvchi "💬 Chat" tugmasini qayta bosadi, katta muammo emas.
interface BotChatSession { targetType: 'user' | 'group'; targetId: string; targetName: string; myUserId: string; lang?: BotLang; }
const chatSessions = new Map<number, BotChatSession>();
const chatExitKeyboard = (lang?: BotLang) => ({ keyboard: [[{ text: tb(lang, 'exitChat') }]], resize_keyboard: true });

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

function fmt(n: number, lang?: BotLang) {
  return Math.round(n).toLocaleString('uz-UZ') + ' ' + tb(lang, 'currencySuffix');
}

const DEVELOPER_KEYBOARD = (lang?: BotLang) => ({
  keyboard: [
    [openSiteBtn(lang)],
    [{ text: tb(lang, 'kb_firmsList') }, { text: tb(lang, 'kb_allUsers') }],
    [{ text: tb(lang, 'kb_allSubscriptions') }, { text: tb(lang, 'kb_generalStats') }],
    [{ text: tb(lang, 'kb_language') }],
  ],
  resize_keyboard: true,
});

// ─── /start command ────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg: any) => {
  const chatId = msg.chat.id;
  // Deep-link token bilan /start bo'lsa (masalan "/start abc123") — registration
  // scene ushlaydi. Bu yerda darhol chiqamiz (double-reply bo'lmasin).
  if ((msg.text || '').trim().split(/\s+/).length > 1) return;
  // Check if this chatId already belongs to a user
  const existing = await User.findOne({ telegramChatId: chatId.toString() }).catch(() => null);
  if (existing) {
    const lang = existing.language as BotLang | undefined;
    const keyboard = isDev(existing.role) ? DEVELOPER_KEYBOARD(lang) : isAdmin(existing.role) ? ADMIN_KEYBOARD(lang) : USER_KEYBOARD(lang);
    bot.sendMessage(chatId,
      tb(lang, 'startWelcomeBack', { name: existing.firstName }),
      { reply_markup: keyboard }
    );
    return;
  }

  bot.sendMessage(chatId,
    tb(undefined, 'startWelcomeNew'),
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [[{ text: tb(undefined, 'sharePhoneBtn'), request_contact: true }]],
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
    bot.sendMessage(chatId, tb(undefined, 'contactMismatch'));
    return;
  }

  let phone = contact.phone_number;
  if (!phone.startsWith('+')) phone = '+' + phone;

  try {
    const user = await User.findOne({ phone });
    if (!user) {
      bot.sendMessage(chatId, tb(undefined, 'contactNotFound'));
      return;
    }

    user.telegramChatId = chatId.toString();
    await user.save();

    const lang = user.language as BotLang | undefined;
    bot.sendMessage(chatId,
      tb(lang, 'contactConfirmed', { name: `${user.firstName} ${user.lastName || ''}`.trim(), role: user.role }),
      { parse_mode: 'Markdown', reply_markup: isDev(user.role) ? DEVELOPER_KEYBOARD(lang) : isAdmin(user.role) ? ADMIN_KEYBOARD(lang) : USER_KEYBOARD(lang) }
    );
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, tb(undefined, 'genericError'));
  }
});

// ─── Text message handler — main menu ─────────────────────────────────────────
bot.on('message', async (msg: any) => {
  const chatId = msg.chat.id;
  if (isInRegistration(chatId)) return; // self-signup scene o'zi ushlaydi

  // ── Bot ichidan chat rejimi — matn, rasm/video/ovoz/fayl/lokatsiya bo'lishi mumkin ──
  const activeChat = chatSessions.get(chatId);
  if (activeChat) {
    if (msg.text === tb(activeChat.lang, 'exitChat')) {
      chatSessions.delete(chatId);
      const u = await User.findById(activeChat.myUserId).catch(() => null);
      const ulang = u?.language as BotLang | undefined;
      const kb = u && isDev(u.role) ? DEVELOPER_KEYBOARD(ulang) : u && isAdmin(u.role) ? ADMIN_KEYBOARD(ulang) : USER_KEYBOARD(ulang);
      bot.sendMessage(chatId, tb(ulang, 'chatSessionEnd', { name: activeChat.targetName }), { reply_markup: kb });
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
        bot.sendMessage(chatId, tb(activeChat.lang, 'chatUnsupportedType'));
        return;
      }
    } catch (err) {
      console.error('[bot chat relay]', err);
      bot.sendMessage(chatId, tb(activeChat.lang, 'chatSendError'));
    }
    return;
  }

  if (msg.contact || !msg.text) return;
  const text = msg.text;

  if (text.startsWith('/start')) return; // /start va /start <token> — yuqorida/scene'da

  const user = await User.findOne({ telegramChatId: chatId.toString() }).catch(() => null);
  if (!user) {
    bot.sendMessage(chatId, tb(undefined, 'notRegistered'));
    return;
  }

  const admin = isAdmin(user.role);
  const developer = isDev(user.role);
  const lang = user.language as BotLang | undefined;

  // ── Til tanlash — hamma rol uchun ─────────────────────────────────────────
  if (text === tb(lang, 'kb_language')) {
    bot.sendMessage(chatId, tb(lang, 'langPrompt'), {
      reply_markup: {
        inline_keyboard: [[
          { text: langLabel('uz'), callback_data: 'setlang_uz' },
          { text: langLabel('uz-cyrl'), callback_data: 'setlang_uz-cyrl' },
          { text: langLabel('ru'), callback_data: 'setlang_ru' },
        ]],
      },
    });
    return;
  }

  // ── Chat (kontakt yoki guruh tanlab yozish) — hamma rol uchun ────────────
  if (text === tb(lang, 'kb_chat')) {
    try {
      const filter = user.companyId ? { companyId: user.companyId } : {};
      const [contacts, groups] = await Promise.all([
        User.find({ ...filter, _id: { $ne: user._id } }).select('firstName lastName role').limit(30).lean(),
        Group.find({ memberIds: String(user._id) }).select('name').limit(30).lean(),
      ]);
      if (contacts.length === 0 && groups.length === 0) {
        bot.sendMessage(chatId, tb(lang, 'chatNoContacts'));
        return;
      }
      const rows: any[][] = [];
      groups.forEach((g: any) => rows.push([{ text: `👥 ${g.name}`, callback_data: `chatpick_group_${g._id}` }]));
      contacts.forEach((c: any) => rows.push([{ text: `${c.firstName} ${c.lastName || ''}`.trim(), callback_data: `chatpick_user_${c._id}` }]));
      bot.sendMessage(chatId, tb(lang, 'chatWhoTo'), { reply_markup: { inline_keyboard: rows } });
    } catch (err) {
      console.error('[bot chat picker]', err);
      bot.sendMessage(chatId, tb(lang, 'genericError'));
    }
    return;
  }

  // ── DEVELOPER commands ────────────────────────────────────────────────────
  if (developer) {
    if (text === tb(user.language, 'kb_firmsList')) {
      try {
        const Company = require('../models/Company').default;
        const firms = await Company.find({}).select('name branchId status').lean();
        if (firms.length === 0) {
          bot.sendMessage(chatId, tb(user.language, 'devNoFirms'), { reply_markup: DEVELOPER_KEYBOARD(user.language) });
          return;
        }
        const lines = firms.map((c: any, i: number) =>
          `${i + 1}. *${c.name}* (${c.branchId || '—'}) — ${c.status || '?'}`
        ).join('\n');
        bot.sendMessage(chatId, `${tb(user.language, 'devFirmsHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: DEVELOPER_KEYBOARD(user.language) });
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: DEVELOPER_KEYBOARD(user.language) });
      }
      return;
    }

    if (text === tb(user.language, 'kb_allUsers')) {
      try {
        const allUsers = await User.find({}).select('firstName lastName role phone companyId').lean().limit(30);
        const Company = require('../models/Company').default;
        const companies = await Company.find({}).select('name').lean();
        const cMap: Record<string, string> = {};
        (companies as any[]).forEach((c: any) => { cMap[String(c._id)] = c.name; });
        const lines = (allUsers as any[]).map(u =>
          `• *${u.firstName} ${u.lastName || ''}* — ${u.role}\n  ${u.phone || '—'} | ${cMap[String(u.companyId)] || '—'}`
        ).join('\n');
        bot.sendMessage(chatId, `${tb(user.language, 'devUsersHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: DEVELOPER_KEYBOARD(user.language) });
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: DEVELOPER_KEYBOARD(user.language) });
      }
      return;
    }

    if (text === tb(user.language, 'kb_allSubscriptions')) {
      try {
        const Subscription = require('../models/Subscription').default;
        const Company = require('../models/Company').default;
        const subs = await Subscription.find({}).sort({ createdAt: -1 }).limit(20).lean();
        if (subs.length === 0) {
          bot.sendMessage(chatId, tb(user.language, 'devNoSubs'), { reply_markup: DEVELOPER_KEYBOARD(user.language) });
          return;
        }
        const companies = await Company.find({}).select('name').lean();
        const cMap: Record<string, string> = {};
        (companies as any[]).forEach((c: any) => { cMap[String(c._id)] = c.name; });
        const lines = (subs as any[]).map((s: any) => {
          const statusIcon = s.status === 'active' ? '✅' : s.status === 'pending' ? '⏳' : '❌';
          return `${statusIcon} *${cMap[String(s.companyId)] || '—'}* — ${s.selectedPlan || s.plan || '—'}`;
        }).join('\n');
        bot.sendMessage(chatId, `${tb(user.language, 'devSubsHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: DEVELOPER_KEYBOARD(user.language) });
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: DEVELOPER_KEYBOARD(user.language) });
      }
      return;
    }

    if (text === tb(user.language, 'kb_generalStats')) {
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
          tb(user.language, 'devStatsBody', { firmCount, userCount, activeSubs, pendingSubs }),
          { parse_mode: 'Markdown', reply_markup: DEVELOPER_KEYBOARD(user.language) }
        );
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: DEVELOPER_KEYBOARD(user.language) });
      }
      return;
    }

    bot.sendMessage(chatId, tb(user.language, 'chooseFromMenu'), { reply_markup: DEVELOPER_KEYBOARD(user.language) });
    return;
  }

  // ── ADMIN commands ────────────────────────────────────────────────────────
  if (admin) {
    if (text === tb(user.language, 'kb_pendingApprovals')) {
      try {
        const pending = await Transaction.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(10);
        if (pending.length === 0) {
          bot.sendMessage(chatId, tb(user.language, 'admNoPending'), { reply_markup: ADMIN_KEYBOARD(user.language) });
          return;
        }
        for (const tx of pending) {
          let label = '';
          if (tx.type === 'transfer') {
            label = tb(user.language, 'admTransferLabel', { materialName: tx.materialName || '—', quantity: tx.quantity ?? '—', unit: tx.unit || '', sender: tx.fromUserName || '—' });
          } else {
            label = tb(user.language, 'admPaymentLabel', { description: tx.description || '—', amount: fmt(tx.amount || 0, user.language), date: tx.date || '—' });
          }
          await bot.sendMessage(chatId, label, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: tb(user.language, 'confirmBtn'), callback_data: `confirm_${tx._id}` },
                { text: tb(user.language, 'rejectBtn'), callback_data: `reject_${tx._id}` },
              ]],
            },
          });
        }
      } catch (err) {
        bot.sendMessage(chatId, tb(user.language, 'genericError'));
      }
      return;
    }

    if (text === tb(user.language, 'kb_financeStatus')) {
      try {
        const confirmed = await Transaction.find({ status: 'confirmed', type: { $ne: 'transfer' } });
        const total = confirmed.reduce((s: number, t: any) => s + (t.amount || 0), 0);
        const pending = await Transaction.find({ status: 'pending', type: { $ne: 'transfer' } });
        const pendTotal = pending.reduce((s: number, t: any) => s + (t.amount || 0), 0);
        bot.sendMessage(chatId,
          tb(user.language, 'admFinanceStatusBody', { total: fmt(total, user.language), pendTotal: fmt(pendTotal, user.language), diff: fmt(total - pendTotal, user.language) }),
          { parse_mode: 'Markdown', reply_markup: ADMIN_KEYBOARD(user.language) }
        );
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: ADMIN_KEYBOARD(user.language) });
      }
      return;
    }

    if (text === tb(user.language, 'kb_objects')) {
      try {
        const ObjectModel = require('../models/Object').default;
        const filter = user.companyId ? { companyId: user.companyId } : {};
        const objects = await ObjectModel.find(filter).limit(20);
        if (objects.length === 0) {
          bot.sendMessage(chatId, tb(user.language, 'admNoObjects'), { reply_markup: ADMIN_KEYBOARD(user.language) });
          return;
        }
        const lines = objects.map((o: any, i: number) => `${i + 1}. *${o.name}*\n   📍 ${o.location || '—'} | Budjet: ${fmt(o.budget || 0, user.language)}`).join('\n\n');
        bot.sendMessage(chatId, `${tb(user.language, 'admObjectsHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: ADMIN_KEYBOARD(user.language) });
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: ADMIN_KEYBOARD(user.language) });
      }
      return;
    }

    if (text === tb(user.language, 'kb_staffList')) {
      try {
        const filter = user.companyId ? { companyId: user.companyId } : {};
        const companyUsers = await User.find(filter).select('firstName lastName role phone');
        const lines = companyUsers.map(u => `• *${u.firstName} ${u.lastName || ''}* — ${u.role}\n  📞 ${u.phone}`).join('\n');
        bot.sendMessage(chatId, `${tb(user.language, 'admStaffHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: ADMIN_KEYBOARD(user.language) });
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: ADMIN_KEYBOARD(user.language) });
      }
      return;
    }

    if (text === tb(user.language, 'kb_report')) {
      try {
        const allTx = await Transaction.find({});
        const transfers = allTx.filter((t: any) => t.type === 'transfer');
        const expenses = allTx.filter((t: any) => t.type !== 'transfer');
        const confExp = expenses.filter((t: any) => t.status === 'confirmed').reduce((s: number, t: any) => s + (t.amount || 0), 0);
        const pendCount = allTx.filter((t: any) => t.status === 'pending').length;
        bot.sendMessage(chatId,
          tb(user.language, 'admReportBody', { transfersCount: transfers.length, confExp: fmt(confExp, user.language), pendCount }),
          { parse_mode: 'Markdown', reply_markup: ADMIN_KEYBOARD(user.language) }
        );
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: ADMIN_KEYBOARD(user.language) });
      }
      return;
    }

    // Unknown admin message — show keyboard
    bot.sendMessage(chatId, tb(user.language, 'chooseFromMenu'), { reply_markup: ADMIN_KEYBOARD(user.language) });
    return;
  }

  // ── Obuna holati (faqat rahbar/o'rinbosar va dasturchi) ──────────────────
  if (text === tb(lang, 'kb_subscriptionStatus')) {
    if (!admin && !developer) {
      bot.sendMessage(chatId, tb(lang, 'subOnlyBoss'), { reply_markup: USER_KEYBOARD(lang) });
      return;
    }
    try {
      const Subscription = require('../models/Subscription').default;
      const sub = user.companyId ? await Subscription.findOne({ companyId: user.companyId }).sort({ createdAt: -1 }) : null;
      if (!sub) {
        bot.sendMessage(chatId, tb(lang, 'subNotFound'), { reply_markup: admin ? ADMIN_KEYBOARD(lang) : USER_KEYBOARD(lang) });
        return;
      }
      const now = new Date();
      let statusText = '';
      if (sub.status === 'pending') statusText = tb(lang, 'subPending');
      else if (sub.status === 'active') {
        const daysLeft = sub.currentPeriodEnd
          ? Math.max(0, Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / 86400000))
          : null;
        statusText = daysLeft !== null ? tb(lang, 'subActiveDays', { days: daysLeft }) : tb(lang, 'subActive');
      } else if (sub.status === 'expired') statusText = tb(lang, 'subExpired');
      else if (sub.status === 'rejected') statusText = tb(lang, 'subRejected');
      else statusText = sub.status;
      const endDate = sub.currentPeriodEnd ? sub.currentPeriodEnd.toLocaleDateString('uz-UZ') : '—';
      await bot.sendMessage(chatId,
        tb(lang, 'subStatusMsg', { status: statusText, end: endDate }),
        { parse_mode: 'HTML', reply_markup: developer ? DEVELOPER_KEYBOARD(lang) : admin ? ADMIN_KEYBOARD(lang) : USER_KEYBOARD(lang) }
      );
    } catch { bot.sendMessage(chatId, tb(lang, 'genericError')); }
    return;
  }

  // ── NON-ADMIN commands ────────────────────────────────────────────────────
  if (text === tb(user.language, 'kb_incomingTransfers')) {
    try {
      const txs = await Transaction.find({
        type: 'transfer',
        toUserId: user._id.toString(),
        status: { $in: ['pending', 'confirmed'] }
      }).sort({ createdAt: -1 }).limit(10);

      if (txs.length === 0) {
        bot.sendMessage(chatId, tb(user.language, 'usrNoIncomingTransfers'), { reply_markup: USER_KEYBOARD(user.language) });
        return;
      }
      for (const tx of txs) {
        const statusLabel = tx.status === 'confirmed' ? tb(user.language, 'statusConfirmed') : tb(user.language, 'statusPending');
        const msg_text = tb(user.language, 'usrIncomingTransferMsg', { name: tx.materialName || '—', qty: tx.quantity ?? '—', unit: tx.unit || '', status: statusLabel, sender: tx.fromUserName || '—', date: tx.date || '—' });
        if (tx.status === 'pending') {
          await bot.sendMessage(chatId, msg_text, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: tb(user.language, 'acceptBtn'), callback_data: `confirm_${tx._id}` },
                { text: tb(user.language, 'rejectBtn'), callback_data: `reject_${tx._id}` },
              ]],
            },
          });
        } else {
          await bot.sendMessage(chatId, msg_text, { parse_mode: 'Markdown' });
        }
      }
    } catch {
      bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: USER_KEYBOARD(user.language) });
    }
    return;
  }

  if (text === tb(user.language, 'kb_sentTransfers')) {
    try {
      const txs = await Transaction.find({
        type: 'transfer',
        fromUserId: user._id.toString(),
      }).sort({ createdAt: -1 }).limit(10);

      if (txs.length === 0) {
        bot.sendMessage(chatId, tb(user.language, 'usrNoSentTransfers'), { reply_markup: USER_KEYBOARD(user.language) });
        return;
      }
      const lines = txs.map(tx => {
        const st = tx.status === 'confirmed' ? '✅' : tx.status === 'rejected' ? '❌' : '⏳';
        return tb(user.language, 'usrSentTransferRow', { icon: st, name: tx.materialName || '—', qty: tx.quantity ?? '—', unit: tx.unit || '', date: tx.date || '—' });
      }).join('\n\n');
      bot.sendMessage(chatId, `${tb(user.language, 'usrSentTransfersHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: USER_KEYBOARD(user.language) });
    } catch {
      bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: USER_KEYBOARD(user.language) });
    }
    return;
  }

  if (text === tb(user.language, 'kb_incomingPayments')) {
    try {
      const txs = await Transaction.find({
        type: { $ne: 'transfer' },
        toUserId: user._id.toString(),
      }).sort({ createdAt: -1 }).limit(10);

      if (txs.length === 0) {
        bot.sendMessage(chatId, tb(user.language, 'usrNoIncomingPayments'), { reply_markup: USER_KEYBOARD(user.language) });
        return;
      }
      for (const tx of txs) {
        const statusLabel = tx.status === 'confirmed' ? tb(user.language, 'statusConfirmed') : tb(user.language, 'statusPending');
        const msg_text = tb(user.language, 'usrIncomingPaymentMsg', { amount: fmt(tx.amount || 0, user.language), reason: tx.description || '—', status: statusLabel, date: tx.date || '—' });
        if (tx.status === 'pending') {
          await bot.sendMessage(chatId, msg_text, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: tb(user.language, 'acceptedByMeBtn'), callback_data: `confirm_${tx._id}` },
                { text: tb(user.language, 'rejectBtn'), callback_data: `reject_${tx._id}` },
              ]],
            },
          });
        } else {
          await bot.sendMessage(chatId, msg_text, { parse_mode: 'Markdown' });
        }
      }
    } catch {
      bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: USER_KEYBOARD(user.language) });
    }
    return;
  }

  // Unknown non-admin message
  bot.sendMessage(chatId, tb(user.language, 'chooseFromMenu'), { reply_markup: USER_KEYBOARD(user.language) });
});

// ─── Inline button handler — confirm / reject ──────────────────────────────────
bot.on('callback_query', async (query: any) => {
  const data: string = query.data || '';
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;

  const user = await User.findOne({ telegramChatId: chatId?.toString() }).catch(() => null);
  const lang = user?.language as BotLang | undefined;

  // ── Til o'zgartirish ───────────────────────────────────────────────────────
  if (data.startsWith('setlang_')) {
    const newLang = data.replace('setlang_', '') as BotLang;
    if (!user) { await bot.answerCallbackQuery(query.id); return; }
    try {
      user.language = newLang;
      await user.save();
      // Real vaqtda sinxronlash — profilda ham darhol shu tilga o'tsin.
      emitToUser(String(user._id), 'user:language', { language: newLang });
      await bot.answerCallbackQuery(query.id, { text: langLabel(newLang) });
      const kb = isDev(user.role) ? DEVELOPER_KEYBOARD(newLang) : isAdmin(user.role) ? ADMIN_KEYBOARD(newLang) : USER_KEYBOARD(newLang);
      await bot.sendMessage(chatId, tb(newLang, 'langSaved', { lang: langLabel(newLang) }), { reply_markup: kb });
    } catch (err) {
      console.error('[bot setlang]', err);
      await bot.answerCallbackQuery(query.id, { text: tb(user.language, 'genericError') });
    }
    return;
  }

  // ── Chat uchun kontakt/guruh tanlash ──────────────────────────────────────
  if (data.startsWith('chatpick_user_') || data.startsWith('chatpick_group_')) {
    if (!user) { await bot.answerCallbackQuery(query.id, { text: tb(undefined, 'chatLoginFirst') }); return; }
    const isGroup = data.startsWith('chatpick_group_');
    const targetId = data.replace(isGroup ? 'chatpick_group_' : 'chatpick_user_', '');
    try {
      let targetName = '';
      if (isGroup) {
        const g = await Group.findById(targetId).select('name memberIds').lean();
        if (!g || !g.memberIds.includes(String(user._id))) { await bot.answerCallbackQuery(query.id, { text: tb(lang, 'chatGroupNotFound') }); return; }
        targetName = g.name;
      } else {
        const u = await User.findById(targetId).select('firstName lastName').lean();
        if (!u) { await bot.answerCallbackQuery(query.id, { text: tb(lang, 'chatUserNotFound') }); return; }
        targetName = `${u.firstName} ${u.lastName || ''}`.trim();
      }
      chatSessions.set(chatId, { targetType: isGroup ? 'group' : 'user', targetId, targetName, myUserId: String(user._id), lang });
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId,
        tb(lang, 'chatSessionStart', { name: targetName }),
        { parse_mode: 'Markdown', reply_markup: chatExitKeyboard(lang) }
      );
    } catch (err) {
      console.error('[bot chatpick]', err);
      await bot.answerCallbackQuery(query.id, { text: tb(lang, 'genericError') });
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
      if (!sub) { await bot.answerCallbackQuery(query.id, { text: tb(lang, 'notFoundGeneric') }); return; }
      if (sub.status !== 'pending') { await bot.answerCallbackQuery(query.id, { text: tb(lang, 'alreadyProcessed') }); return; }
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
            const notLang = notUser.language as BotLang | undefined;
            const expStr = expiresAt.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
            await bot.sendMessage(notUser.telegramChatId,
              tb(notLang, 'subApprovedNotify', { planLabel: planInfo.label, expStr, siteUrl: process.env.SITE_URL || 'http://localhost:5173' }),
              { parse_mode: 'HTML' }
            ).catch(() => {});
          }
        }
        await bot.answerCallbackQuery(query.id, { text: tb(lang, 'subApprovedShort', { planLabel: planInfo.label }) });
        await bot.editMessageText(tb(lang, 'subApprovedShort', { planLabel: planInfo.label }), { chat_id: chatId, message_id: messageId }).catch(() => {});
      } else {
        sub.status = 'rejected'; sub.rejectedAt = new Date(); await sub.save();
        if (sub.userId) {
          const notUser = await User.findById(sub.userId).catch(() => null);
          if (notUser?.telegramChatId) {
            await bot.sendMessage(notUser.telegramChatId,
              tb(notUser.language as BotLang | undefined, 'subRejectedNotify'),
              { parse_mode: 'HTML' }
            ).catch(() => {});
          }
        }
        await bot.answerCallbackQuery(query.id, { text: tb(lang, 'subRejectedShort') });
        await bot.editMessageText(tb(lang, 'subRejectedShort'), { chat_id: chatId, message_id: messageId }).catch(() => {});
      }
    } catch (err) {
      console.error('Bot sub callback error:', err);
      await bot.answerCallbackQuery(query.id, { text: tb(lang, 'genericError') });
    }
    return;
  }

  if (data.startsWith('confirm_') || data.startsWith('reject_')) {
    const isConfirm = data.startsWith('confirm_');
    const txId = data.replace('confirm_', '').replace('reject_', '');

    try {
      const tx = await Transaction.findById(txId);
      if (!tx) {
        await bot.answerCallbackQuery(query.id, { text: tb(lang, 'notFoundGeneric') });
        return;
      }
      if (tx.status !== 'pending') {
        await bot.answerCallbackQuery(query.id, { text: tb(lang, 'alreadyProcessed') });
        return;
      }
      if (!user || String(tx.toUserId) !== String(user._id)) {
        await bot.answerCallbackQuery(query.id, { text: tb(lang, 'notYoursOnlyRecipient') });
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
              toUserId: tx.toUserId,
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

      const resultText = isConfirm ? tb(lang, 'txConfirmedResult') : tb(lang, 'txRejectedResult');
      await bot.answerCallbackQuery(query.id, { text: resultText });

      // Edit the original message to remove inline buttons
      const label = tx.type === 'transfer' ? `${tx.materialName} — ${tx.quantity} ${tx.unit}` : `${tx.description} — ${fmt(tx.amount || 0, lang)}`;
      await bot.editMessageText(
        isConfirm ? tb(lang, 'txConfirmedEdit', { label }) : tb(lang, 'txRejectedEdit', { label }),
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
      ).catch(() => {});

      // Notify the other party (ularning O'ZINING tilida)
      const notifyUserId = isConfirm
        ? (tx.fromUserId || tx.createdById)
        : (tx.toUserId);

      if (notifyUserId) {
        const notifyUser = await User.findById(notifyUserId).catch(() => null);
        if (notifyUser && notifyUser.telegramChatId) {
          const notifyLang = notifyUser.language as BotLang | undefined;
          const actorName = user?.firstName || (notifyLang === 'ru' ? 'Получатель' : 'Qabul qiluvchi');
          const notifyMsg = isConfirm
            ? tb(notifyLang, 'notifyConfirmedToSender', { name: actorName, label })
            : tb(notifyLang, 'notifyRejectedToSender', { name: actorName, label });
          await bot.sendMessage(notifyUser.telegramChatId, notifyMsg).catch(console.error);
        }
      }
    } catch (err) {
      console.error('Bot callback error:', err);
      await bot.answerCallbackQuery(query.id, { text: tb(lang, 'genericError') });
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
