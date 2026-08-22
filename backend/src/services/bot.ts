const TelegramBot = require('node-telegram-bot-api');
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import User from '../models/User';
import Transaction from '../models/Transaction';
import Material from '../models/Material';
import Message from '../models/Message';
import Group from '../models/Group';
import Attendance from '../models/Attendance';
import GpsLocation from '../models/GpsLocation';
import { initRegistrationScene, isInRegistration } from './registrationScene';
import { emitToUser, emitToGroup, emitToCompany } from './socket';
import { tb, langLabel, BotLang } from '../i18n/bot';
import { getBackendUrl } from '../utils/backendUrl';
import { uploadFileToCloud } from '../config/cloudinary';
import { todayInTashkent, tashkentHour } from '../utils/tz';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined');
}

// Webhook rejimi: production'da TELEGRAM_WEBHOOK_URL o'rnatilgan bo'lsa,
// webhook ishlatiladi (polling o'chiriladi) — bu Render + local dev bir vaqtda
// ishlaganda kelib chiqadigan 409 Conflict xatosini to'liq bartaraf etadi.
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
const useWebhook = !!webhookUrl;

export const bot = new TelegramBot(token, useWebhook ? { polling: false } : {
  polling: { params: { allowed_updates: ['message', 'edited_message', 'callback_query'] } },
});

// Polling'dagi xatolarni birxil joyda ushlaymiz — webhook ishlab
// tursa umuman chaqirilmaydi (zararsiz), lekin webhook muvaffaqiyatsiz
// bo'lib pollingga qaytilsa (pastda) ham, oddiy local dev polling
// rejimida ham bir xil, tanish xabarlar chiqishi uchun.
bot.on('polling_error', (err: any) => {
  if (err?.code === 'ETELEGRAM' && (err?.response?.statusCode === 409 || String(err?.message).includes('409'))) {
    console.warn('⚠️ Telegram 409 Conflict: boshqa bot instance polling qilmoqda. Production\'da TELEGRAM_WEBHOOK_URL sozlang.');
  } else if (err?.code === 'EFATAL') {
    console.warn('⚠️ Telegram polling to\'xtatildi (EFATAL):', err?.message);
  } else {
    console.error('Telegram polling xatosi:', err?.message || err);
  }
});

if (useWebhook) {
  // Manzilni tozalaymiz — foydalanuvchi TELEGRAM_WEBHOOK_URL'ga oxiriga "/"
  // yoki hatto to'liq "/api/bot/webhook" qo'shib qo'yishi (juda oson xato)
  // "//api/bot/webhook" yoki "/api/bot/webhook/api/bot/webhook" kabi
  // NOTO'G'RI URL hosil qilib, Telegram uni ro'yxatdan o'tkazsa ham, bizning
  // haqiqiy route'imizga hech qachon kelib tushmay, bot BUTUNLAY "o'lik"
  // ko'rinishga sabab bo'lardi.
  const cleanBase = webhookUrl!.replace(/\/+$/, '').replace(/\/api\/bot\/webhook$/, '');
  const fullWebhookUrl = `${cleanBase}/api/bot/webhook`;
  // MUHIM: allowed_updates ANIQ ko'rsatilmasa, Telegram shu webhook uchun
  // OLDINGI sozlamani ishlatadi (birinchi marta hech qachon o'rnatilmagan
  // bo'lsa — standart to'plam, odatda bularning barchasini o'z ichiga oladi,
  // lekin buni ANIQ yozib qo'yish yanada ishonchli: 'edited_message'
  // aynan Telegram'ning "Jonli joylashuv" (Live Location) davomiy
  // yangilanishlari uchun zarur — shu yo'q bo'lib qolsa, ish boshlashda
  // birinchi joylashuv kelib, keyingi yangilanishlar UMUMAN kelmay qoladi.
  bot.setWebHook(fullWebhookUrl, {
    max_connections: 40,
    allowed_updates: ['message', 'edited_message', 'callback_query'],
  })
    .then(() => console.log(`✅ Telegram bot webhook ishga tushdi: ${fullWebhookUrl}`))
    .catch((err: Error) => {
      // XAVFSIZLIK ZAXIRASI: webhook o'rnatilmasa (noto'g'ri URL, Telegram
      // rad etishi va h.k.) — bot polling'siz HAM, webhook'siz HAM (ya'ni
      // BUTUNLAY o'lik) qolib ketmasin uchun pollingga qaytamiz. Bu holat
      // avval sodir bo'lgan: "webhook qo'ysam bot ishlamay qoldi".
      console.error('⚠️ Telegram webhook o\'rnatishda xato — pollingga qaytilmoqda:', err.message);
      // MUHIM: TelegramBotPolling o'z sozlamalarini startPolling()ning
      // argumentidan EMAS, balki bot.options.polling'dan o'qiydi (bu yerda
      // konstruktorda { polling: false } qilib qo'yilgan edi) — shu sabab
      // allowed_updates'ni ANIQ shu yerga, ishga tushirishdan OLDIN yozib
      // qo'yamiz, aks holda 'edited_message' (jonli joylashuv) yana
      // yo'qolib qolardi.
      bot.options.polling = { params: { allowed_updates: ['message', 'edited_message', 'callback_query'] } };
      bot.startPolling()
        .catch((pollErr: Error) => console.error('⚠️ Polling fallback ham muvaffaqiyatsiz:', pollErr.message));
    });
} else {
  // Polling rejimi — local dev uchun
  console.log('✅ Telegram bot polling rejimida ishga tushdi');
}

