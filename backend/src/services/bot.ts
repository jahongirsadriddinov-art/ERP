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
import AppRelease from '../models/AppRelease';
import AppSettings from '../models/AppSettings';
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
  polling: { params: { allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member'] } },
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

  const registerWebhook = () => bot.setWebHook(fullWebhookUrl, {
    max_connections: 40,
    // MUHIM: allowed_updates ANIQ ko'rsatilmasa, Telegram shu webhook uchun
    // OLDINGI sozlamani ishlatadi — 'edited_message' aynan Telegram'ning
    // "Jonli joylashuv" (Live Location) davomiy yangilanishlari uchun zarur.
    allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member'],
  });

  registerWebhook()
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
      bot.options.polling = { params: { allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member'] } };
      bot.startPolling()
        .catch((pollErr: Error) => console.error('⚠️ Polling fallback ham muvaffaqiyatsiz:', pollErr.message));
    });

  // O'ZINI-O'ZI TUZATISH: agar BOSHQA bir joyda (masalan dasturchining
  // mahalliy kompyuterida, TELEGRAM_WEBHOOK_URL sozlanmagan holda) shu bot
  // tokeni bilan pollingga urinilsa — node-telegram-bot-api kutubxonasi
  // (telegramPolling.js, _unsetWebHook) buni ANIQLAB, xatoni o'zi hal qilish
  // uchun bizning webhook'imizni AVTOMATIK O'CHIRIB TASHLAYDI (bu bizning
  // kodimiz emas — Telegram'ning "polling va webhook bir-birini istisno
  // qiladi" qoidasiga kutubxonaning javobi). Natijada bot butunlay
  // "o'lik" ko'rinar edi — aynan shu sodir bo'lgan holat. Buning oldini
  // to'liq olib bo'lmaydi (boshqa joydagi pollingni bu yerdan
  // to'xtatolmaymiz), lekin har 5 daqiqada webhook'ni QAYTA o'rnatib,
  // uzilish oynasini bir necha soniyagacha qisqartiramiz.
  setInterval(() => {
    registerWebhook().catch((err: Error) => console.error('⚠️ Webhook qayta tasdiqlashda xato:', err.message));
  }, 5 * 60 * 1000);
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

// Dasturchi "⚙️ Tugmalarni sozlash" orqali matn/tartibni o'zgartirgan bo'lsa
// — shu yerda hisobga olinadi (adminButtonLabels/adminButtonOrder).
const ADMIN_KEYBOARD = async (lang?: BotLang) => {
  const settings: any = await getAppSettingsCached();
  const L = (k: string) => scopedLabel(settings, 'admin', k, lang);
  const hasCustomOrder = Array.isArray(settings?.adminButtonOrder) && settings.adminButtonOrder.some((a: string) => (ADMIN_LABEL_KEYS as readonly string[]).includes(a));
  const rows: { text: string }[][] = hasCustomOrder
    ? effectiveOrder(settings, 'admin').map(k => [{ text: L(k) }])
    : [
        [{ text: L('kb_chat') }],
        [{ text: L('kb_pendingApprovals') }],
        [{ text: L('kb_financeStatus') }, { text: L('kb_objects') }],
        [{ text: L('kb_staffList') }, { text: L('kb_report') }],
        [{ text: L('kb_subscriptionStatus') }],
      ];
  return {
    keyboard: [[openSiteBtn(lang)], ...rows, [{ text: tb(lang, 'kb_language') }]],
    resize_keyboard: true,
  };
};

const USER_KEYBOARD = async (lang?: BotLang) => {
  const settings: any = await getAppSettingsCached();
  const L = (k: string) => scopedLabel(settings, 'user', k, lang);
  const hasCustomOrder = Array.isArray(settings?.userButtonOrder) && settings.userButtonOrder.some((a: string) => (USER_LABEL_KEYS as readonly string[]).includes(a));
  const rows: { text: string }[][] = hasCustomOrder
    ? effectiveOrder(settings, 'user').map(k => [{ text: L(k) }])
    : [
        [{ text: L('kb_chat') }],
        [{ text: L('kb_incomingTransfers') }],
        [{ text: L('kb_sentTransfers') }],
        [{ text: L('kb_incomingPayments') }],
      ];
  return {
    keyboard: [[openSiteBtn(lang)], ...rows, [{ text: tb(lang, 'kb_language') }]],
    resize_keyboard: true,
  };
};

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

// Ishchi jonli joylashuvni "Until I turn it off" (muddatsiz) tanlab, avvalgi
// smenadan beri hali ham UZLUKSIZ yuborib turgan bo'lishi mumkin — bunday
// holatda check-in bosganda QAYTA "jonli joylashuv yuboring" deb so'ramaymiz
// (GpsLocation'dagi eng oxirgi 'bot_live' yozuv shu FRESH oraliqda bo'lsa,
// hali ham faol deb hisoblanadi). Agar u vaqtli (masalan 1 soatlik) bo'lib
// muddati o'tib ketgan bo'lsa — yozuv eskiradi, keyingi check-in'da yana
// so'raladi (aniq talab: "agar noto'g'ri, ya'ni vaqtli tashlab qo'ysa, vaqti
// tugagach yana so'rov yuborilsin").
const LIVE_LOCATION_FRESH_MS = 5 * 60 * 1000; // 5 daqiqa

// "📢 Xabar yuborish" bosilgandan "⏹ Yakunlash" bosilguncha — dasturchi
// ARMED (qurollangan) holatda: shu payt yuborgan HAR BIR matn/apk/exe fayl
// TASDIQSIZ, darhol hammaga yuboriladi. Dasturchi botga to'g'ridan-to'g'ri
// (shu tugmani bosmasdan) .apk/.exe tashlasa ham xuddi shunday — tasdiqsiz,
// darhol yuboriladi (pastroqda, alohida blok).
// XAVFSIZLIK: qiymat — QUROLLANGAN payt (ms). Dasturchi "⏹ Yakunlash"ni
// bosishni UNUTIB qo'ysa, keyingi (hatto oddiy, tasodifiy) xabari ham
// TASDIQSIZ hammaga ketardi — real xavf. Shu sabab BELGILANGAN VAQTDAN
// (BROADCAST_ARM_TIMEOUT_MS) keyin avtomatik "sovutiladi" (o'chadi).
const pendingBroadcastChoice = new Map<number, number>();
const BROADCAST_ARM_TIMEOUT_MS = 15 * 60 * 1000; // 15 daqiqa

// Bot yoqiq/o'chiqligi — dasturchi shu botning o'zidan boshqaradi (pastda,
// kb_disableBot/kb_enableBot). auth.ts'dagi isSiteEnabled() bilan bir xil
// naqsh: 5 soniyalik keshlash, xatolikda "yoqiq" deb hisoblanadi (o'zini
// yolg'on o'chirib qo'ymasligi uchun).
let cachedBotEnabled: boolean | null = null;
let botEnabledCachedAt = 0;
const BOT_STATUS_CACHE_MS = 5000;
// force=true — "🔄 Yangilash" tugmasi bosilganda ISHONCHLI (keshsiz) javob
// berish uchun — foydalanuvchi aynan shu tugmani ATAYLAB "hozir tekshir"
// degani uchun bosadi, 5 soniyalik eski keshdan javob berish noto'g'ri.
async function isBotEnabled(force = false): Promise<boolean> {
  const now = Date.now();
  if (force || cachedBotEnabled === null || now - botEnabledCachedAt > BOT_STATUS_CACHE_MS) {
    try {
      const s = await AppSettings.findOne({ key: 'global' }).select('botEnabled').lean();
      cachedBotEnabled = s?.botEnabled !== false;
      botEnabledCachedAt = now;
    } catch {
      return true;
    }
  }
  return cachedBotEnabled;
}

// Klaviatura tugma matnlari/tartibi/xabarlar uchun (devButtonLabels,
// adminButtonLabels, userButtonLabels, devMessageTexts, va h.k.) BITTA
// umumiy 5s-keshlangan AppSettings hujjati — PERFORMANS: avval har bir
// DEVELOPER_KEYBOARD/ADMIN_KEYBOARD/USER_KEYBOARD chaqiruvi (ya'ni HAR bir
// bot javobida ko'rsatiladigan klaviatura) VA har bir kiruvchi matn xabar
// o'zining ALOHIDA AppSettings.findOne() so'rovini yuborardi — kichik
// hujjat bo'lsa ham, bu botning HAR bir harakatida qo'shimcha, keraksiz
// bazaga murojaat degani edi (aniq talab: "siteni botni sekin
// ishlatvotgan narsalar... bartaraf et"). Endi hammasi shu BITTA keshdan
// o'qiydi. Yozishdan keyin (label/tartib/xabar o'zgartirilganda, yoqish-
// o'chirishda) cachedAppSettings = null qilinadi — dasturchining O'ZI
// darhol yangilangan holatni ko'radi, 5s kutmaydi.
let cachedAppSettings: any = null;
let appSettingsCachedAt = 0;
const APP_SETTINGS_CACHE_MS = 5000;
async function getAppSettingsCached(): Promise<any> {
  const now = Date.now();
  if (!cachedAppSettings || now - appSettingsCachedAt > APP_SETTINGS_CACHE_MS) {
    try {
      cachedAppSettings = await AppSettings.findOne({ key: 'global' }).lean();
      appSettingsCachedAt = now;
    } catch {
      // Xatolik — eski (yoki null) qiymat bilan davom etamiz, standart
      // matnlarga tushib qolish xavfsiz (devLabel/devEffectiveMsg va h.k.
      // barchasi settings=null/undefined bo'lsa ham standart i18n matnga
      // tushadi, xato tashlamaydi).
    }
  }
  return cachedAppSettings;
}

// ─── Majburiy obuna (kanal/guruh) ────────────────────────────────────────────
// Aniq talab: bot foydalanuvchi shu 3 kanal/guruhga obuna bo'lmaguncha
// ishlamasin (/start bosganda ham, keyin har qanday xabarda ham), keyinroq
// bittasidan chiqib ketsa — qayta "obuna bo'ling" ko'rsatilsin. Dasturchi
// havolalarni va xabar matnini keyinchalik bot ichidan o'zgartira oladi.
const DEFAULT_REQUIRED_CHANNELS: { url: string; title: string }[] = [
  { url: 'https://t.me/+DD-6z31fYXNlMWM6', title: 'Qurilish-ERP OFFICIAL GROUP' },
  { url: 'https://t.me/+fZZJDhTSEF5iMzNi', title: 'Qurilish-ERP OFFICIAL CHANNEL' },
  { url: 'https://t.me/+p-eTtYPPYDo3MTIy', title: 'Qurilish-ERP Programs' },
];

// Joriy (dasturchi tomonidan o'zgartirilgan bo'lsa — o'shani, aks holda
// standart) 3 ta kanal ro'yxati. `chatId` faqat bot o'sha kanal/guruhga
// administrator sifatida qo'shilgach, `my_chat_member` orqali avtomatik
// to'ldiriladi (pastda) — private invite-link kanallar uchun Bot API'ga
// boshqa hech qanday yo'l bilan (havolaning o'zi bilan) so'rov yuborib
// bo'lmaydi.
function getRequiredChannels(settings: any): { chatId?: string; url: string; title: string }[] {
  const custom = settings?.requiredChannels;
  return Array.isArray(custom) && custom.length ? custom : DEFAULT_REQUIRED_CHANNELS;
}

function subscribeGateEffectiveMsg(settings: any, lang?: BotLang): { text: string; entities?: any[] } {
  const custom = settings?.subscribeGateMsg;
  if (custom && typeof custom === 'object' && typeof custom.text === 'string' && custom.text.trim()) {
    return { text: custom.text, entities: custom.entities };
  }
  if (typeof custom === 'string' && custom.trim()) return { text: custom };
  return { text: tb(lang, 'subGateDefaultBody') };
}

// Foydalanuvchi (Telegram user ID bo'yicha) hali obuna bo'lmagan kanallar
// ro'yxatini qaytaradi. Har bir tekshiruv Telegram API'ga so'rov (getChatMember)
// bo'lgani uchun HAR xabarda emas, qisqa muddatli keshdan o'qiladi — "🔄
// Tekshirish" tugmasi bosilganda force=true bilan darhol qayta tekshiriladi
// (aynan shu maqsad uchun bosilgani uchun eski keshdan javob berish noto'g'ri,
// xuddi isBotEnabled(force)dagi kabi).
const subscriptionCache = new Map<number, { missing: { chatId?: string; url: string; title: string }[]; checkedAt: number }>();
const SUBSCRIPTION_CACHE_MS = 10 * 60 * 1000; // 10 daqiqa
async function getMissingSubscriptions(userId: number, force = false): Promise<{ chatId?: string; url: string; title: string }[]> {
  const now = Date.now();
  if (!force) {
    const cached = subscriptionCache.get(userId);
    if (cached && now - cached.checkedAt < SUBSCRIPTION_CACHE_MS) return cached.missing;
  }
  const settings = await getAppSettingsCached();
  const required = getRequiredChannels(settings);
  const missing: { chatId?: string; url: string; title: string }[] = [];
  for (const ch of required) {
    // chatId hali aniqlanmagan bo'lsa (bot o'sha kanalga hali admin sifatida
    // qo'shilmagan) — shu kanal uchun tekshiruv o'tkazib yuboriladi. Bu
    // ATAYLAB xavfsiz-standart: sozlanmagan/yarim sozlangan holatda hech
    // kimni bloklab qo'ymaslik, bloklab qo'yish (hamma botdan foydalana
        // olmay qolishi) tekshirmaslikdan ko'ra ancha yomonroq oqibat.
    if (!ch.chatId) continue;
    try {
      const member = await bot.getChatMember(ch.chatId, userId);
      const status = member?.status;
      const isMember = status === 'creator' || status === 'administrator' || status === 'member' ||
        (status === 'restricted' && member?.is_member !== false);
      // Diagnostika: haqiqiy status Render loglarida ko'rinadi — "Programs"
      // kabi biror kanal kutilganidek ishlamasa, shu yozuv aynan Telegram
      // NIMA qaytarganini (status qiymati) ko'rsatadi, taxmin qilish shart
      // emas.
      console.log(`[subgate] chatId=${ch.chatId} (${ch.title}) userId=${userId} status=${status} isMember=${isMember}`);
      if (!isMember) missing.push(ch);
    } catch (err) {
      // Bot getChatMember so'rovini bajara olmadi (masalan bot admin emas,
      // yoki foydalanuvchi hech qachon botga /start bosmagan) — bu holatni
      // "obuna emas" deb hisoblash noto'g'ri xulosaga olib kelishi mumkin,
      // shu sabab jim o'tkazib yuboriladi (xavfsiz-standart, yuqoridagi
      // izohdagi bilan bir xil mantiq). Lekin SABABI Render loglariga
      // yoziladi — aks holda bu holat butunlay "ko'rinmas" bo'lib qolardi.
      console.error(`[subgate] getChatMember xatosi chatId=${ch.chatId} (${ch.title}) userId=${userId}:`, (err as Error).message || err);
    }
  }
  subscriptionCache.set(userId, { missing, checkedAt: now });
  return missing;
}

// Dasturchi uchun — Render loglariga kirmasdan, TO'G'RIDAN-TO'G'RI botning
// o'zida har bir kanal uchun getChatMember NIMA qaytarganini (status YOKI
// aniq xatolik matni) ko'rish. "📋 Majburiy obuna" ekranidagi "✅
// Aniqlangan"/"⏳ hali aniqlanmagan" faqat chatId saqlanganini bildiradi —
// bu funksiya esa Telegram bilan HAQIQIY (live) so'rov qiladi, shuning uchun
// masalan "Programs" kanali nega tasdiqlanmayotganini (bot admin emasmi,
// "member list is inaccessible"mi, foydalanuvchi topilmadimi va h.k.) aniq
// ko'rsatadi.
async function diagnoseSubscriptions(userId: number): Promise<string> {
  const settings = await getAppSettingsCached();
  const required = getRequiredChannels(settings);
  const lines: string[] = [];
  for (const ch of required) {
    if (!ch.chatId) { lines.push(`⏳ ${ch.title} — chatId hali aniqlanmagan (bot hali admin sifatida qo'shilmagan)`); continue; }
    try {
      const member = await bot.getChatMember(ch.chatId, userId);
      const status = member?.status;
      const isMember = status === 'creator' || status === 'administrator' || status === 'member' ||
        (status === 'restricted' && member?.is_member !== false);
      lines.push(`${isMember ? '✅' : '❌'} ${ch.title} — status="${status}" (chatId=${ch.chatId})`);
    } catch (err) {
      lines.push(`⚠️ ${ch.title} — XATOLIK: ${(err as Error).message || err} (chatId=${ch.chatId})`);
    }
  }
  return lines.join('\n');
}

function subscribeGateKeyboard(missing: { url: string; title: string }[], lang?: BotLang) {
  return {
    inline_keyboard: [
      ...missing.map(ch => [{ text: `➕ ${ch.title}`, url: ch.url }]),
      [{ text: tb(lang, 'subGateCheckBtn'), callback_data: 'subcheck' }],
    ],
  };
}

// /start'da ham, oddiy xabarlarda ham bir xil chaqiriladi — obuna to'liq
// bo'lmasa, gate xabarini yuboradi va `true` qaytaradi (chaqiruvchi shu
// holatda qolgan qayta ishlashni to'xtatishi kerak).
async function enforceSubscriptionGate(chatId: number, telegramUserId: number, lang: BotLang | undefined, force = false): Promise<boolean> {
  const missing = await getMissingSubscriptions(telegramUserId, force);
  if (missing.length === 0) return false;
  const settings = await getAppSettingsCached();
  const m = subscribeGateEffectiveMsg(settings, lang);
  await bot.sendMessage(chatId, m.text, { entities: m.entities, reply_markup: subscribeGateKeyboard(missing, lang) }).catch(() => {});
  return true;
}

// Bot biror kanal/guruhga a'zo/administrator sifatida QO'SHILGANDA Telegram
// shu update'ni yuboradi (allowed_updates'ga 'my_chat_member' qo'shilgan —
// yuqorida, polling/webhook sozlamalarida). Private invite-link kanallar
// uchun BU YAGONA yo'l — chat'ning raqamli ID'sini avtomatik bilib olish
// (havolaning o'zidan chat_id chiqarib bo'lmaydi). Nomi bo'yicha standart
// 3 sarlavhaga mos kelsa — avtomatik moslashtiriladi, aks holda faqat
// "discoveredChats" ro'yxatiga qo'shiladi (dasturchi keyin bot menyusidan
// qo'lda moslashtirishi mumkin).
async function recordDiscoveredChat(chatId: string, title: string, type: string) {
  console.log(`[subgate] chat aniqlandi: chatId=${chatId} title="${title}" type=${type}`);
  const settings: any = await AppSettings.findOne({ key: 'global' }).lean();
  const discovered: any[] = Array.isArray(settings?.discoveredChats) ? settings.discoveredChats.filter((c: any) => c.chatId !== chatId) : [];
  discovered.push({ chatId, title, type });

  // Nom bo'yicha avtomatik moslashtirish (aniq mos kelmasa — qo'lda
  // moslashtirish uchun discoveredChats'da qoladi, hech narsa yo'qolmaydi).
  // XATO TUZATILDI: avval FAQAT to'liq (normallashtirilgandan keyin ham
  // ANIQ bir xil) taqqoslash ishlatilardi — haqiqiy Telegram sarlavhasi
  // config'dagi nomdan biroz farq qilsa (masalan so'z tartibi yoki qo'shimcha
  // belgi) hech qachon moslashmasdi. Endi ANIQ moslik bo'lmasa, bittasi
  // ikkinchisini QISMAN o'z ichiga olsa ham (substring) mos deb hisoblanadi
  // — ancha bag'rikengroq, lekin baribir 3 nomdan faqat bittasiga to'g'ri
  // keladi (chalkashib ketish xavfi past).
  const required = getRequiredChannels(settings).map((ch: any) => ({ ...ch }));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яёʻʼ]+/gi, '');
  const nTitle = norm(title);
  let changed = false;
  for (const ch of required) {
    if (ch.chatId) continue;
    const nCh = norm(ch.title);
    if (nTitle && nCh && (nCh === nTitle || nCh.includes(nTitle) || nTitle.includes(nCh))) {
      ch.chatId = chatId; changed = true;
      console.log(`[subgate] "${title}" → "${ch.title}" slotiga moslashtirildi`);
    }
  }
  if (!changed) console.log(`[subgate] "${title}" hech qaysi standart nomga mos kelmadi — discoveredChats'da kutmoqda (qo'lda moslashtirish kerak)`);

  await AppSettings.findOneAndUpdate(
    { key: 'global' },
    { $set: { key: 'global', discoveredChats: discovered, requiredChannels: required, updatedAt: new Date() } },
    { upsert: true }
  );
  cachedAppSettings = null;
  if (changed) subscriptionCache.clear(); // yangi kanal aniqlandi — barcha eski "obuna yo'q" natijalar eskirgan bo'lishi mumkin
}

