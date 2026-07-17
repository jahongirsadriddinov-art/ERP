import Registration from '../models/Registration';
import ConsentLog from '../models/ConsentLog';
import {
  findActiveByRawToken, confirmPhone, giveConsent, cancelRegistration,
} from './registrationService';
import { normalizePhone } from '../utils/tokens';

/**
 * v1.2 SELF-SIGNUP BOT SCENE — alohida, izolyatsiya qilingan.
 * Eski bot handlerlariga (bot.ts) tegilmaydi; faqat 3 ta joyга kichik guard
 * qo'shiladi (isInRegistration) — tokensiz /start va oddiy menyu eskicha ishlaydi.
 *
 * node-telegram-bot-api sessiyasi yo'q → chatId bo'yicha in-memory holat.
 * Process qayta ishga tushsa holat yo'qoladi — foydalanuvchi deep-link'ni qayta
 * bossa (/start <token>) holat tiklanadi.
 */

type Phase = 'AWAIT_CONTACT' | 'AWAIT_CONSENT' | 'DONE';
interface RegSession { registrationId: string; phase: Phase; phone: string; }

const sessions = new Map<string, RegSession>();

// bot.ts dagi eski handlerlar shuni chaqiradi — ro'yxat jarayonidagi chatni
// eski oqimga tushirmaslik uchun.
export function isInRegistration(chatId: string | number): boolean {
  return sessions.has(String(chatId));
}

const SITE_URL = (process.env.SITE_URL || 'http://localhost:5173').replace(/\/$/, '');
const IS_HTTPS_SITE = SITE_URL.startsWith('https');

// Telegram xatolari (masalan foydalanuvchi botni bloklagan, noto'g'ri URL) HECH QACHON
// jarayonni o'ldirmasligi kerak — barcha yuborishlarni shu bilan o'raymiz.
function safeSend(bot: any, chatId: any, text: string, opts?: any) {
  return bot.sendMessage(chatId, text, opts).catch((e: any) => {
    console.error('registrationScene sendMessage xatosi:', e?.message || e);
  });
}