// ─── Role-based keyboards ──────────────────────────────────────────────────────
const SITE_URL = process.env.SITE_URL || 'http://localhost:5173';
const isHttps = SITE_URL.startsWith('https');
// Bot media fayllarni /uploads orqali serverdan qaytarish uchun — bu backend'ning
// o'z ochiq manzili (SITE_URL frontend manzili, bunga mos kelmaydi).
const BACKEND_URL = getBackendUrl();

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

// "Ishga keldim" tasdiqlangandan keyin, HAQIQIY check-in yozuvi yaratilishidan
// OLDIN — foydalanuvchi Telegram'ning jonli joylashuvini (Live Location)
// ulashishini kutayotgan holat. Faqat shu chatId'dan live_period bilan
// joylashuv kelgach check-in yakunlanadi (aniq foydalanuvchi talabi: "ishga
// keldim bosganda real vaqt joylashuvini yuborish majburiy bo'lsin").
const pendingCheckinLocation = new Map<number, { userId: string; lang?: BotLang }>();

// Telegramdan kelgan faylni (photo/video/voice/document) yuklab, saytdagi
// Message.mediaUrl bilan bir xil ko'rinishdagi to'liq URL qaytaradi.
// MUHIM: avval bu funksiya HAR DOIM lokal diskka ('/uploads') yozib, hech
// qachon Cloudinary'ga urinib ko'rmasdi — oddiy sayt yuklashlari
// (uploadFileToCloud, cloudinary.ts) esa avval Cloudinary'ga urinadi.
// Render'ning bepul/standart tarifida disk EPHEMERAL — har safar server
// qayta ishga tushganda (deploy, spin-down/wake, restart) '/uploads' ichidagi
// hamma narsa YO'QOLADI. Shu sabab bot orqali yuborilgan video/rasm/fayl
// vaqti-vaqti bilan saytda "topilmadi" bo'lib qolardi. Endi bot ham sayt
// bilan bir xil yo'ldan o'tadi: avval vaqtinchalik faylga yozib, keyin
// uploadFileToCloud() chaqiradi (Cloudinary sozlangan bo'lsa doimiy saqlanadi).
async function downloadTelegramFileToUploads(fileId: string, ext: string): Promise<{ url: string; size: number }> {
  const fileLink = await bot.getFileLink(fileId);
  const resp = await fetch(fileLink);
  const buf = Buffer.from(await resp.arrayBuffer());
  const filename = `chat_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
  const destDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const tempPath = path.join(destDir, filename);
  fs.writeFileSync(tempPath, buf);
  try {
    const { url } = await uploadFileToCloud(tempPath, 'qurilish-chat', filename);
    return { url, size: buf.length };
  } catch (err) {
    // Cloudinary muvaffaqiyatsiz bo'lsa — kamida shu server ishga tushib
    // turgan davrda ishlaydigan lokal URL bilan davom etamiz (butunlay
    // muvaffaqiyatsizlikdan ko'ra yaxshiroq).
    console.error('[bot media upload]', err);
    return { url: `${BACKEND_URL}/uploads/${filename}`, size: buf.length };
  }
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
const WORKER_ROLES = ['ishchi', 'prorab', 'brigadir'];
const isWorker = (role: string) => WORKER_ROLES.includes(role);

function fmt(n: number, lang?: BotLang) {
  return Math.round(n).toLocaleString('uz-UZ') + ' ' + tb(lang, 'currencySuffix');
}

// ─── Yo'qlama (attendance) — botда ────────────────────────────────────────────
// MUHIM: bot GPS/joylashuvni doim qabul qiladi (pastda saveLocationFromTelegram),
// clock-in/out holatidan MUSTAQIL — bu saytdagi xatti-harakatdan ATAYLAB farq
// qiladi (saytда GPS check-in'ga bog'liq). clock-in/out tugmalari FAQAT
// yo'qlama (davomat) yozuvini boshqaradi, GPS'ni emas.
function todayDateStr(): string {
  return todayInTashkent();
}
async function getAttendanceStatus(userId: string): Promise<{ status: 'NOT_STARTED' | 'WORKING' | 'FINISHED'; record: any }> {
  const record = await Attendance.findOne({ userId, date: todayDateStr() }).lean();
  if (!record?.checkIn) return { status: 'NOT_STARTED', record: null };
  if (!record.checkOut) return { status: 'WORKING', record };
  return { status: 'FINISHED', record };
}

// Tasdiqlangandan (inline "Ha") keyin haqiqiy check-in/check-out — saytdagi
// /api/attendance/checkin|checkout bilan bir xil mantiq, to'g'ridan-to'g'ri
// Mongoose orqali (bot HTTP so'rov konteksti ichida emas).
async function doCheckIn(user: any, lang?: BotLang): Promise<string> {
  const today = todayDateStr();
  let record = await Attendance.findOne({ userId: String(user._id), date: today });
  if (record?.checkIn) return tb(lang, 'alreadyCheckedIn');
  const now = new Date();
  if (!record) record = new Attendance({ userId: String(user._id), companyId: user.companyId, date: today });
  record.checkIn = now.toISOString();
  record.status = tashkentHour(now) >= 9 ? 'late' : 'present';
  await record.save();
  // MUHIM: bot server (Render) UTC'da ishlaydi — timeZone aniq ko'rsatilmasa
  // foydalanuvchiga UTC vaqti ko'rsatiladi, Toshkent vaqti emas.
  const time = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
  return tb(lang, 'checkInConfirmed', { time });
}
// "0.1 soat" kabi yaxlitlangan-noaniq ko'rinish o'rniga aniq daqiqa hisobidan
// "X soat Y daqiqa" (yoki ru: "X ч Y мин") — checkIn/checkOut ISO
// vaqt tamg'alaridan to'g'ridan-to'g'ri, yaxlitlashsiz hisoblanadi.
function fmtWorkDuration(minutes: number, lang?: BotLang): string {
  if (lang === 'ru') {
    if (minutes < 60) return `${minutes} мин`;
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
  }
  if (minutes < 60) return `${minutes} daqiqa`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m === 0 ? `${h} soat` : `${h} soat ${m} daqiqa`;
}

async function doCheckOut(user: any, lang?: BotLang): Promise<string> {
  const today = todayDateStr();
  const record = await Attendance.findOne({ userId: String(user._id), date: today });
  if (!record?.checkIn) return tb(lang, 'notCheckedInYet');
  if (record.checkOut) return tb(lang, 'alreadyCheckedOut');
  const now = new Date();
  record.checkOut = now.toISOString();
  const ms = now.getTime() - new Date(record.checkIn).getTime();
  const minutes = Math.max(0, Math.round(ms / 60000));
  record.workHours = Math.round((ms / 3600000) * 10) / 10; // eski maydon — hisobotlarda (masalan stats) ishlatiladi, saqlanadi
  await record.save();
  const time = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
  return tb(lang, 'checkOutConfirmed', { time, hours: fmtWorkDuration(minutes, lang) });
}

// Telegramdan kelgan joylashuvni GpsLocation'ga saqlaydi — saytdagi
// POST /api/gps bilan bir xil ma'lumot shakli, xuddi shunday socket orqali
// admin xaritasiga real-time yetkaziladi. Bot HTTP so'rov konteksti ichida
// ISHLAMAYDI (Express middleware/tenant-context yo'q), shu sabab companyId'ni
// stamped() o'rniga to'g'ridan-to'g'ri userdan olamiz (relayBotMessageToSite'da
// qilingani kabi).
async function saveLocationFromTelegram(chatId: number, lat: number, lng: number, accuracy?: number, source: 'bot_live' | 'bot_once' = 'bot_once') {
  const user = await User.findOne({ telegramChatId: chatId.toString() }).select('companyId').lean();
  if (!user) return;
  const loc = await GpsLocation.create({ userId: String(user._id), companyId: user.companyId, lat, lng, accuracy, timestamp: new Date(), source });
  // MUHIM: avval global broadcast() — BOSHQA firmalarga ham GPS koordinatasi
  // sızardi. Endi faqat SHU foydalanuvchining o'z firma xonasiga.
  emitToCompany(user.companyId, 'gps:update', { userId: String(user._id), companyId: user.companyId, lat, lng, accuracy, timestamp: loc.timestamp, source });
}

const CHECKIN_ONLY_KEYBOARD = (lang?: BotLang) => ({
  keyboard: [[{ text: tb(lang, 'kb_checkIn') }]],
  resize_keyboard: true,
});

const DEVELOPER_KEYBOARD = (lang?: BotLang) => ({
  keyboard: [
    [openSiteBtn(lang)],
    [{ text: tb(lang, 'kb_firmsList') }, { text: tb(lang, 'kb_allUsers') }],
    [{ text: tb(lang, 'kb_allSubscriptions') }, { text: tb(lang, 'kb_generalStats') }],
    [{ text: tb(lang, 'kb_language') }],
  ],
  resize_keyboard: true,
});

// USER_KEYBOARD'ning ustiga "Ish tugatdim" qatori qo'shilgan varianti — ishchi
// WORKING holatida (checkin bosilgan, checkout hali yo'q) ko'radi.
const USER_KEYBOARD_WITH_CHECKOUT = (lang?: BotLang) => {
  const base = USER_KEYBOARD(lang);
  return { ...base, keyboard: [[{ text: tb(lang, 'kb_checkOut') }], ...base.keyboard] };
};

// Markaziy klaviatura tanlovchi — HAR BIR joyda (start, kontakt tasdiqlash,
// til almashtirish, va h.k.) shu orqali chaqiriladi, shunda ishchi/prorab/
// brigadir uchun "hali ishga kelmagan" holatida FAQAT "Ishga keldim" tugmasi
// ko'rinishi bitta joyda kafolatlanadi (foydalanuvchi aniq talabi).
// MUHIM cheklov: bu faqat KLAVIATURA ko'rinishini boshqaradi — Telegram
// klaviatura tugmalari faqat oddiy matn yuboradi, bot ularni matn sifatida
// qabul qiladi; platforma darajasida foydalanuvchini biror buyruqni QO'LDA
// yozishdan (garchi tugma ko'rinmasa ham) to'liq to'sib bo'lmaydi — bu
// Telegram Bot API'ning o'zi cheklovi, kodning kamchiligi emas.
async function keyboardForUser(user: any, lang?: BotLang) {
  if (isDev(user.role)) return DEVELOPER_KEYBOARD(lang);
  if (isAdmin(user.role)) return ADMIN_KEYBOARD(lang);
  if (isWorker(user.role)) {
    const { status } = await getAttendanceStatus(String(user._id));
    if (status === 'NOT_STARTED') return CHECKIN_ONLY_KEYBOARD(lang);
    if (status === 'WORKING') return USER_KEYBOARD_WITH_CHECKOUT(lang);
    return USER_KEYBOARD(lang);
  }
  return USER_KEYBOARD(lang);
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
    const lang = existing.language as BotLang | undefined;
    const keyboard = await keyboardForUser(existing, lang);
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
    let welcomeText = tb(lang, 'contactConfirmed', { name: `${user.firstName} ${user.lastName || ''}`.trim(), role: user.role });
    // Ishchi/prorab/brigadir uchun — bot GPS'ni doim qabul qilishini va uzluksiz
    // kuzatuv uchun Telegram'ning Live Location funksiyasidan foydalanishni
    // shu yerda, ro'yxatdan o'tishning bir martalik onboarding lahzasida aytamiz.
    if (isWorker(user.role)) welcomeText += `\n\n${tb(lang, 'locationLiveHint')}`;
    bot.sendMessage(chatId, welcomeText,
      { parse_mode: 'Markdown', reply_markup: await keyboardForUser(user, lang) }
    );
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, tb(undefined, 'genericError'));
  }
});

// ─── Jonli joylashuv (Live Location) yangilanishlari ──────────────────────────
// Foydalanuvchi Telegram'ning o'z "Share Live Location" funksiyasini yoqqach,
// har bir yangi koordinata YANGI 'message' sifatida EMAS, balki asl xabarni
// TAHRIRLASH ('edited_message') sifatida keladi — shuning uchun alohida handler.
bot.on('edited_message', async (msg: any) => {
  if (!msg.location) return;
  const chatId = msg.chat.id;
  saveLocationFromTelegram(chatId, msg.location.latitude, msg.location.longitude, msg.location.horizontal_accuracy, 'bot_live').catch(() => {});
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
      const kb = u ? await keyboardForUser(u, ulang) : USER_KEYBOARD(ulang);
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

  // ── GPS/joylashuv — chat rejimidan TASHQARIDA ham, HAR DOIM qabul qilinadi ──
  // MUHIM: bu clock-in/out holatidan MUSTAQIL — foydalanuvchi aniq talabi:
  // "botда GPS doim ishlasin". Telegram'ning o'zi cheklovi: bot foydalanuvchidan
  // "jonli joylashuv" (Live Location) ulashishni SO'RAY olmaydi (faqat bir
  // martalik oddiy joylashuv so'rovi mumkin, quyida /start'da taklif qilinadi) —
  // doimiy kuzatuv uchun foydalanuvchi buni Telegram interfeysidan o'zi
  // yoqishi kerak; shundan keyin kelgan HAR BIR yangilanish shu yerda ushlanadi
  // (bir martalik ulashish uchun 'message', jonli yangilanishlar uchun pastdagi
  // 'edited_message' handleri).
  if (msg.location && !msg.text) {
    const isLive = !!msg.location.live_period;
    saveLocationFromTelegram(chatId, msg.location.latitude, msg.location.longitude, msg.location.horizontal_accuracy, isLive ? 'bot_live' : 'bot_once').catch(() => {});

    // "Ishga keldim" tasdiqlangandan keyin jonli joylashuv kutilayotgan bo'lsa —
    // shu yerda yakunlaymiz (faqat live_period bilan kelgan joylashuv qabul
    // qilinadi, bir martalik pin yetarli emas — aniq talab qilingan).
    const pending = pendingCheckinLocation.get(chatId);
    if (pending) {
      if (isLive) {
        pendingCheckinLocation.delete(chatId);
        const u = await User.findById(pending.userId).catch(() => null);
        if (u) {
          const resultText = await doCheckIn(u, pending.lang);
          await bot.sendMessage(chatId, resultText, { reply_markup: await keyboardForUser(u, pending.lang) });
        }
      } else {
        await bot.sendMessage(chatId, tb(pending.lang, 'checkInStillNeedsLive'));
      }
      return;
    }

    // Faqat BIR martalik (live_period yo'q) ulashishga qisqa tasdiq — jonli
    // kuzatuvning har bir yangilanishida xabar bilan bezovta qilmaslik uchun
    // 'edited_message' branida tasdiq yuborilmaydi.
    if (!isLive) {
      const u = await User.findOne({ telegramChatId: chatId.toString() }).select('language').catch(() => null);
      bot.sendMessage(chatId, tb(u?.language as BotLang | undefined, 'locationSaved'));
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

  // ── Yo'qlama: Ishga keldim / Ish tugatdim — FAQAT ishchi/prorab/brigadir ──
  // MUHIM: bu yerda GPS'ga HECH TEGILMAYDI — GPS botда doim, joylashuv
  // kelgan zahoti ishlaydi (yuqorida). Bu tugmalar FAQAT Attendance yozuvini
  // (davomat) boshqaradi. Tugma bosilganda DARHOL bajarilmaydi — tasodifan
  // bosilib ketishning oldini olish uchun avval inline "Ha/Yo'q" tasdiqlash
  // so'raladi (saytda ham xuddi shunday — window.confirm orqali); haqiqiy
  // amal callback_query handlerida (pastda) bajariladi.
  if (isWorker(user.role) && text === tb(lang, 'kb_checkIn')) {
    bot.sendMessage(chatId, tb(lang, 'checkInConfirmPrompt'), {
      reply_markup: { inline_keyboard: [[
        { text: tb(lang, 'confirmYes'), callback_data: 'confirm_checkin' },
        { text: tb(lang, 'confirmNo'), callback_data: 'cancel_checkin' },
      ]] },
    });
    return;
  }
  if (isWorker(user.role) && text === tb(lang, 'kb_checkOut')) {
    bot.sendMessage(chatId, tb(lang, 'checkOutConfirmPrompt'), {
      reply_markup: { inline_keyboard: [[
        { text: tb(lang, 'confirmYes'), callback_data: 'confirm_checkout' },
        { text: tb(lang, 'confirmNo'), callback_data: 'cancel_checkout' },
      ]] },
    });
    return;
  }

  // ── DEVELOPER commands ────────────────────────────────────────────────────
  if (developer) {
    if (text === tb(user.language, 'kb_firmsList')) {
      try {
        const Company = require('../models/Company').default;
        const firms = await Company.find({}).select('name branchId status').lean();
        if (firms.length === 0) {
          bot.sendMessage(chatId, tb(user.language, 'devNoFirms'), { reply_markup: await keyboardForUser(user, user.language) });
          return;
        }
        const lines = firms.map((c: any, i: number) =>
          `${i + 1}. *${c.name}* (${c.branchId || '—'}) — ${c.status || '?'}`
        ).join('\n');
        bot.sendMessage(chatId, `${tb(user.language, 'devFirmsHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: await keyboardForUser(user, user.language) });
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
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
        bot.sendMessage(chatId, `${tb(user.language, 'devUsersHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: await keyboardForUser(user, user.language) });
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
      }
      return;
    }

    if (text === tb(user.language, 'kb_allSubscriptions')) {
      try {
        const Subscription = require('../models/Subscription').default;
        const Company = require('../models/Company').default;
        const subs = await Subscription.find({}).sort({ createdAt: -1 }).limit(20).lean();
        if (subs.length === 0) {
          bot.sendMessage(chatId, tb(user.language, 'devNoSubs'), { reply_markup: await keyboardForUser(user, user.language) });
          return;
        }
        const companies = await Company.find({}).select('name').lean();
        const cMap: Record<string, string> = {};
        (companies as any[]).forEach((c: any) => { cMap[String(c._id)] = c.name; });
        const lines = (subs as any[]).map((s: any) => {
          const statusIcon = s.status === 'active' ? '✅' : s.status === 'pending' ? '⏳' : '❌';
          return `${statusIcon} *${cMap[String(s.companyId)] || '—'}* — ${s.selectedPlan || s.plan || '—'}`;
        }).join('\n');
        bot.sendMessage(chatId, `${tb(user.language, 'devSubsHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: await keyboardForUser(user, user.language) });
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
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
          { parse_mode: 'Markdown', reply_markup: await keyboardForUser(user, user.language) }
        );
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
      }
      return;
    }

    bot.sendMessage(chatId, tb(user.language, 'chooseFromMenu'), { reply_markup: await keyboardForUser(user, user.language) });
    return;
  }

  // ── ADMIN commands ────────────────────────────────────────────────────────
  if (admin) {
    if (text === tb(user.language, 'kb_pendingApprovals')) {
      try {
        // ANIQ tasdiqlovchi tanlangan chiqimlar — faqat o'sha admin ro'yxatida
        // ko'rinadi (boshqa adminlarga umuman ko'rsatilmaydi, chunki ular
        // baribir tasdiqlay olmaydi — yuqoridagi callback tekshiruviga qarang).
        // approverId yo'q (eski) yozuvlar va transferlar hammaga ko'rinadi.
        const companyFilter = user.companyId ? { companyId: user.companyId } : {};
        const pending = await Transaction.find({
          ...companyFilter, status: 'pending',
          $or: [{ approverId: { $exists: false } }, { approverId: null }, { approverId: String(user._id) }],
        }).sort({ createdAt: -1 }).limit(10);
        if (pending.length === 0) {
          bot.sendMessage(chatId, tb(user.language, 'admNoPending'), { reply_markup: await keyboardForUser(user, user.language) });
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
        const companyFilter = user.companyId ? { companyId: user.companyId } : {};
        const confirmed = await Transaction.find({ ...companyFilter, status: 'confirmed', type: { $ne: 'transfer' } });
        const total = confirmed.reduce((s: number, t: any) => s + (t.amount || 0), 0);
        const pending = await Transaction.find({ ...companyFilter, status: 'pending', type: { $ne: 'transfer' } });
        const pendTotal = pending.reduce((s: number, t: any) => s + (t.amount || 0), 0);
        bot.sendMessage(chatId,
          tb(user.language, 'admFinanceStatusBody', { total: fmt(total, user.language), pendTotal: fmt(pendTotal, user.language), diff: fmt(total - pendTotal, user.language) }),
          { parse_mode: 'Markdown', reply_markup: await keyboardForUser(user, user.language) }
        );
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
      }
      return;
    }

    if (text === tb(user.language, 'kb_objects')) {
      try {
        const ObjectModel = require('../models/Object').default;
        const filter = user.companyId ? { companyId: user.companyId } : {};
        const objects = await ObjectModel.find(filter).limit(20);
        if (objects.length === 0) {
          bot.sendMessage(chatId, tb(user.language, 'admNoObjects'), { reply_markup: await keyboardForUser(user, user.language) });
          return;
        }
        const lines = objects.map((o: any, i: number) => `${i + 1}. *${o.name}*\n   📍 ${o.location || '—'} | Budjet: ${fmt(o.budget || 0, user.language)}`).join('\n\n');
        bot.sendMessage(chatId, `${tb(user.language, 'admObjectsHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: await keyboardForUser(user, user.language) });
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
      }
      return;
    }

    if (text === tb(user.language, 'kb_staffList')) {
      try {
        const filter = user.companyId ? { companyId: user.companyId } : {};
        const companyUsers = await User.find(filter).select('firstName lastName role phone');
        // Ishchi/prorab/brigadir uchun — saytdagi Kuzatuv sahifasi bilan bir
        // xil "bugungi yo'qlama" ma'lumoti (GET /api/attendance/list bilan
        // bir xil mantiq, faqat bot HTTP/tenant konteksti ichida ISHLAMAYDI,
        // shu sabab to'g'ridan-to'g'ri Mongoose orqali).
        const workerIds = companyUsers.filter((u: any) => isWorker(u.role)).map((u: any) => String(u._id));
        const today = todayDateStr();
        const records = workerIds.length
          ? await Attendance.find({ userId: { $in: workerIds }, date: today }).lean()
          : [];
        const byUser = new Map(records.map((r: any) => [r.userId, r]));
        const lines = companyUsers.map((u: any) => {
          const base = `• *${u.firstName} ${u.lastName || ''}* — ${u.role}\n  📞 ${u.phone}`;
          if (!isWorker(u.role)) return base;
          const rec: any = byUser.get(String(u._id));
          const att = !rec?.checkIn ? '⚪ Hali kelmagan'
            : !rec?.checkOut ? `🟢 Ishlayapti (${new Date(rec.checkIn).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })}dan beri)`
            : `⚫ Tugatgan (${new Date(rec.checkIn).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })}–${new Date(rec.checkOut).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })})`;
          return `${base}\n  ${att}`;
        }).join('\n\n');
        bot.sendMessage(chatId, `${tb(user.language, 'admStaffHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: await keyboardForUser(user, user.language) });
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
      }
      return;
    }

    if (text === tb(user.language, 'kb_report')) {
      try {
        const companyFilter = user.companyId ? { companyId: user.companyId } : {};
        const allTx = await Transaction.find(companyFilter);
        const transfers = allTx.filter((t: any) => t.type === 'transfer');
        const expenses = allTx.filter((t: any) => t.type !== 'transfer');
        const confExp = expenses.filter((t: any) => t.status === 'confirmed').reduce((s: number, t: any) => s + (t.amount || 0), 0);
        const pendCount = allTx.filter((t: any) => t.status === 'pending').length;
        bot.sendMessage(chatId,
          tb(user.language, 'admReportBody', { transfersCount: transfers.length, confExp: fmt(confExp, user.language), pendCount }),
          { parse_mode: 'Markdown', reply_markup: await keyboardForUser(user, user.language) }
        );
      } catch {
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
      }
      return;
    }

    if (text === tb(user.language, 'kb_subscriptionStatus')) {
      try {
        const Subscription = require('../models/Subscription').default;
        const sub = user.companyId ? await Subscription.findOne({ companyId: user.companyId }).sort({ createdAt: -1 }) : null;
        if (!sub) {
          bot.sendMessage(chatId, tb(user.language, 'subNotFound'), { reply_markup: await keyboardForUser(user, user.language) });
          return;
        }
        const now = new Date();
        let statusText = '';
        if (sub.status === 'pending') statusText = tb(user.language, 'subPending');
        else if (sub.status === 'active') {
          const daysLeft = sub.currentPeriodEnd
            ? Math.max(0, Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / 86400000))
            : null;
          statusText = daysLeft !== null ? tb(user.language, 'subActiveDays', { days: daysLeft }) : tb(user.language, 'subActive');
        } else if (sub.status === 'expired') statusText = tb(user.language, 'subExpired');
        else if (sub.status === 'rejected') statusText = tb(user.language, 'subRejected');
        else statusText = sub.status;
        const endDate = sub.currentPeriodEnd ? sub.currentPeriodEnd.toLocaleDateString('uz-UZ') : '—';
        await bot.sendMessage(chatId,
          tb(user.language, 'subStatusMsg', { status: statusText, end: endDate }),
          { parse_mode: 'HTML', reply_markup: await keyboardForUser(user, user.language) }
        );
      } catch { bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) }); }
      return;
    }

    // Unknown admin message — show keyboard
    bot.sendMessage(chatId, tb(user.language, 'chooseFromMenu'), { reply_markup: await keyboardForUser(user, user.language) });
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
        bot.sendMessage(chatId, tb(user.language, 'usrNoIncomingTransfers'), { reply_markup: await keyboardForUser(user, user.language) });
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
      bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
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
        bot.sendMessage(chatId, tb(user.language, 'usrNoSentTransfers'), { reply_markup: await keyboardForUser(user, user.language) });
        return;
      }
      const lines = txs.map(tx => {
        const st = tx.status === 'confirmed' ? '✅' : tx.status === 'rejected' ? '❌' : '⏳';
        return tb(user.language, 'usrSentTransferRow', { icon: st, name: tx.materialName || '—', qty: tx.quantity ?? '—', unit: tx.unit || '', date: tx.date || '—' });
      }).join('\n\n');
      bot.sendMessage(chatId, `${tb(user.language, 'usrSentTransfersHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: await keyboardForUser(user, user.language) });
    } catch {
      bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
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
        bot.sendMessage(chatId, tb(user.language, 'usrNoIncomingPayments'), { reply_markup: await keyboardForUser(user, user.language) });
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
      bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
    }
    return;
  }

  // Unknown non-admin message
  bot.sendMessage(chatId, tb(user.language, 'chooseFromMenu'), { reply_markup: await keyboardForUser(user, user.language) });
});

// ─── Inline button handler — confirm / reject ──────────────────────────────────
bot.on('callback_query', async (query: any) => {
  const data: string = query.data || '';
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;

  const user = await User.findOne({ telegramChatId: chatId?.toString() }).catch(() => null);
  const lang = user?.language as BotLang | undefined;

  // ── Yo'qlama tasdiqlash (Ishga keldim / Ish tugatdim) ─────────────────────
  if (data === 'confirm_checkin' || data === 'confirm_checkout') {
    if (!user || !isWorker(user.role)) { await bot.answerCallbackQuery(query.id); return; }
    try {
      await bot.answerCallbackQuery(query.id);
      if (messageId) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => {});
      if (data === 'confirm_checkout') {
        const resultText = await doCheckOut(user, lang);
        await bot.sendMessage(chatId, resultText, { reply_markup: await keyboardForUser(user, lang) });
        return;
      }
      // confirm_checkin — MAJBURIY: check-in yozuvi FAQAT jonli joylashuv
      // (Live Location) kelgandan keyin yaratiladi (pastdagi 'message'
      // handlerida). Telegram bot API cheklovi: bot buni tugma orqali
      // to'g'ridan-to'g'ri "so'ray" olmaydi (faqat bir martalik joylashuv
      // so'rovi mumkin) — shu sabab aniq matnli yo'riqnoma beramiz.
      pendingCheckinLocation.set(chatId, { userId: String(user._id), lang });
      await bot.sendMessage(chatId, tb(lang, 'checkInNeedsLiveLocation'));
    } catch (err) {
      console.error('[bot attendance confirm]', err);
      await bot.sendMessage(chatId, tb(lang, 'genericError'));
    }
    return;
  }
  if (data === 'cancel_checkin' || data === 'cancel_checkout') {
    await bot.answerCallbackQuery(query.id);
    if (messageId) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => {});
    pendingCheckinLocation.delete(chatId);
    if (user) await bot.sendMessage(chatId, tb(lang, 'actionCancelled'), { reply_markup: await keyboardForUser(user, lang) });
    return;
  }

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
      const kb = await keyboardForUser(user, newLang);
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
        if (!g || !(g.memberIds || []).includes(String(user._id))) { await bot.answerCallbackQuery(query.id, { text: tb(lang, 'chatGroupNotFound') }); return; }
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
      // Qabul qiluvchi YOKI o'sha kompaniya adminlari tasdiqlashi/rad etishi mumkin —
      // LEKIN agar chiqim uchun xodim ANIQ tasdiqlovchi tanlagan bo'lsa (tx.approverId),
      // botda ham FAQAT o'sha admin tasdiqlay/rad eta oladi, boshqa admin emas (saytdagi
      // PATCH /:id/approve va /:id/reject'dagi bir xil qoida — bu yer avval tekshirilmagan
      // edi, ya'ni istalgan admin botdan tasdiqlab yubora olardi, tanlangan tasdiqlovchidan
      // qat'i nazar). Eski (approverId'siz) yozuvlar uchun eski xatti-harakat saqlanadi.
      const isAdminOfCompany = user && isAdmin(user.role) && user.companyId && String(tx.companyId) === String(user.companyId)
        && (!tx.approverId || String(tx.approverId) === String(user._id));
      if (!user || (String(tx.toUserId) !== String(user._id) && !isAdminOfCompany)) {
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

// ─── Ertalabki "Ishga keldingizmi?" eslatmasi ──────────────────────────────
// Aniq talab: soat 5, 6, 7, 8, 9 (Toshkent vaqti) da, hali BUGUN ishga
// kelmagan (Attendance.checkIn yo'q) barcha ishchi/prorab/brigadir'larga
// avtomatik eslatma. Tugma to'g'ridan-to'g'ri xuddi "Ishga keldim"
// bosilgandek ishlaydi (confirm_checkin) — shundan keyingi jonli joylashuv
// talabi o'zgarmaydi (mavjud pendingCheckinLocation oqimi).
//
// node-cron kabi kutubxona ATAYLAB qo'shilmadi — loyihada allaqachon shu
// pattern bor (masalan transactions.ts'dagi idempotency tozalash): oddiy
// setInterval, har daqiqada Toshkent soatini tekshiradi. lastReminderKey
// server bitta soat ichida ikki marta yubormasligini ta'minlaydi (server
// qayta ishga tushsa xotiradagi belgi yo'qoladi — eng yomon holatda o'sha
// soat uchun eslatma yana bir marta yuborilishi mumkin, xavfli emas).
const REMINDER_HOURS = new Set([5, 6, 7, 8, 9]);
let lastReminderKey = '';

async function sendMorningReminders() {
  const today = todayInTashkent();
  const workers = await User.find({
    role: { $in: ['ishchi', 'prorab', 'brigadir'] },
    telegramChatId: { $exists: true, $ne: '' },
  }).select('telegramChatId language').lean();
  if (workers.length === 0) return;

  const workerIds = workers.map((w: any) => String(w._id));
  const already = await Attendance.find({ userId: { $in: workerIds }, date: today, checkIn: { $exists: true, $ne: null } }).select('userId').lean();
  const alreadyIn = new Set(already.map((a: any) => a.userId));

  for (const w of workers) {
    if (alreadyIn.has(String((w as any)._id))) continue;
    const lang = w.language as BotLang | undefined;
    try {
      await bot.sendMessage(w.telegramChatId, tb(lang, 'morningCheckInReminder'), {
        reply_markup: { inline_keyboard: [[{ text: tb(lang, 'kb_checkIn'), callback_data: 'confirm_checkin' }]] },
      });
    } catch (err) {
      console.error('[morning reminder] send error:', (err as Error).message);
    }
    await new Promise(r => setTimeout(r, 50)); // Telegram rate-limit zaxirasi
  }
}

setInterval(() => {
  const hour = tashkentHour();
  if (!REMINDER_HOURS.has(hour)) return;
  const key = `${todayInTashkent()}-${hour}`;
  if (lastReminderKey === key) return;
  lastReminderKey = key;
  sendMorningReminders().catch(err => console.error('[morning reminder]', err));
}, 60_000);

// v1.2 self-signup scene'ni ulaymiz (alohida fayl, eski handlerlar buzilmaydi)
initRegistrationScene(bot);

console.log('✅ Telegram bot ishga tushdi (rol asosida menyu)');