bot.on('my_chat_member', async (update: any) => {
  try {
    const chat = update.chat;
    const newStatus = update.new_chat_member?.status;
    if (!chat?.id || !['member', 'administrator', 'creator'].includes(newStatus)) return;
    await recordDiscoveredChat(String(chat.id), chat.title || chat.username || String(chat.id), chat.type);
  } catch (err) {
    console.error('[bot my_chat_member]', err);
  }
});

// Bot o'chirilganda oddiy foydalanuvchi ko'radigan YAGONA tugma — hech qanday
// funksiya ishlamaydi, faqat holatni qayta tekshirish mumkin.
const RESTRICTED_KEYBOARD = (lang?: BotLang) => ({
  keyboard: [[{ text: tb(lang, 'kb_refreshStatus') }]],
  resize_keyboard: true,
});

// "📢 Xabar yuborish" armed rejimida dasturchi ko'radigan YAGONA tugma —
// boshqa hech qaysi menyu tugmasi bosilib, tasodifan "xabar" deb hammaga
// yuborib yuborilmasin uchun (aniq xavfsizlik/UX maqsadi).
const BROADCAST_MODE_KEYBOARD = (lang?: BotLang) => ({
  keyboard: [[{ text: tb(lang, 'kb_broadcastEnd') }]],
  resize_keyboard: true,
});

// Dasturchi UCH XIL menyuni ("kb-scope") mustaqil o'zgartira oladi: o'z
// menyusini (dev), admin (direktor/orinbosar) menyusini, va ishchi menyusini
// — aniq talab: "boshqa userlarnikini ham taxrirlap bolsin orin bosar
// direktor ishchi va boshlarnikini ham". Har biri AppSettings'da alohida
// maydonda saqlanadi (masalan adminButtonLabels/adminButtonOrder).
type KbScope = 'dev' | 'admin' | 'user';
function labelsField(scope: KbScope): 'devButtonLabels' | 'adminButtonLabels' | 'userButtonLabels' {
  return scope === 'dev' ? 'devButtonLabels' : scope === 'admin' ? 'adminButtonLabels' : 'userButtonLabels';
}
function orderField(scope: KbScope): 'devButtonOrder' | 'adminButtonOrder' | 'userButtonOrder' {
  return scope === 'dev' ? 'devButtonOrder' : scope === 'admin' ? 'adminButtonOrder' : 'userButtonOrder';
}
// Tegishli scope'da tugma matni o'zgartirilgan bo'lsa — o'shani, bo'lmasa
// standart (i18n) matnni qaytaradi. Keyboard yasashda VA matn
// solishtirishda (dispatch) ikkalasida ham shu funksiya ishlatiladi —
// aks holda o'zgartirilgan tugma bosilganda hech narsa topilmay qolardi.
function scopedLabel(settings: any, scope: KbScope, key: string, lang?: BotLang): string {
  const custom = settings?.[labelsField(scope)]?.[key];
  return (typeof custom === 'string' && custom.trim()) ? custom.trim() : tb(lang, key as any);
}
// Eski nom — faqat 'dev' scope uchun, ko'p joyda ishlatilgan (o'zgarishsiz qoldirildi).
function devLabel(settings: any, key: string, lang?: BotLang): string {
  return scopedLabel(settings, 'dev', key, lang);
}