function contactKeyboard() {
  return {
    keyboard: [[{ text: '📱 Raqamni yuborish', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function consentText() {
  return (
    '📝 Ro\'yxatdan o\'tishdan oldin quyidagilarga rozilik bildirasiz:\n\n' +
    '• Foydalanish shartlari\n' +
    '• Shaxsiy ma\'lumotlarni qayta ishlash (telefon, ism, firma ma\'lumotlari)\n' +
    '• Telegram orqali tizim bildirishnomalarini olish\n' +
    '• Faqat *firma egasi* sifatida ro\'yxatdan o\'tayotganingiz\n\n' +
    'Davom etamizmi?'
  );
}

export function initRegistrationScene(bot: any) {
  // ── /start <token> — deep-link bilan kirish ─────────────────────────────────
  // Eski /start handleri (bot.ts) argument bo'lsa darhol return qiladi, shuning
  // uchun double-reply bo'lmaydi.
  bot.onText(/^\/start (.+)$/, async (msg: any, match: any) => {
    const chatId = msg.chat.id;
    const rawToken = (match?.[1] || '').trim();

    const reg = await findActiveByRawToken(rawToken);
    if (!reg) {
      safeSend(bot, chatId, '⚠️ Havola yaroqsiz yoki muddati tugagan. Iltimos saytda ro\'yxatdan o\'tishni qaytadan boshlang.');
      return;
    }

    reg.step = 'BOT_STARTED';
    reg.telegramUserId = String(msg.from?.id || '');
    reg.telegramUsername = msg.from?.username;
    reg.telegramChatId = String(chatId);
    await reg.save();

    sessions.set(String(chatId), { registrationId: String(reg._id), phase: 'AWAIT_CONTACT', phone: reg.phone });

    safeSend(bot, chatId,
      '👋 Assalomu alaykum! Ro\'yxatdan o\'tishni yakunlash uchun saytda kiritgan telefon raqamingizni yuboring:',
      { reply_markup: contactKeyboard() }
    );
  });

  // ── Contact — saytdagi raqam bilan solishtirish ─────────────────────────────
  bot.on('contact', async (msg: any) => {
    const chatId = msg.chat.id;
    const session = sessions.get(String(chatId));
    if (!session) return; // ro'yxat jarayonida emas — eski handler ishlaydi

    const contact = msg.contact;
    // Birovning kontaktini yubormasin
    if (!contact || contact.user_id !== msg.from?.id) {
      safeSend(bot, chatId, '❗ Iltimos, o\'z raqamingizni yuboring (pastdagi tugma orqali).', { reply_markup: contactKeyboard() });
      return;
    }

    const reg = await Registration.findById(session.registrationId);
    if (!reg || reg.step === 'EXPIRED' || reg.step === 'COMPLETED' || reg.expiresAt.getTime() < Date.now()) {
      sessions.delete(String(chatId));
      safeSend(bot, chatId, '⚠️ Sessiya muddati tugadi. Saytda qaytadan boshlang.');
      return;
    }

    const contactPhone = normalizePhone(contact.phone_number);
    if (contactPhone !== normalizePhone(session.phone)) {
      reg.phoneAttempts = (reg.phoneAttempts || 0) + 1;
      await reg.save();
      if (reg.phoneAttempts >= 3) {
        await cancelRegistration(reg);
        sessions.delete(String(chatId));
        safeSend(bot, chatId, '❌ Raqam bir necha marta mos kelmadi. Sessiya bekor qilindi. Saytda qaytadan boshlang.', { reply_markup: { remove_keyboard: true } });
        return;
      }
      safeSend(bot, chatId, `❗ Bu raqam saytda kiritganingizga mos kelmadi. Iltimos, o\'sha raqamdan yuboring. (${3 - reg.phoneAttempts} urinish qoldi)`, { reply_markup: contactKeyboard() });
      return;
    }

    await confirmPhone(reg, String(msg.from?.id || ''), String(chatId));
    session.phase = 'AWAIT_CONSENT';

    safeSend(bot, chatId, consentText(), {
      parse_mode: 'Markdown',
      reply_markup: {
        remove_keyboard: true,
      },
    });
    safeSend(bot, chatId, 'Roziligingizni tasdiqlang:', {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Roziman', callback_data: `reg_consent_yes:${reg._id}` },
          { text: '❌ Bekor qilish', callback_data: `reg_consent_no:${reg._id}` },
        ]],
      },
    });
  });

  // ── Consent inline tugmalari ────────────────────────────────────────────────
  bot.on('callback_query', async (query: any) => {
    const data: string = query.data || '';
    if (!data.startsWith('reg_consent_')) return; // faqat o'z tugmalarimiz

    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    const regId = data.split(':')[1];
    const reg = await Registration.findById(regId).catch(() => null);

    if (!reg || reg.step === 'EXPIRED' || reg.step === 'COMPLETED' || reg.expiresAt.getTime() < Date.now()) {
      await bot.answerCallbackQuery(query.id, { text: 'Sessiya muddati tugagan.' }).catch(() => {});
      sessions.delete(String(chatId));
      return;
    }

    if (data.startsWith('reg_consent_no')) {
      await cancelRegistration(reg);
      sessions.delete(String(chatId));
      await bot.answerCallbackQuery(query.id, { text: 'Bekor qilindi' }).catch(() => {});
      await bot.editMessageText('❌ Ro\'yxatdan o\'tish bekor qilindi.', { chat_id: chatId, message_id: messageId }).catch(() => {});
      return;
    }

    // Roziman
    await giveConsent(reg, {
      terms: true, privacy: true, telegram_notify: true, owner_confirm: true,
      version: { terms: 'terms_v1', privacy: 'privacy_v1' },
    });

    // Telegram tomonidagi rozilik audit izi
    await ConsentLog.create({
      registrationId: String(reg._id),
      consentType: 'telegram_consent',
      version: 'telegram_v1',
      acceptedAt: new Date(),
      telegramUserId: reg.telegramUserId,
    }).catch(() => {});

    const session = sessions.get(String(chatId));
    if (session) session.phase = 'DONE';

    await bot.answerCallbackQuery(query.id, { text: 'Rahmat!' }).catch(() => {});
    await bot.editMessageText('🎉 Xush kelibsiz! Telefon raqamingiz tasdiqlandi.', { chat_id: chatId, message_id: messageId }).catch(() => {});

    // Saytga qaytish. MUHIM: Telegram inline URL tugmasi http://localhost'ni RAD etadi
    // (400 Wrong HTTP URL) — faqat https bo'lsa tugma qo'yamiz. Aks holda sayt polling
    // orqali o'zi avtomatik davom etadi, shuning uchun oddiy matn yetarli.
    if (IS_HTTPS_SITE) {
      await safeSend(bot, chatId, 'Endi saytga qayting — firma ma\'lumotlarini to\'ldiring:', {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Saytga o\'tish', url: `${SITE_URL}/register?rid=${reg._id}` },
          ]],
        },
      });
    } else {
      await safeSend(bot, chatId, '✅ Tasdiqlandi! Endi saytga qayting — sahifa avtomatik davom etadi va firma ma\'lumotlarini so\'raydi.');
    }

    // Ro'yxat holati sayt polling orqali oldinga o'tadi (step=CONSENT_GIVEN)
    sessions.delete(String(chatId)); // menyu guard'ini bo'shatamiz; sayt davom ettiradi
  });

  console.log('✅ Registration scene (self-signup) ulandi');
}