// Har bir scope uchun MATNI o'zgartirib bo'ladigan/tartib beriladigan
// tugmalar. kb_openSite (web_app — bosilganda bot'ga matn kelmaydi, dispatch
// bilan to'qnashuv yo'q, lekin baribir tashqarida — barcha scope'larda
// alohida pinlangan qator) va kb_language (BARCHA rollar uchun umumiy global
// handler bilan solishtiriladi — shu yerda o'zgartirilsa o'sha handler
// buzilardi) hech qaysi scope'ga kiritilmagan.
const DEV_LABEL_KEYS = ['kb_broadcast', 'kb_disableSite', 'kb_enableSite', 'kb_disableBot', 'kb_enableBot', 'kb_firmsList', 'kb_allUsers', 'kb_allSubscriptions', 'kb_generalStats', 'kb_chatHistory', 'kb_devSettings'] as const;
// Tartibini o'zgartirib bo'ladigan "atom"lar — siteToggle/botToggle holatga
// qarab ikki xil matndan (yoqilgan/o'chirilgan) birini ko'rsatadi, lekin
// POZITSIYA sifatida bitta joy egallaydi.
const DEFAULT_DEV_ORDER = ['kb_broadcast', 'siteToggle', 'botToggle', 'kb_firmsList', 'kb_allUsers', 'kb_allSubscriptions', 'kb_generalStats', 'kb_chatHistory', 'kb_devSettings'];
// Admin (direktor/orinbosar) va ishchi (worker) menyulari — bularda
// "toggle atom" yo'q, har biri oddiy statik kalit.
const ADMIN_LABEL_KEYS = ['kb_chat', 'kb_pendingApprovals', 'kb_financeStatus', 'kb_objects', 'kb_staffList', 'kb_report', 'kb_subscriptionStatus'] as const;
const USER_LABEL_KEYS = ['kb_chat', 'kb_incomingTransfers', 'kb_sentTransfers', 'kb_incomingPayments'] as const;
const ORDER_BY_SCOPE: Record<KbScope, readonly string[]> = { dev: DEFAULT_DEV_ORDER, admin: ADMIN_LABEL_KEYS, user: USER_LABEL_KEYS };
const LABEL_KEYS_BY_SCOPE: Record<KbScope, readonly string[]> = { dev: DEV_LABEL_KEYS, admin: ADMIN_LABEL_KEYS, user: USER_LABEL_KEYS };
const SCOPE_TITLE_KEY: Record<KbScope, 'kb_devSettingsScopeDev' | 'kb_devSettingsScopeAdmin' | 'kb_devSettingsScopeUser'> = {
  dev: 'kb_devSettingsScopeDev', admin: 'kb_devSettingsScopeAdmin', user: 'kb_devSettingsScopeUser',
};
// Ma'lum bir atom (dev'da siteToggle/botToggle ham bo'lishi mumkin) uchun
// joriy (custom-aware) matnni hisoblaydi.
function scopeAtomLabel(settings: any, scope: KbScope, atom: string, lang?: BotLang): string {
  if (scope === 'dev') {
    if (atom === 'siteToggle') return settings?.siteEnabled !== false ? scopedLabel(settings, 'dev', 'kb_disableSite', lang) : scopedLabel(settings, 'dev', 'kb_enableSite', lang);
    if (atom === 'botToggle') return settings?.botEnabled !== false ? scopedLabel(settings, 'dev', 'kb_disableBot', lang) : scopedLabel(settings, 'dev', 'kb_enableBot', lang);
  }
  return scopedLabel(settings, scope, atom, lang);
}
// Berilgan scope uchun joriy (custom yoki standart) tartibni qaytaradi —
// har doim TO'LIQ ro'yxat (yo'qolgan atom standart tartibda oxiriga qo'shiladi).
function effectiveOrder(settings: any, scope: KbScope): string[] {
  const raw: string[] = Array.isArray(settings?.[orderField(scope)]) ? settings[orderField(scope)] : [];
  const custom = raw.filter(a => ORDER_BY_SCOPE[scope].includes(a));
  return custom.length ? [...custom, ...ORDER_BY_SCOPE[scope].filter(a => !custom.includes(a))] : [...ORDER_BY_SCOPE[scope]];
}

// Sayt/bot yoqilganda-o'chirilganda va bot texnik ishlar rejimida ko'rinadigan
// XABAR matnlari — bular ham dasturchi tomonidan qo'lda tahrirlanishi mumkin
// (aniq talab: "boradigan xabarni ham ozim qolda tahrirlaydigan bolsin").
const DEV_MSG_KEYS = ['siteEnabledMsg', 'siteDisabledMsg', 'botEnabledMsg', 'botDisabledMsg', 'botMaintenanceMsg', 'botStillDisabledMsg', 'botNowEnabledMsg'] as const;
// {time}ni HAQIQIY vaqt bilan almashtiradi — o'rniga qo'yilgan matn
// uzunligi farqi bo'lsa, undan KEYIN keladigan entity (masalan premium
// emoji) offsetlarini ham mos ravishda suradi (aks holda emoji matnning
// noto'g'ri joyida "sirg'alib" qolardi). {time} yo'q bo'lsa va
// autoAppendTime=true bo'lsa — oxiriga alohida qator sifatida qo'shadi
// (oxiriga qo'shish hech qaysi mavjud entityga ta'sir qilmaydi).
function withTimeToken(text: string, entities: any[] | undefined, time: string, autoAppendTime: boolean): { text: string; entities?: any[] } {
  const idx = text.indexOf('{time}');
  if (idx !== -1) {
    const afterIdx = idx + '{time}'.length;
    const newText = text.slice(0, idx) + time + text.slice(afterIdx);
    const delta = time.length - '{time}'.length;
    const newEntities = entities?.map((e: any) => (e.offset >= afterIdx ? { ...e, offset: e.offset + delta } : e));
    return { text: newText, entities: newEntities };
  }
  if (autoAppendTime) return { text: `${text}\n🕐 ${time}`, entities };
  return { text, entities };
}

// Dasturchi tomonidan tahrirlangan XABAR matnini (agar bo'lsa, entities —
// masalan premium emoji — bilan birga) yoki standart (i18n) matnni
// qaytaradi. autoAppendTime — {time} yozilmagan bo'lsa ham vaqt avtomatik
// ko'rinishi kerak bo'lgan xabarlar uchun (sayt/bot yoqilgan-o'chirilgan
// vaqti — aniq talab: matnni o'zgartirsa ham vaqt ko'rinib tursin).
function devEffectiveMsgFull(settings: any, key: string, lang?: BotLang, autoAppendTime = false): { text: string; entities?: any[] } {
  const time = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
  const custom = settings?.devMessageTexts?.[key];
  if (custom && typeof custom === 'object' && typeof custom.text === 'string' && custom.text.trim()) {
    return withTimeToken(custom.text, custom.entities, time, autoAppendTime);
  }
  if (typeof custom === 'string' && custom.trim()) { // eski (entity'siz) saqlangan qiymat — moslik uchun
    return withTimeToken(custom, undefined, time, autoAppendTime);
  }
  return { text: tb(lang, key as any, { time } as any) };
}

// Faqat MATN kerak bo'lgan joylar uchun (menyu preview'lari, "joriy matn"
// ko'rsatish) — devEffectiveMsgFull'ning ustidan yupqa qobiq.
function devEffectiveMsg(settings: any, key: string, lang?: BotLang): string {
  return devEffectiveMsgFull(settings, key, lang, true).text;
}

// "Tugma/Xabar matnini o'zgartirish" oqimida — dasturchi qaysi narsani
// tahrirlayotgani kutilmoqda. Prefiks bilan ikkalasi ham shu bitta xaritada:
// 'label:kb_broadcast' — tugma matni, 'msg:siteEnabledMsg' — xabar matni.
const pendingLabelEdit = new Map<number, string>();

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
  // Sayt/ilova ochiq bo'lsa DARHOL biladi — botdan qilingan check-in
  // saytda "Ishga keldim" tugmasi eskirgan holatda ko'rinib qolishining
  // oldini oladi (xuddi /api/attendance/checkin qiladigani kabi).
  emitToUser(String(user._id), 'attendance:update', { ...record.toObject(), id: record._id });
  return tb(lang, 'checkInConfirmed', { time });
}
// "0.1 soat" kabi yaxlitlangan-noaniq ko'rinish o'rniga aniq daqiqa hisobidan
// "X soat Y daqiqa" (yoki ru: "X ч Y мин") — checkIn/checkOut ISO
// vaqt tamg'alaridan to'g'ridan-to'g'ri, yaxlitlashsiz hisoblanadi.
export function fmtWorkDuration(minutes: number, lang?: BotLang): string {
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
  emitToUser(String(user._id), 'attendance:update', { ...record.toObject(), id: record._id });
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

// atom (siteToggle/botToggle — holatga qarab 2 xil matndan birini
// ko'rsatadi) yoki oddiy kalitni joriy (custom-aware) matnga aylantiradi.
// DEVELOPER_KEYBOARD VA devReorderMenu ikkalasida ham bir xil ishlatiladi.
function buildAtomLabel(settings: any, lang?: BotLang) {
  const siteOn = settings?.siteEnabled !== false;
  const botOn = settings?.botEnabled !== false;
  return (atom: string): string => {
    if (atom === 'siteToggle') return siteOn ? devLabel(settings, 'kb_disableSite', lang) : devLabel(settings, 'kb_enableSite', lang);
    if (atom === 'botToggle') return botOn ? devLabel(settings, 'kb_disableBot', lang) : devLabel(settings, 'kb_enableBot', lang);
    return devLabel(settings, atom, lang);
  };
}

// Dinamik — sayt/bot hozir yoqiq/o'chiqligiga qarab tugma matni o'zgaradi
// ("O'chirish" ↔ "Yoqish"), shu sabab bazadan (AppSettings) o'qib chiqadi.
// Dasturchi "⚙️ Tugmalarni sozlash" orqali matnlarni/tartibni o'zgartirgan
// bo'lsa — shu yerda ham hisobga olinadi (devButtonLabels/devButtonOrder).
const DEVELOPER_KEYBOARD = async (lang?: BotLang) => {
  const settings: any = await getAppSettingsCached();
  const atomLabel = buildAtomLabel(settings, lang);
  const custom: string[] = Array.isArray(settings?.devButtonOrder) ? settings.devButtonOrder.filter((a: string) => DEFAULT_DEV_ORDER.includes(a)) : [];
  const order = custom.length ? [...custom, ...DEFAULT_DEV_ORDER.filter(a => !custom.includes(a))] : null;
  const rows: { text: string }[][] = order
    ? order.map(atom => [{ text: atomLabel(atom) }])
    : [
        [{ text: atomLabel('kb_broadcast') }],
        [{ text: atomLabel('siteToggle') }, { text: atomLabel('botToggle') }],
        [{ text: atomLabel('kb_firmsList') }, { text: atomLabel('kb_allUsers') }],
        [{ text: atomLabel('kb_allSubscriptions') }, { text: atomLabel('kb_generalStats') }],
        [{ text: atomLabel('kb_chatHistory') }],
      ];
  return {
    keyboard: [
      [openSiteBtn(lang)],
      ...rows,
      [{ text: tb(lang, 'kb_language') }],
      [{ text: atomLabel('kb_devSettings') }],
    ],
    resize_keyboard: true,
  };
};

// "⚙️ Tugmalarni sozlash" bosilganda ochiladigan TOP-LEVEL inline menyu —
// UCH XIL menyu (dasturchi/admin/ishchi) tugma matnlari/tartibi + umumiy
// xabar matnlari + standartga qaytarish (aniq talab: "boshqa userlarnikini
// ham taxrirlap bolsin orin bosar direktor ishchi va boshlarnikini ham").
function devSettingsMenu(lang?: BotLang) {
  return {
    inline_keyboard: [
      [{ text: `🤖 ${tb(lang, 'kb_devLabels')}`, callback_data: 'devlabels_dev' }, { text: '🔀', callback_data: 'devreorder_dev' }],
      [{ text: `👔 ${tb(lang, 'scopeAdmin')} — ${tb(lang, 'kb_devLabels')}`, callback_data: 'devlabels_admin' }, { text: '🔀', callback_data: 'devreorder_admin' }],
      [{ text: `👷 ${tb(lang, 'scopeUser')} — ${tb(lang, 'kb_devLabels')}`, callback_data: 'devlabels_user' }, { text: '🔀', callback_data: 'devreorder_user' }],
      [{ text: tb(lang, 'kb_devMsgs'), callback_data: 'devmsgs' }],
      [{ text: tb(lang, 'kb_subscribeGate'), callback_data: 'subgatemenu' }],
      [{ text: tb(lang, 'kb_devReset'), callback_data: 'devresetask' }],
    ],
  };
}

// Auto-title-matching (my_chat_member) ishlamay qolgan holatlar uchun —
// bot admin sifatida qo'shilgan, lekin biror slotga hali BOG'LANMAGAN
// kanal/guruhlar (masalan haqiqiy Telegram sarlavhasi kutilganidan farq
// qilsa). Qo'lda moslashtirish shu ro'yxatdan tanlanadi.
function unassignedDiscoveredChats(settings: any): { chatId: string; title: string }[] {
  const required = getRequiredChannels(settings);
  const assignedIds = new Set(required.map(ch => ch.chatId).filter(Boolean));
  const discovered: any[] = Array.isArray(settings?.discoveredChats) ? settings.discoveredChats : [];
  return discovered.filter(d => !assignedIds.has(d.chatId));
}

// "📋 Majburiy obuna" ekrani — 3 kanal holati + tahrirlash tugmalari +
// (agar bo'lsa) hali hech qaysi slotga bog'lanmagan aniqlangan kanallarni
// qo'lda moslashtirish tugmalari.
function subGateAdminMenu(settings: any, lang?: BotLang) {
  const required = getRequiredChannels(settings);
  const rows: { text: string; callback_data: string }[][] = [];
  required.forEach((ch, i) => {
    rows.push([{ text: tb(lang, 'subGateEditUrlBtn', { n: i + 1 }), callback_data: `subgateurl_${i}` }]);
    rows.push([{ text: tb(lang, 'subGateEditTitleBtn', { n: i + 1 }), callback_data: `subgatetitle_${i}` }]);
  });
  rows.push([{ text: tb(lang, 'subGateEditMsgBtn'), callback_data: 'subgatemsg' }]);
  rows.push([{ text: tb(lang, 'subGateTestBtn'), callback_data: 'subgatetest' }]);
  // Har bir bog'lanmagan aniqlangan kanal uchun — qaysi slotga bog'lash
  // kerakligini tanlash (masalan "📎 <nom> → 1-slot", "→ 2-slot", ...).
  const unassigned = unassignedDiscoveredChats(settings);
  unassigned.forEach((d, di) => {
    required.forEach((ch, i) => {
      rows.push([{ text: `📎 ${d.title} → ${i + 1}`, callback_data: `subgateassign_${i}_${di}` }]);
    });
  });
  rows.push([{ text: tb(lang, 'kb_devBack'), callback_data: 'devsettingsback' }]);
  return { inline_keyboard: rows };
}
function subGateAdminIntroText(settings: any, lang?: BotLang): string {
  const required = getRequiredChannels(settings);
  const lines = required.map((ch, i) => tb(lang, 'subGateAdminChannelLine', {
    n: i + 1, title: ch.title, url: ch.url,
    status: ch.chatId ? tb(lang, 'subGateDiscovered') : tb(lang, 'subGateNotDiscovered'),
  }));
  return `${tb(lang, 'subGateAdminIntro')}\n\n${lines.join('\n\n')}`;
}

// Har bir o'zgartirilishi mumkin TUGMA matni uchun bitta qator (scope —
// 'dev'/'admin'/'user', qaysi menyu tahrirlanayotgani).
function devLabelsMenu(settings: any, scope: KbScope, lang?: BotLang) {
  const rows = LABEL_KEYS_BY_SCOPE[scope].map(k => [{ text: `✏️ ${scopedLabel(settings, scope, k, lang)}`, callback_data: `editlbl_${scope}_${k}` }]);
  rows.push([{ text: tb(lang, 'kb_devBack'), callback_data: 'devsettingsback' }]);
  return { inline_keyboard: rows };
}

// Har bir o'zgartirilishi mumkin XABAR matni uchun bitta qator (qisqartirib
// ko'rsatiladi — Telegram tugma matni uzun bo'lsa chiroyli ko'rinmaydi).
// Xabar matnlari GLOBAL (rolga bog'liq emas) — faqat sayt/bot yoqilgan-
// o'chirilgan holatida ko'rinadi, shu sabab scope'ga bo'linmagan.
function devMsgsMenu(settings: any, lang?: BotLang) {
  const preview = (s: string) => (s.length > 28 ? s.slice(0, 27) + '…' : s).replace(/\n/g, ' ');
  const rows = DEV_MSG_KEYS.map(k => [{ text: `📝 ${preview(devEffectiveMsg(settings, k, lang))}`, callback_data: `editmsg_${k}` }]);
  rows.push([{ text: tb(lang, 'kb_devBack'), callback_data: 'devsettingsback' }]);
  return { inline_keyboard: rows };
}

// Tartib o'zgartirish ekrani — har bir tugma uchun ▲/▼, o'rtada joriy matn.
function devReorderMenu(settings: any, scope: KbScope, lang?: BotLang) {
  const order = effectiveOrder(settings, scope);
  const rows = order.map((atom, i) => [
    { text: i > 0 ? '▲' : ' ', callback_data: i > 0 ? `mvup_${scope}_${atom}` : 'noop' },
    { text: scopeAtomLabel(settings, scope, atom, lang), callback_data: 'noop' },
    { text: i < order.length - 1 ? '▼' : ' ', callback_data: i < order.length - 1 ? `mvdn_${scope}_${atom}` : 'noop' },
  ]);
  rows.push([{ text: tb(lang, 'kb_devBack'), callback_data: 'devsettingsback' }]);
  return { inline_keyboard: rows };
}

// USER_KEYBOARD'ning ustiga "Ish tugatdim" qatori qo'shilgan varianti — ishchi
// WORKING holatida (checkin bosilgan, checkout hali yo'q) ko'radi.
const USER_KEYBOARD_WITH_CHECKOUT = async (lang?: BotLang) => {
  const base = await USER_KEYBOARD(lang);
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
export async function keyboardForUser(user: any, lang?: BotLang) {
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
  // ── Majburiy obuna — dasturchidan boshqa HAMMA uchun (yangi ham, eski
  // ham) /start'ning O'ZIDA tekshiriladi. Bot bu yerda return qilib
  // to'xtaydi — quyidagi "xush kelibsiz"/"telefon raqamingizni ulashing"
  // javoblari faqat obuna to'liq bo'lgach ko'rinadi.
  if ((!existing || !isDev(existing.role)) && msg.from?.id) {
    const gLang = existing?.language as BotLang | undefined;
    if (await enforceSubscriptionGate(chatId, msg.from.id, gLang)) return;
  }
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

  // ── Guruh/kanal xabari — majburiy-obuna kanal ID'sini ANIQLASHNING
  // ZAXIRA yo'li. Asosiy yo'l — 'my_chat_member' (bot administrator
  // sifatida QO'SHILGAN paytdagi update). Lekin agar bot allaqachon
  // qo'shilgandan KEYIN backend qayta deploy qilinsa (yoki update
  // qandaydir sababdan yetib kelmasa) — bot shu guruhda YURGAN paytda
  // kimdir yozgan HAR QANDAY oddiy xabar ham chat.id/title'ni oshkor
  // qiladi, shu bilan aynan shu holatni tuzatadi. Boshqa hech qanday
  // logikaga aralashmaydi — faqat aniqlab, DARHOL chiqib ketadi (xodim/
  // foydalanuvchi bilan bog'liq qolgan barcha pastdagi mantiq FAQAT
  // shaxsiy (private) chatlar uchun mo'ljallangan).
  if (msg.chat.type !== 'private') {
    recordDiscoveredChat(String(msg.chat.id), msg.chat.title || msg.chat.username || String(msg.chat.id), msg.chat.type).catch(() => {});
    return;
  }

  if (isInRegistration(chatId)) return; // self-signup scene o'zi ushlaydi

  // ── Texnik ishlar rejimi (botEnabled=false) — dasturchidan boshqa hech kim
  // botdan foydalana olmaydi (u qayta yoqishi kerak bo'lgani uchun): hech
  // qaysi funksiya ko'rinmaydi, klaviatura FAQAT "🔄 Yangilash" tugmasidan
  // iborat bo'ladi. /start ham shu tekshiruvdan o'tadi — registerScene
  // ustidagi tekshiruv shundan keyin keladi (pastroqda, alohida).
  if (!(await isBotEnabled())) {
    const mUser = await User.findOne({ telegramChatId: chatId.toString() }).select('role language').catch(() => null);
    if (!mUser || !isDev(mUser.role)) {
      const mLang = mUser?.language as BotLang | undefined;
      const settings: any = await AppSettings.findOne({ key: 'global' }).select('devMessageTexts').lean();
      // "🔄 Yangilash" ATAYLAB bosilgan bo'lsa — keshsiz, ISHONCHLI holatni
      // shu zahoti qayta tekshiramiz (aks holda 5 soniyalik eski keshdan
      // "hali ham o'chiq" deb javob berilishi mumkin edi).
      if (msg.text === tb(mLang, 'kb_refreshStatus')) {
        const stillOff = !(await isBotEnabled(true));
        if (stillOff) {
          const m = devEffectiveMsgFull(settings, 'botStillDisabledMsg', mLang);
          bot.sendMessage(chatId, m.text, { entities: m.entities, reply_markup: RESTRICTED_KEYBOARD(mLang) }).catch(() => {});
        } else if (mUser) {
          const m = devEffectiveMsgFull(settings, 'botNowEnabledMsg', mLang);
          bot.sendMessage(chatId, m.text, { entities: m.entities, reply_markup: await keyboardForUser(mUser, mLang) }).catch(() => {});
        }
        return;
      }
      const mm = devEffectiveMsgFull(settings, 'botMaintenanceMsg', mLang);
      bot.sendMessage(chatId, mm.text, { entities: mm.entities, reply_markup: RESTRICTED_KEYBOARD(mLang) }).catch(() => {});
      return;
    }
  }

  // ── Majburiy obuna — /start bu yerda EMAS, alohida onText handlerida
  // tekshiriladi (pastroqda "if (text.startsWith('/start')) return;" bilan
  // shu handlerdan chiqib ketadi, keyin alohida ro'yxatdan o'tgan onText
  // handleri ishga tushadi — ikkalasi mustaqil listener, biri return qilsa
  // ikkinchisi baribir ishlaydi, shu sabab u yerda ALOHIDA tekshiruv bor).
  // Shu yerdagi tekshiruv — /start'dan TASHQARI HAR QANDAY boshqa xabar
  // (menyu tugmasi, oddiy matn, fayl, GPS va h.k.) uchun.
  if (!(msg.text || '').startsWith('/start') && msg.from?.id) {
    const gUser = await User.findOne({ telegramChatId: chatId.toString() }).select('role language').catch(() => null);
    if (!gUser || !isDev(gUser.role)) {
      const gLang = gUser?.language as BotLang | undefined;
      if (await enforceSubscriptionGate(chatId, msg.from.id, gLang)) return;
    }
  }

  // ── Bot ichidan chat rejimi — matn, rasm/video/ovoz/fayl/lokatsiya bo'lishi mumkin ──
  const activeChat = chatSessions.get(chatId);
  if (activeChat) {
    if (msg.text === tb(activeChat.lang, 'exitChat')) {
      chatSessions.delete(chatId);
      const u = await User.findById(activeChat.myUserId).catch(() => null);
      const ulang = u?.language as BotLang | undefined;
      const kb = u ? await keyboardForUser(u, ulang) : await USER_KEYBOARD(ulang);
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

  // ── "⚙️ Tugmalarni sozlash" ichida tugma/xabar matnini tahrirlash — tanlangan
  // kalitning KEYINGI matn xabari shu kalitga saqlanadi.
  if (pendingLabelEdit.has(chatId)) {
    const tag = pendingLabelEdit.get(chatId) as string;
    pendingLabelEdit.delete(chatId);
    const elUser = await User.findOne({ telegramChatId: chatId.toString() }).catch(() => null);
    if (elUser && isDev(elUser.role) && msg.text) {
      const elLang = elUser.language as BotLang | undefined;
      // 'label:admin:kb_chat' → kind='label', scope='admin', key='kb_chat'
      // 'msg:siteEnabledMsg' → kind='msg', key='siteEnabledMsg' (xabarlar scope'ga bo'linmagan)
      // 'subch:url:0' / 'subch:title:0' / 'subch:msg' → majburiy obuna
      // kanal havolasi/nomi/xabar matni — massiv elementi, boshqa maydonlar
      // bilan bir xil Mixed-map mantiqqa to'g'ri kelmagani uchun ALOHIDA
      // ishlov beriladi (pastda, keyin shu blokdan chiqib ketiladi).
      if (tag.startsWith('subch:')) {
        const [, subKind, idxStr] = tag.split(':');
        const settings: any = await AppSettings.findOne({ key: 'global' }).lean();
        if (subKind === 'msg') {
          await AppSettings.findOneAndUpdate(
            { key: 'global' },
            { $set: { key: 'global', subscribeGateMsg: { text: msg.text, entities: msg.entities || [] }, updatedAt: new Date() } },
            { upsert: true }
          );
          cachedAppSettings = null;
          await bot.sendMessage(chatId, tb(elLang, 'editMsgSaved'), { reply_markup: await keyboardForUser(elUser, elLang) });
        } else {
          const idx = Number(idxStr);
          const required = getRequiredChannels(settings).map((ch: any) => ({ ...ch }));
          if (required[idx]) {
            if (subKind === 'url') required[idx].url = msg.text.trim();
            else if (subKind === 'title') required[idx].title = msg.text.trim();
            await AppSettings.findOneAndUpdate(
              { key: 'global' },
              { $set: { key: 'global', requiredChannels: required, updatedAt: new Date() } },
              { upsert: true }
            );
            cachedAppSettings = null;
            subscriptionCache.clear(); // havola/nom o'zgardi — eski natijalar endi ishonchsiz
            await bot.sendMessage(chatId, tb(elLang, subKind === 'url' ? 'subGateUrlSaved' : 'subGateTitleSaved'), { reply_markup: await keyboardForUser(elUser, elLang) });
          }
        }
        return;
      }
      const [kind, ...restParts] = tag.split(':');
      const field = kind === 'label' ? labelsField(restParts[0] as KbScope) : 'devMessageTexts';
      const key = kind === 'label' ? restParts[1] : restParts[0];
      // TUGMA matni — Telegram tugma yozuvlari FORMATLASH/ENTITY'larni
      // (shu jumladan premium emoji) UMUMAN qo'llab-quvvatlamaydi (bu
      // platforma cheklovi), shuning uchun oddiy matn saqlanadi.
      // XABAR matni — aynan qanday yozgan bo'lsa (entities bilan) saqlanadi,
      // hech narsa o'zgarmasligi uchun.
      const value: any = kind === 'label' ? msg.text.trim() : { text: msg.text, entities: msg.entities || [] };
      await AppSettings.findOneAndUpdate(
        { key: 'global' },
        { $set: { key: 'global', [`${field}.${key}`]: value, updatedAt: new Date() } },
        { upsert: true }
      );
      cachedAppSettings = null; // keyingi keyboardForUser() darhol yangi matnni ko'rsatsin
      if (kind === 'label') {
        await bot.sendMessage(chatId, tb(elLang, 'editLabelSaved', { label: msg.text.trim() }), { reply_markup: await keyboardForUser(elUser, elLang) });
        if (msg.entities?.some((e: any) => e.type === 'custom_emoji')) {
          await bot.sendMessage(chatId, tb(elLang, 'premiumEmojiButtonWarning'));
        }
      } else {
        await bot.sendMessage(chatId, tb(elLang, 'editMsgSaved'));
        // Aynan o'zini (entities bilan) qayta yuboramiz — shu "hech narsa
        // o'zgarmadi" degan aniq tasdiq, alohida o'zgartirish/hisoblashsiz.
        await bot.sendMessage(chatId, msg.text, { entities: msg.entities?.length ? msg.entities : undefined, reply_markup: await keyboardForUser(elUser, elLang) });
      }
    }
    return;
  }

  // ── "📢 Xabar yuborish" rejimi — TASDIQSIZ (aniq talab: "hech qanday
  // so'rovlarsiz va o'zgartirishlarsiz"). Tugma bosilgach dasturchi
  // klaviaturasi FAQAT "⏹ Yakunlash"dan iborat bo'ladi (boshqa tugma bosib
  // qo'yib, uni ham xabar deb hammaga yuborib yubormasin uchun) — shu holatda
  // yuborgan HAR BIR matn yoki apk/exe fayl DARHOL, aynan yozilgan/yuborilgan
  // holicha (premium emoji/formatlash — entities — saqlanib) hammaga ketadi,
  // "⏹ Yakunlash" bosilguncha shu rejim davom etadi (bir nechta fayl+matnni
  // ketma-ket tashlash mumkin).
  if (pendingBroadcastChoice.has(chatId)) {
    const armedAt = pendingBroadcastChoice.get(chatId) as number;
    const expired = Date.now() - armedAt > BROADCAST_ARM_TIMEOUT_MS;
    const bcUser = await User.findOne({ telegramChatId: chatId.toString() }).catch(() => null);
    const bcLang = bcUser?.language as BotLang | undefined;
    if (!bcUser || !isDev(bcUser.role)) { pendingBroadcastChoice.delete(chatId); }
    else if (expired) {
      // Unutib qo'yilgan "qurollangan" holat — xavfsizlik uchun avtomatik
      // yopildi, keyingi (oddiy) xabar endi HAMMAGA emas, unga o'ziga
      // ketadi ("hech qanday so'rovlarsiz" tasdiqsiz-broadcast rejimi
      // cheksiz ochiq qolsa, dasturchi bir kunmas-bir kun tasodifiy
      // xabarni ham hammaga yuborib qo'yishi mumkin edi).
      pendingBroadcastChoice.delete(chatId);
      await bot.sendMessage(chatId, tb(bcLang, 'broadcastAutoEnded'), { reply_markup: await keyboardForUser(bcUser, bcLang) });
    }
    else {
      if (msg.text === tb(bcLang, 'kb_broadcastEnd')) {
        pendingBroadcastChoice.delete(chatId);
        await bot.sendMessage(chatId, tb(bcLang, 'broadcastEnded'), { reply_markup: await keyboardForUser(bcUser, bcLang) });
        return;
      }
      if (msg.text && !msg.document) {
        await bot.sendMessage(chatId, tb(bcLang, 'versionBroadcastStarted'));
        await broadcastTextMessage(msg.text, msg.entities, chatId, bcLang);
        return;
      }
      if (msg.document) {
        const fileName: string = msg.document.file_name || '';
        const ext = path.extname(fileName).toLowerCase();
        if (ext === '.apk' || ext === '.exe') {
          const kind: 'apk' | 'exe' = ext === '.apk' ? 'apk' : 'exe';
          if (msg.media_group_id) {
            // Albom (bir nechta fayl bitta harakatda) — qisqa vaqt to'plab,
            // BIRGALIKDA, bitta (topilgan) izoh bilan yuboriladi.
            scheduleMediaGroupBroadcast(msg.media_group_id, chatId, bcLang, msg.document.file_id, kind, msg.caption, msg.caption_entities);
            return;
          }
          await bot.sendMessage(chatId, tb(bcLang, 'versionBroadcastStarted'));
          await broadcastVersionFile(msg.document.file_id, kind, chatId, bcLang, msg.caption, msg.caption_entities);
          return;
        }
      }
      await bot.sendMessage(chatId, tb(bcLang, 'broadcastUnsupportedType'));
      return;
    }
  }

  // ── Dasturchi APK/EXE fayl tashlasa (yuqoridagi "Xabar yuborish"
  // rejimidan TASHQARIDA, tugmani bosmasdan) — YANGI VERSIYA sifatida
  // TASDIQSIZ, darhol hammaga yuboriladi (Cloudinary'ga UMUMAN BOG'LIQ
  // EMAS, to'liq qo'lda boshqariladigan muqobil yo'l).
  if (msg.document && !msg.text) {
    const fileName: string = msg.document.file_name || '';
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.apk' || ext === '.exe') {
      const docUser = await User.findOne({ telegramChatId: chatId.toString() }).catch(() => null);
      if (docUser && isDev(docUser.role)) {
        const kind: 'apk' | 'exe' = ext === '.apk' ? 'apk' : 'exe';
        const dLang = docUser.language as BotLang | undefined;
        if (msg.media_group_id) {
          scheduleMediaGroupBroadcast(msg.media_group_id, chatId, dLang, msg.document.file_id, kind, msg.caption, msg.caption_entities);
          return;
        }
        await bot.sendMessage(chatId, tb(dLang, 'versionBroadcastStarted'));
        await broadcastVersionFile(msg.document.file_id, kind, chatId, dLang, msg.caption, msg.caption_entities);
        return;
      }
    }
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
  // Admin/ishchi menyusi tugmalari dasturchi tomonidan o'zgartirilgan bo'lishi
  // mumkin — pastdagi HAMMA solishtirish shu (custom-aware) qiymatlar bilan.
  const kbSettings: any = await getAppSettingsCached();
  const SL = (scope: KbScope, key: string) => scopedLabel(kbSettings, scope, key, lang);

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
  if (text === SL(admin ? 'admin' : 'user', 'kb_chat')) {
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
    // Tugma matnlari dasturchi tomonidan o'zgartirilgan bo'lishi mumkin —
    // solishtirish HAM shu (custom-aware) qiymatlar bilan qilinadi, aks
    // holda o'zgartirilgan tugma bosilganda hech qaysi shart to'g'ri
    // kelmay, oxirgi "chooseFromMenu" javobiga tushib qolardi.
    const devSettings: any = await getAppSettingsCached();
    const L = (k: string) => devLabel(devSettings, k, user.language as BotLang | undefined);

    if (text === L('kb_firmsList')) {
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

    if (text === L('kb_allUsers')) {
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

    // Faqat dasturchi uchun — ilovadagi chat (DM + guruh) xabarlarining
    // OXIRGI 50 tasi. Aniq talab: "hech qanaqa malumot ochmasin shunchaki
    // yozilgan yoki yuborilgan narsalar ochsin, boshqa hech nima bo'lmasin"
    // — shu sabab FAQAT jo'natuvchi ismi + matn (yoki media bo'lsa faqat
    // TURI, URL/fayl nomi/koordinata EMAS) ko'rsatiladi. Telefon, kompaniya,
    // qabul qiluvchi va h.k. hech biri chiqmaydi.
    if (text === L('kb_chatHistory')) {
      try {
        const msgs = await Message.find({ deleted: { $ne: true } }).sort({ createdAt: -1 }).limit(50).select('fromUserId text type timestamp').lean();
        if (msgs.length === 0) {
          bot.sendMessage(chatId, tb(user.language, 'devNoMessages'), { reply_markup: await keyboardForUser(user, user.language) });
          return;
        }
        const fromIds = [...new Set(msgs.map((m: any) => m.fromUserId))];
        const senders = await User.find({ _id: { $in: fromIds } }).select('firstName lastName').lean();
        const nameMap: Record<string, string> = {};
        (senders as any[]).forEach((u: any) => { nameMap[String(u._id)] = `${u.firstName} ${u.lastName || ''}`.trim(); });
        const typeLabel: Record<string, string> = { image: '[rasm]', video: '[video]', audio: '[ovoz xabari]', file: '[fayl]', location: '[joylashuv]' };
        const lines = (msgs as any[]).reverse().map((m: any) => {
          const name = nameMap[String(m.fromUserId)] || '—';
          const body = m.type && m.type !== 'text' ? (typeLabel[m.type] || `[${m.type}]`) : (m.text || '—');
          return `*${name}:* ${body}`;
        }).join('\n');
        bot.sendMessage(chatId, `${tb(user.language, 'devChatHistoryHeader')}\n\n${lines}`, { parse_mode: 'Markdown', reply_markup: await keyboardForUser(user, user.language) });
      } catch (err) {
        console.error('[bot kb_chatHistory]', err);
        bot.sendMessage(chatId, tb(user.language, 'genericError'), { reply_markup: await keyboardForUser(user, user.language) });
      }
      return;
    }

    if (text === L('kb_allSubscriptions')) {
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

    if (text === L('kb_generalStats')) {
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

    // ── "Xabar yuborish" — shu paytdan "⏹ Yakunlash"gacha yuborilgan HAR
    // BIR matn/apk/exe fayl tasdiqsiz, darhol hammaga ketadi.
    if (text === L('kb_broadcast')) {
      pendingBroadcastChoice.set(chatId, Date.now());
      bot.sendMessage(chatId, tb(user.language, 'broadcastPrompt'), { reply_markup: BROADCAST_MODE_KEYBOARD(user.language as BotLang | undefined) });
      return;
    }

    // ── Sayt/bot yoqish-o'chirish (texnik ishlar rejimi) ────────────────────
    if (text === L('kb_disableSite') || text === L('kb_enableSite')) {
      const enable = text === L('kb_enableSite');
      await AppSettings.findOneAndUpdate({ key: 'global' }, { $set: { key: 'global', siteEnabled: enable, updatedAt: new Date() } }, { upsert: true });
      cachedAppSettings = null;
      { const m = devEffectiveMsgFull(devSettings, enable ? 'siteEnabledMsg' : 'siteDisabledMsg', user.language as BotLang | undefined, true);
        bot.sendMessage(chatId, m.text, { entities: m.entities, reply_markup: await keyboardForUser(user, user.language) }); }
      return;
    }
    if (text === L('kb_disableBot') || text === L('kb_enableBot')) {
      const enable = text === L('kb_enableBot');
      await AppSettings.findOneAndUpdate({ key: 'global' }, { $set: { key: 'global', botEnabled: enable, updatedAt: new Date() } }, { upsert: true });
      cachedBotEnabled = enable; botEnabledCachedAt = Date.now(); // o'zining keyingi so'rovi eski keshga urilmasin
      cachedAppSettings = null;
      { const m = devEffectiveMsgFull(devSettings, enable ? 'botEnabledMsg' : 'botDisabledMsg', user.language as BotLang | undefined, true);
        bot.sendMessage(chatId, m.text, { entities: m.entities, reply_markup: await keyboardForUser(user, user.language) }); }
      return;
    }

    // ── "⚙️ Tugmalarni sozlash" — matn/tartibni o'zgartirish menyusi ────────
    if (text === L('kb_devSettings')) {
      await bot.sendMessage(chatId, tb(user.language, 'devSettingsIntro'), { reply_markup: devSettingsMenu(user.language as BotLang | undefined) });
      return;
    }

    bot.sendMessage(chatId, tb(user.language, 'chooseFromMenu'), { reply_markup: await keyboardForUser(user, user.language) });
    return;
  }

  // ── ADMIN commands ────────────────────────────────────────────────────────
  if (admin) {
    if (text === SL('admin', 'kb_pendingApprovals')) {
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

    if (text === SL('admin', 'kb_financeStatus')) {
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

    if (text === SL('admin', 'kb_objects')) {
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

    if (text === SL('admin', 'kb_staffList')) {
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

    if (text === SL('admin', 'kb_report')) {
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

    if (text === SL('admin', 'kb_subscriptionStatus')) {
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
  if (text === SL('user', 'kb_incomingTransfers')) {
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

  if (text === SL('user', 'kb_sentTransfers')) {
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

  if (text === SL('user', 'kb_incomingPayments')) {
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

  // ── Texnik ishlar rejimi — tugma bosishlari ham shu tekshiruvdan o'tadi.
  if (!user || !isDev(user.role)) {
    if (!(await isBotEnabled())) {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      if (chatId) {
        const settings: any = await AppSettings.findOne({ key: 'global' }).select('devMessageTexts').lean();
        const mm = devEffectiveMsgFull(settings, 'botMaintenanceMsg', lang);
        bot.sendMessage(chatId, mm.text, { entities: mm.entities, reply_markup: RESTRICTED_KEYBOARD(lang) }).catch(() => {});
      }
      return;
    }
  }

  // ── Majburiy obuna — INLINE TUGMALAR uchun ham. XATO TUZATILDI: avval gate
  // FAQAT /start va oddiy MATNLI xabarlarda tekshirilardi (bot.ts'dagi
  // 'message' handlerida) — callback_query (inline tugma bosish) HECH QACHON
  // tekshirilmasdi. Amalda ko'pchilik allaqachon FAOL foydalanuvchi
  // (attendance tasdiqlash, tasdiqlash/rad etish, chat tanlash va h.k.)
  // asosan TUGMA bosadi, matn yozmaydi — shu sabab ular uchun gate deyarli
  // HECH QACHON ishga tushmasdi (aynan "yangi foydalanuvchilardan boshqa
  // hammada ishlamayapti" degan xabar shu bilan izohlanadi). Eski (gate'dan
  // OLDIN yuborilgan) inline klaviaturalarni Telegram avtomatik yashirmaydi
  // (Bot API cheklovi, o'zgartirib bo'lmaydi) — lekin endi bosilganda amal
  // BAJARILISHDAN OLDIN shu yerda qayta tekshiriladi, obuna yo'q bo'lsa amal
  // ishlamaydi. 'subcheck'ning O'ZI bundan mustasno (aks holda foydalanuvchi
  // hech qachon "✅ Tekshirish" tugmasini bosib chiqolmasdi).
  if (data !== 'subcheck' && (!user || !isDev(user.role)) && chatId && query.from?.id) {
    if (await enforceSubscriptionGate(chatId, query.from.id, lang)) {
      await bot.answerCallbackQuery(query.id, { text: tb(lang, 'subGateStillMissing'), show_alert: true }).catch(() => {});
      return;
    }
  }

  // ── Majburiy obuna — "✅ Tekshirish" tugmasi. FORCE (keshsiz) qayta
  // tekshiradi — foydalanuvchi aynan shu tugmani "hozir obuna bo'ldim,
  // tekshir" degani uchun bosadi, eski keshdan javob berish noto'g'ri.
  if (data === 'subcheck') {
    await bot.answerCallbackQuery(query.id).catch(() => {});
    if (!chatId || !query.from?.id) return;
    const missing = await getMissingSubscriptions(query.from.id, true);
    if (missing.length > 0) {
      await bot.answerCallbackQuery(query.id, { text: tb(lang, 'subGateStillMissing'), show_alert: true }).catch(() => {});
      const settings: any = await getAppSettingsCached();
      const m = subscribeGateEffectiveMsg(settings, lang);
      const markup = subscribeGateKeyboard(missing, lang);
      if (messageId) {
        await bot.editMessageText(m.text, { chat_id: chatId, message_id: messageId, entities: m.entities, reply_markup: markup })
          .catch(() => bot.sendMessage(chatId, m.text, { entities: m.entities, reply_markup: markup }));
      } else {
        await bot.sendMessage(chatId, m.text, { entities: m.entities, reply_markup: markup });
      }
      return;
    }
    // Hammasiga obuna bo'lindi — tasdiq va normal klaviatura.
    if (messageId) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => {});
    if (user) {
      await bot.sendMessage(chatId, tb(lang, 'subGateAllDone'), { reply_markup: await keyboardForUser(user, lang) });
    } else {
      // Hali ro'yxatdan o'tmagan (telefon ulashmagan) foydalanuvchi —
      // /start'ning "yangi foydalanuvchi" oqimini shu yerda takrorlaymiz.
      await bot.sendMessage(chatId, tb(undefined, 'subGateAllDone'));
      await bot.sendMessage(chatId, tb(undefined, 'startWelcomeNew'), {
        parse_mode: 'Markdown',
        reply_markup: { keyboard: [[{ text: tb(undefined, 'sharePhoneBtn'), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
      });
    }
    return;
  }

  // ── Dasturchi — "⚙️ Tugmalarni sozlash" bo'limi (tugma/xabar matnlari,
  // tartib, standartga qaytarish). Barchasi faqat dasturchi uchun. ────────
  if (user && isDev(user.role) && (
    data === 'devmsgs' || data === 'devsettingsback' ||
    data === 'devresetask' || data === 'devresetyes' || data === 'devresetno' ||
    data.startsWith('devlabels_') || data.startsWith('devreorder_') ||
    data.startsWith('editlbl_') || data.startsWith('editmsg_') || data.startsWith('mvup_') || data.startsWith('mvdn_')
  )) {
    await bot.answerCallbackQuery(query.id).catch(() => {});
    const settings: any = await AppSettings.findOne({ key: 'global' }).lean();
    const editScreen = async (msgText: string, markup: any) => {
      if (!messageId) { await bot.sendMessage(chatId, msgText, { reply_markup: markup }); return; }
      await bot.editMessageText(msgText, { chat_id: chatId, message_id: messageId, reply_markup: markup })
        .catch(() => bot.sendMessage(chatId, msgText, { reply_markup: markup }));
    };
    // "editlbl_admin_kb_chat" kabi data'lardan scope'ni ajratib olish — scope
    // qiymati doim 'dev'/'admin'/'user' (pastcha chiziqsiz), shu sabab XAVFSIZ.
    const splitScope = (prefixed: string): { scope: KbScope; rest: string } => {
      const scope = prefixed.split('_')[0] as KbScope;
      return { scope, rest: prefixed.slice(scope.length + 1) };
    };

    if (data === 'devsettingsback') { await editScreen(tb(lang, 'devSettingsIntro'), devSettingsMenu(lang)); return; }
    if (data === 'devmsgs') { await editScreen(tb(lang, 'devSettingsPickMsg'), devMsgsMenu(settings, lang)); return; }
    if (data.startsWith('devlabels_')) {
      const scope = data.slice('devlabels_'.length) as KbScope;
      await editScreen(`${tb(lang, SCOPE_TITLE_KEY[scope])}\n\n${tb(lang, 'devSettingsPickLabel')}`, devLabelsMenu(settings, scope, lang));
      return;
    }
    if (data.startsWith('devreorder_')) {
      const scope = data.slice('devreorder_'.length) as KbScope;
      await editScreen(`${tb(lang, SCOPE_TITLE_KEY[scope])}\n\n${tb(lang, 'devReorderIntro')}`, devReorderMenu(settings, scope, lang));
      return;
    }

    if (data.startsWith('editlbl_')) {
      const { scope, rest: key } = splitScope(data.slice('editlbl_'.length));
      if (!LABEL_KEYS_BY_SCOPE[scope]?.includes(key)) return;
      pendingLabelEdit.set(chatId, `label:${scope}:${key}`);
      await bot.sendMessage(chatId, tb(lang, 'editLabelPrompt', { current: scopedLabel(settings, scope, key, lang) }));
      return;
    }
    if (data.startsWith('editmsg_')) {
      const key = data.slice('editmsg_'.length);
      if (!(DEV_MSG_KEYS as readonly string[]).includes(key)) return;
      pendingLabelEdit.set(chatId, `msg:${key}`);
      await bot.sendMessage(chatId, tb(lang, 'editLabelPrompt', { current: devEffectiveMsg(settings, key, lang) }));
      return;
    }
    if (data.startsWith('mvup_') || data.startsWith('mvdn_')) {
      const up = data.startsWith('mvup_');
      const { scope, rest: atom } = splitScope(data.slice(up ? 'mvup_'.length : 'mvdn_'.length));
      const order = effectiveOrder(settings, scope);
      const i = order.indexOf(atom);
      const j = up ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < order.length) {
        [order[i], order[j]] = [order[j], order[i]];
        await AppSettings.findOneAndUpdate({ key: 'global' }, { $set: { key: 'global', [orderField(scope)]: order, updatedAt: new Date() } }, { upsert: true });
        cachedAppSettings = null;
      }
      const fresh: any = await AppSettings.findOne({ key: 'global' }).lean();
      await editScreen(`${tb(lang, SCOPE_TITLE_KEY[scope])}\n\n${tb(lang, 'devReorderIntro')}`, devReorderMenu(fresh, scope, lang));
      return;
    }
    if (data === 'devresetask') {
      await editScreen(tb(lang, 'devResetConfirm'), { inline_keyboard: [[
        { text: tb(lang, 'confirmYes'), callback_data: 'devresetyes' },
        { text: tb(lang, 'confirmNo'), callback_data: 'devresetno' },
      ]] });
      return;
    }
    if (data === 'devresetno') { await editScreen(tb(lang, 'devSettingsIntro'), devSettingsMenu(lang)); return; }
    if (data === 'devresetyes') {
      await AppSettings.findOneAndUpdate({ key: 'global' }, { $set: {
        key: 'global',
        devButtonLabels: {}, devButtonOrder: [],
        adminButtonLabels: {}, adminButtonOrder: [],
        userButtonLabels: {}, userButtonOrder: [],
        devMessageTexts: {},
        updatedAt: new Date(),
      } }, { upsert: true });
      cachedAppSettings = null;
      await bot.sendMessage(chatId, tb(lang, 'devResetDone'), { reply_markup: await keyboardForUser(user, lang) });
      return;
    }
    return;
  }

  // ── Dasturchi — "📋 Majburiy obuna" (kanal havolalari/nomlari/xabar matni
  // tahrirlash). Alohida blok — devsettings blokidan tashqarida, chunki
  // saqlanadigan maydon (requiredChannels/subscribeGateMsg) butunlay
  // boshqa struktura (label/msg emas, indeks bo'yicha massiv elementi).
  if (user && isDev(user.role) && (data === 'subgatemenu' || data.startsWith('subgateurl_') || data.startsWith('subgatetitle_') || data === 'subgatemsg' || data.startsWith('subgateassign_') || data === 'subgatetest')) {
    await bot.answerCallbackQuery(query.id).catch(() => {});
    const settings: any = await AppSettings.findOne({ key: 'global' }).lean();
    const editScreen = async (msgText: string, markup: any) => {
      if (!messageId) { await bot.sendMessage(chatId, msgText, { reply_markup: markup }); return; }
      await bot.editMessageText(msgText, { chat_id: chatId, message_id: messageId, reply_markup: markup })
        .catch(() => bot.sendMessage(chatId, msgText, { reply_markup: markup }));
    };
    if (data === 'subgatemenu') { await editScreen(subGateAdminIntroText(settings, lang), subGateAdminMenu(settings, lang)); return; }
    // Live tekshirish — Render loglariga kirmasdan, DASTURCHINING O'ZINI test
    // qilib, har bir kanal uchun Telegram nima qaytarayotganini shu yerda
    // ko'rsatadi (dasturchi gate'dan istisno bo'lgani uchun, bu tugma
    // gate'ning o'zini chetlab, faqat DIAGNOSTIKA uchun to'g'ridan-to'g'ri
    // tekshiradi). Eslatma: dasturchi o'zi ham kanallarga obuna bo'lmagan
    // bo'lsa, natija shuni ko'rsatadi — bu normal, faqat status/xatolikni
    // ko'rish uchun.
    if (data === 'subgatetest') {
      const report = await diagnoseSubscriptions(query.from.id);
      await bot.sendMessage(chatId, `🔬 Live tekshirish natijasi (sizning hisobingiz bo'yicha):\n\n${report}`);
      return;
    }
    const required = getRequiredChannels(settings);
    // Auto-title-matching moslay olmagan (my_chat_member) kanalni dasturchi
    // qo'lda bir slotga bog'laydi — "subgateassign_<slotIndex>_<discoveredIndex>".
    if (data.startsWith('subgateassign_')) {
      const [, iStr, diStr] = data.split('_');
      const i = Number(iStr), di = Number(diStr);
      const unassigned = unassignedDiscoveredChats(settings);
      const target = unassigned[di];
      if (target && required[i]) {
        const updated = required.map((ch: any) => ({ ...ch }));
        updated[i].chatId = target.chatId;
        await AppSettings.findOneAndUpdate(
          { key: 'global' },
          { $set: { key: 'global', requiredChannels: updated, updatedAt: new Date() } },
          { upsert: true }
        );
        cachedAppSettings = null;
        subscriptionCache.clear();
        const fresh: any = await AppSettings.findOne({ key: 'global' }).lean();
        await editScreen(subGateAdminIntroText(fresh, lang), subGateAdminMenu(fresh, lang));
      }
      return;
    }
    if (data.startsWith('subgateurl_')) {
      const i = Number(data.slice('subgateurl_'.length));
      const ch = required[i];
      if (!ch) return;
      pendingLabelEdit.set(chatId, `subch:url:${i}`);
      await bot.sendMessage(chatId, tb(lang, 'subGateEditUrlPrompt', { title: ch.title }));
      return;
    }
    if (data.startsWith('subgatetitle_')) {
      const i = Number(data.slice('subgatetitle_'.length));
      const ch = required[i];
      if (!ch) return;
      pendingLabelEdit.set(chatId, `subch:title:${i}`);
      await bot.sendMessage(chatId, tb(lang, 'subGateEditTitlePrompt', { title: ch.title }));
      return;
    }
    if (data === 'subgatemsg') {
      pendingLabelEdit.set(chatId, 'subch:msg');
      await bot.sendMessage(chatId, tb(lang, 'subGateEditMsgPrompt'));
      return;
    }
    return;
  }
  if (data === 'noop') { await bot.answerCallbackQuery(query.id).catch(() => {}); return; }

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
      // XATO TUZATILDI: avval BU YERDA SO'ZSIZ so'ralardi — ishchi oldingi
      // smenada "Until I turn it off" (muddatsiz) tanlagan bo'lsa va u hali
      // ham FAOL (uzluksiz 'edited_message' yangilanishlari kelib turibdi)
      // bo'lsa ham, xuddi hech narsa yo'qdek qayta so'rardi. Endi avval eng
      // oxirgi 'bot_live' GPS yozuvi FRESH (5 daqiqadan yangi) ekanini
      // tekshiramiz — shunday bo'lsa jonli joylashuv hali ham ishlayapti
      // degani, qayta so'ramasdan to'g'ridan-to'g'ri check-in qilamiz.
      const recentLive = await GpsLocation.findOne({ userId: String(user._id), source: 'bot_live' })
        .sort({ timestamp: -1 }).select('timestamp').lean();
      const stillLive = !!recentLive && (Date.now() - new Date(recentLive.timestamp).getTime()) < LIVE_LOCATION_FRESH_MS;
      if (stillLive) {
        const resultText = await doCheckIn(user, lang);
        await bot.sendMessage(chatId, resultText, { reply_markup: await keyboardForUser(user, lang) });
        return;
      }
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

// ─── Ertalabki "Ishga keldingizmi?" / kechki "Ishni tugatdingizmi?" ────────
// Aniq talab: ertalab 5,6,7,8,9 da hali BUGUN ishga kelmagan har bir
// ishchi/prorab/brigadir'ga, kechqurun 18,19,20,21,22,23,0 da esa hali
// ISHNI TUGATMAGAN (checkIn bor, checkOut yo'q) har biriga avtomatik
// eslatma. Tugmalar to'g'ridan-to'g'ri xuddi "Ishga keldim"/"Ish tugadi"
// bosilgandek ishlaydi (confirm_checkin/confirm_checkout).
//
// Bir foydalanuvchiga soat-soat qatorasiga bir xil eslatma "uyilib"
// qolmasin uchun (masalan 6da, 7da, 8da — 3 marta bir xil xabar) — har
// safar YANGI eslatma yuborishdan OLDIN, O'SHA foydalanuvchining oldingi
// eslatmasi (agar hali javob berilmagan bo'lsa) tugmasi olib tashlanib
// "eskirgan" qilib belgilanadi.
//
// node-cron kabi kutubxona ATAYLAB qo'shilmadi — loyihada allaqachon shu
// pattern bor (masalan transactions.ts'dagi idempotency tozalash): oddiy
// setInterval, har daqiqada Toshkent soatini tekshiradi. lastReminderKey
// server bitta soat ichida ikki marta yubormasligini ta'minlaydi (server
// qayta ishga tushsa xotiradagi belgi yo'qoladi — eng yomon holatda o'sha
// soat uchun eslatma yana bir marta yuborilishi mumkin, xavfli emas).
const REMINDER_HOURS_IN = new Set([5, 6, 7, 8, 9]);
const REMINDER_HOURS_OUT = new Set([18, 19, 20, 21, 22, 23, 0]); // "kechki 12" — yarim tun
let lastReminderKeyIn = '';
let lastReminderKeyOut = '';

// Oldingi eslatma xabarini o'chiradi — endi User.lastReminderMsgId'dan
// (BAZADAN, xotiradagi Map'dan EMAS) o'qiladi. XATO TUZATILDI: avval
// bu holat oddiy in-memory Map'da saqlanardi — server har safar qayta
// ishga tushganda (masalan har push'da Render qayta deploy qilganda)
// xotira butunlay tozalanib, keyingi eslatma "oldingisini o'chirmasdan"
// yuborilib qolardi (aniq xabar qilingan xato: "bittasini yuborishidan
// oldin undan oldin yuborilganini o'chirishi kere hardoim"). Bazada
// saqlash — qayta ishga tushirish, bir nechta server nusxasi (agar
// bo'lsa) bilan ham ishonchli ishlaydi.
async function retireOldReminder(chatId: string, oldMsgId: number | null | undefined) {
  if (!oldMsgId) return;
  await bot.deleteMessage(chatId, oldMsgId).catch(() => {});
}

async function sendMorningReminders() {
  const today = todayInTashkent();
  const workers = await User.find({
    role: { $in: ['ishchi', 'prorab', 'brigadir'] },
    telegramChatId: { $exists: true, $ne: '' },
  }).select('telegramChatId language lastReminderMsgId').lean();
  if (workers.length === 0) return;

  const workerIds = workers.map((w: any) => String(w._id));
  const already = await Attendance.find({ userId: { $in: workerIds }, date: today, checkIn: { $exists: true, $ne: null } }).select('userId').lean();
  const alreadyIn = new Set(already.map((a: any) => a.userId));

  for (const w of workers) {
    if (alreadyIn.has(String((w as any)._id))) continue;
    const chatId = w.telegramChatId;
    if (!chatId) continue; // query allaqachon filtrlagan, faqat TS uchun
    const lang = w.language as BotLang | undefined;
    try {
      await retireOldReminder(chatId, (w as any).lastReminderMsgId);
      const msg = await bot.sendMessage(chatId, tb(lang, 'morningCheckInReminder'), {
        reply_markup: { inline_keyboard: [[{ text: tb(lang, 'kb_checkIn'), callback_data: 'confirm_checkin' }]] },
      });
      await User.updateOne({ _id: (w as any)._id }, { $set: { lastReminderMsgId: msg.message_id } });
    } catch (err) {
      console.error('[morning reminder] send error:', (err as Error).message);
    }
    await new Promise(r => setTimeout(r, 50)); // Telegram rate-limit zaxirasi
  }
}

async function sendEveningReminders() {
  const workers = await User.find({
    role: { $in: ['ishchi', 'prorab', 'brigadir'] },
    telegramChatId: { $exists: true, $ne: '' },
  }).select('telegramChatId language lastReminderMsgId').lean();
  if (workers.length === 0) return;

  const workerIds = workers.map((w: any) => String(w._id));
  // MUHIM: sana bo'yicha EMAS, "checkIn bor-u checkOut yo'q" bo'yicha
  // qidiramiz — soat 0 (yarim tun) eslatmasida "bugun" allaqachon
  // KEYINGI kalendar kuniga o'tib ketgan bo'ladi, lekin ochiq smena hali
  // "kechagi" sana bilan yozilgan — sana bo'yicha filtrlasak shu smenani
  // o'tkazib yuborardik.
  const openShifts = await Attendance.find({
    userId: { $in: workerIds },
    checkIn: { $exists: true, $ne: null },
    $or: [{ checkOut: { $exists: false } }, { checkOut: null }],
  }).select('userId').lean();
  const stillWorking = new Set(openShifts.map((a: any) => a.userId));

  for (const w of workers) {
    if (!stillWorking.has(String((w as any)._id))) continue;
    const chatId = w.telegramChatId;
    if (!chatId) continue; // query allaqachon filtrlagan, faqat TS uchun
    const lang = w.language as BotLang | undefined;
    try {
      await retireOldReminder(chatId, (w as any).lastReminderMsgId);
      const msg = await bot.sendMessage(chatId, tb(lang, 'eveningCheckOutReminder'), {
        reply_markup: { inline_keyboard: [[{ text: tb(lang, 'kb_checkOut'), callback_data: 'confirm_checkout' }]] },
      });
      await User.updateOne({ _id: (w as any)._id }, { $set: { lastReminderMsgId: msg.message_id } });
    } catch (err) {
      console.error('[evening reminder] send error:', (err as Error).message);
    }
    await new Promise(r => setTimeout(r, 50));
  }
}

// ─── Dasturchi qo'lda tashlagan APK/EXE'ni hammaga tarqatish ───────────────
// Cloudinary'ga UMUMAN bog'liq emas — fayl Telegram'ning o'z serverida
// allaqachon bor (dasturchi uni botga yuborgan payt yuklangan), shuning
// uchun QAYTA yuklash shart emas: file_id barcha qabul qiluvchiga qayta
// ishlatiladi, Telegram buni serverida o'zi tez ko'chiradi.
//
// Saytdagi "yuklab olish" bo'limi uchun Render'ning O'Z (vaqtinchalik)
// diskiga ham bitta nusxa saqlanadi — bu ham EPHEMERAL (qayta ishga
// tushirilganda yo'qoladi), lekin bu yo'l aynan "yangi versiya chiqqanda
// qo'lda tashlayman" tsikliga bog'liq bo'lgani uchun, deploy vaqti bilan
// mos keladi (har safar yangi versiya — yangi tashlash — yangi nusxa).
// customCaption/customCaptionEntities — dasturchi faylni yuborayotganda
// O'ZI yozgan izoh (Telegram'da hujjatga qo'shiladigan "caption", VA uning
// alohida formatlash/PREMIUM EMOJI ma'lumoti — msg.caption_entities, bu
// msg.entities'dan BUTUNLAY BOSHQA maydon). Berilsa — aynan o'sha ishlatiladi
// (hech narsa o'zgarmasdan); berilmasa (masalan izohsiz tashlangan bo'lsa)
// standart "🆕 QurilishERP — yangi versiya (sana)" ishlatiladi.
async function broadcastVersionFile(fileId: string, kind: 'apk' | 'exe', fromChatId: number, fromLang?: BotLang, customCaption?: string, customCaptionEntities?: any[]) {
  const stableName = `QurilishERP-latest.${kind}`;
  try {
    const fileLink = await bot.getFileLink(fileId);
    const resp = await fetch(fileLink);
    const buf = Buffer.from(await resp.arrayBuffer());
    const destDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, stableName), buf);
  } catch (err) {
    console.error('[version broadcast] lokal nusxa saqlashda xato (baribir davom etamiz):', err);
  }

  const version = todayInTashkent();
  const publicUrl = `${getBackendUrl()}/uploads/${stableName}`;
  // XAVFSIZLIK/TO'G'RILIK: $set ICHIDA — aks holda bu operatorsiz "to'liq
  // almashtirish" hujjati bo'lib, faqat kind (apk YOKI exe)ning o'zini
  // saqlab, IKKINCHISINI (masalan avval saqlangan exeUrl'ni) BUTUNLAY
  // O'CHIRIB TASHLAR edi — har safar faqat bittasi (apk yoki exe)
  // broadcast qilinganda ikkinchisi saytdan "yo'qolib" qolardi.
  await AppRelease.findOneAndUpdate(
    { key: 'latest' },
    { $set: { key: 'latest', version, [kind === 'apk' ? 'apkUrl' : 'exeUrl']: publicUrl, updatedAt: new Date() } },
    { upsert: true }
  ).catch(err => console.error('[version broadcast] AppRelease saqlash xatosi:', err));

  const users = await User.find({
    role: { $ne: 'dasturchi' },
    telegramChatId: { $exists: true, $ne: '' },
  }).select('telegramChatId language').lean();

  let sent = 0, failed = 0;
  const caption = customCaption ?? `🆕 QurilishERP — yangi versiya (${version})`;
  const captionEntities = customCaption ? customCaptionEntities : undefined;
  for (const u of users) {
    if (!u.telegramChatId) continue;
    try {
      await bot.sendDocument(u.telegramChatId, fileId, { caption, caption_entities: captionEntities?.length ? captionEntities : undefined });
      sent++;
    } catch (err) {
      failed++;
      console.error('[version broadcast] send error:', (err as Error).message);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  await bot.sendMessage(fromChatId, tb(fromLang, 'versionBroadcastDone', { sent: String(sent), failed: String(failed) }));
}

// Dasturchi APK VA EXE'ni BIR ALBOM sifatida (Telegram "media group" —
// bir nechta faylni bitta xabarga bog'lab yuborish) tashlaganda ishlatiladi.
// MUHIM: Telegram albomda izohni (caption) faqat BITTA elementga biriktiradi
// — qaysi faylga tekkani tasodifiy (odatda birinchisiga). Avval har bir
// faylni ALOHIDA broadcastVersionFile() bilan yuborardik — natijada bittasi
// dasturchining haqiqiy izohi bilan, ikkinchisi esa standart ("yangi versiya")
// izoh bilan ketardi (aniq xabar qilingan xato: "yana ikkita bop ketip
// qovtti"). Endi IKKALASI ham bitta guruh (sendMediaGroup) sifatida, BITTA
// (albomdagi qaysi fayl bo'lishidan qat'iy nazar topilgan) izoh bilan ketadi.
async function broadcastVersionFiles(items: { fileId: string; kind: 'apk' | 'exe' }[], fromChatId: number, fromLang?: BotLang, customCaption?: string, customCaptionEntities?: any[]) {
  if (items.length === 1) {
    return broadcastVersionFile(items[0].fileId, items[0].kind, fromChatId, fromLang, customCaption, customCaptionEntities);
  }
  const version = todayInTashkent();
  const setFields: any = { key: 'latest', version, updatedAt: new Date() };
  for (const item of items) {
    const stableName = `QurilishERP-latest.${item.kind}`;
    try {
      const fileLink = await bot.getFileLink(item.fileId);
      const resp = await fetch(fileLink);
      const buf = Buffer.from(await resp.arrayBuffer());
      const destDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, stableName), buf);
      setFields[item.kind === 'apk' ? 'apkUrl' : 'exeUrl'] = `${getBackendUrl()}/uploads/${stableName}`;
    } catch (err) {
      console.error('[version broadcast/group] lokal nusxa saqlashda xato (baribir davom etamiz):', err);
    }
  }
  await AppRelease.findOneAndUpdate({ key: 'latest' }, { $set: setFields }, { upsert: true })
    .catch(err => console.error('[version broadcast/group] AppRelease saqlash xatosi:', err));

  const users = await User.find({
    role: { $ne: 'dasturchi' },
    telegramChatId: { $exists: true, $ne: '' },
  }).select('telegramChatId').lean();

  // XATO TUZATILDI: avval izoh (caption) faqat albomdagi BIRINCHI elementga
  // biriktirilardi — nazariyada Telegram shu elementning izohini butun
  // albom uchun ko'rsatishi kerak, lekin DOCUMENT turidagi albomlarda buni
  // har xil mijozlar/holatlar har xil ko'rsatishi mumkin ekan (aniq xabar
  // qilingan xato: dasturchi o'zi yuborgan ko'rinish bilan qabul
  // qiluvchining ko'rgani mos kelmadi — bitta faylda izoh bor, ikkinchisi
  // butunlay alohida, izohsiz chiqib ketdi). Endi izoh HECH QAYSI faylga
  // BIRIKTIRILMAYDI — ALOHIDA, mustaqil xabar sifatida (albomdan OLDIN)
  // yuboriladi. Bu har doim bir xil, aniq va ishonchli ko'rinadi — na
  // Telegram'ning albom-izoh joylashuvi haqidagi noaniq xatti-harakatiga
  // bog'liq.
  const caption = customCaption ?? `🆕 QurilishERP — yangi versiya (${version})`;
  const captionEntities = customCaption ? customCaptionEntities : undefined;
  const media = items.map(item => ({ type: 'document' as const, media: item.fileId }));

  let sent = 0, failed = 0;
  for (const u of users) {
    if (!u.telegramChatId) continue;
    try {
      await bot.sendMessage(u.telegramChatId, caption, { entities: captionEntities?.length ? captionEntities : undefined });
      await bot.sendMediaGroup(u.telegramChatId, media);
      sent++;
    } catch (err) {
      failed++;
      console.error('[version broadcast/group] send error:', (err as Error).message);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  await bot.sendMessage(fromChatId, tb(fromLang, 'versionBroadcastDone', { sent: String(sent), failed: String(failed) }));
}

// "📢 Xabar yuborish" rejimida dasturchi bir nechta faylni ALBOM sifatida
// (bitta harakatda, umumiy media_group_id bilan) tashlasa — Telegram bu
// har biri UCHUN alohida 'message' hodisasi yuboradi, lekin bir zumda
// (odatda millisekundlar ichida). Shu sabab har bir keluvchi elementni
// qisqa vaqt (debounce) davomida to'playmiz, so'ng BIRGALIKDA (bitta
// albom, bitta izoh bilan) broadcast qilamiz.
const pendingMediaGroup = new Map<string, {
  chatId: number; lang?: BotLang;
  items: { fileId: string; kind: 'apk' | 'exe' }[];
  caption?: string; captionEntities?: any[];
  timer: ReturnType<typeof setTimeout>;
}>();
function scheduleMediaGroupBroadcast(groupId: string, chatId: number, lang: BotLang | undefined, fileId: string, kind: 'apk' | 'exe', caption?: string, captionEntities?: any[]) {
  let entry = pendingMediaGroup.get(groupId);
  if (!entry) {
    entry = { chatId, lang, items: [], timer: setTimeout(() => {}, 0) };
    pendingMediaGroup.set(groupId, entry);
    bot.sendMessage(chatId, tb(lang, 'versionBroadcastStarted')).catch(() => {});
  }
  entry.items.push({ fileId, kind });
  if (caption && !entry.caption) { entry.caption = caption; entry.captionEntities = captionEntities; }
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    pendingMediaGroup.delete(groupId);
    broadcastVersionFiles(entry!.items, entry!.chatId, entry!.lang, entry!.caption, entry!.captionEntities)
      .catch(err => console.error('[media group broadcast]', err));
  }, 1500);
}

// entities — dasturchi yozgan xabardagi Telegram formatlash/PREMIUM EMOJI
// ma'lumoti (msg.entities). Aynan shu qiymat bilan qayta yuborilsa — hammaga
// dasturchi yozgan holicha (emoji o'zgarmasdan) yetib boradi.
async function broadcastTextMessage(text: string, entities: any[] | undefined, fromChatId: number, fromLang?: BotLang) {
  const users = await User.find({
    role: { $ne: 'dasturchi' },
    telegramChatId: { $exists: true, $ne: '' },
  }).select('telegramChatId').lean();

  let sent = 0, failed = 0;
  for (const u of users) {
    if (!u.telegramChatId) continue;
    try {
      await bot.sendMessage(u.telegramChatId, text, entities?.length ? { entities } : undefined);
      sent++;
    } catch (err) {
      failed++;
      console.error('[text broadcast] send error:', (err as Error).message);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  await bot.sendMessage(fromChatId, tb(fromLang, 'versionBroadcastDone', { sent: String(sent), failed: String(failed) }));
}

// Ishchi jonli joylashuvni VAQTLI (masalan 1 soatlik) tanlagan bo'lsa —
// muddat tugagach Telegram AVTOMATIK to'xtaydi, botga hech qanday maxsus
// "tugadi" hodisasi kelmaydi (faqat yangilanishlar shunchaki KELMAY qoladi).
// Shu sabab "tugadimi" degan xulosani BILVOSITA chiqaramiz: hozir ishlab
// turgan (check-in bor, check-out yo'q) xodimning eng oxirgi 'bot_live'
// GPS yozuvi STALE (bir necha daqiqadan beri yangilanmagan) bo'lsa — demak
// yo muddat tugagan, yo qo'lda to'xtatilgan. Har foydalanuvchi uchun
// qayta-qayta emas, COOLDOWN bilan (bir marta smenaga taxminan bitta
// eslatma) so'raladi — checkout'da yoki qayta ulashganda tozalanadi.
const STALE_LIVE_LOCATION_MS = 3 * 60 * 1000; // 3 daqiqa yangilanish kelmasa — "to'xtagan"
const LIVE_NUDGE_COOLDOWN_MS = 20 * 60 * 1000; // bitta ishchiga 20 daqiqada bir martadan ko'p emas
const lastLiveNudge = new Map<string, number>();
async function checkExpiredLiveLocations() {
  const today = todayInTashkent();
  const working = await Attendance.find({ date: today, checkIn: { $exists: true, $ne: null }, checkOut: { $exists: false } })
    .select('userId').lean();
  if (working.length === 0) return;
  const userIds = working.map((a: any) => a.userId);
  const users = await User.find({ _id: { $in: userIds }, telegramChatId: { $exists: true, $ne: '' } })
    .select('telegramChatId language').lean();
  const now = Date.now();
  for (const u of users) {
    const uid = String((u as any)._id);
    const lastNudge = lastLiveNudge.get(uid) || 0;
    if (now - lastNudge < LIVE_NUDGE_COOLDOWN_MS) continue;
    const lastLoc = await GpsLocation.findOne({ userId: uid, source: 'bot_live' }).sort({ timestamp: -1 }).select('timestamp').lean();
    // Umuman jonli yozuv bo'lmagan (masalan faqat bot_once bilan check-in
    // qilingan) holatni ham STALE deb hisoblaymiz — ikkalasida ham natija
    // bir xil: hozir faol jonli kuzatuv YO'Q.
    const stale = !lastLoc || (now - new Date((lastLoc as any).timestamp).getTime()) > STALE_LIVE_LOCATION_MS;
    if (!stale) continue;
    lastLiveNudge.set(uid, now);
    const lang = (u as any).language as BotLang | undefined;
    bot.sendMessage((u as any).telegramChatId, tb(lang, 'liveLocationExpiredReminder')).catch(() => {});
  }
}

setInterval(() => {
  checkExpiredLiveLocations().catch(err => console.error('[live location expiry check]', err));
  const hour = tashkentHour();
  const today = todayInTashkent();
  if (REMINDER_HOURS_IN.has(hour)) {
    const key = `${today}-${hour}`;
    if (lastReminderKeyIn !== key) {
      lastReminderKeyIn = key;
      sendMorningReminders().catch(err => console.error('[morning reminder]', err));
    }
  }
  if (REMINDER_HOURS_OUT.has(hour)) {
    const key = `${today}-${hour}`;
    if (lastReminderKeyOut !== key) {
      lastReminderKeyOut = key;
      sendEveningReminders().catch(err => console.error('[evening reminder]', err));
    }
  }
}, 60_000);

// v1.2 self-signup scene'ni ulaymiz (alohida fayl, eski handlerlar buzilmaydi)
initRegistrationScene(bot);

console.log('✅ Telegram bot ishga tushdi (rol asosida menyu)');
