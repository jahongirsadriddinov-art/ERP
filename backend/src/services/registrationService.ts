import Registration, { IRegistration } from '../models/Registration';
import { generateToken, hashToken } from '../utils/tokens';

// v1.2 ro'yxatdan o'tish flow'ining holat o'tishlari.
// Route (routes/register.ts) va bot scene (services/registrationScene.ts) ikkalasi
// ham shu servisdan foydalanadi — eski bot handlerlariga tegilmaydi.

const TTL_MS = 15 * 60 * 1000; // 15 daqiqa

export function newExpiry(): Date {
  return new Date(Date.now() + TTL_MS);
}

// Xom token bo'yicha faol (muddati o'tmagan, tugallanmagan) sessiyani topadi.
export async function findActiveByRawToken(rawToken: string): Promise<IRegistration | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const reg = await Registration.findOne({ otpTokenHash: hashToken(rawToken.trim()) });
  if (!reg) return null;
  if (reg.step === 'COMPLETED' || reg.step === 'EXPIRED') return null;
  if (reg.expiresAt.getTime() < Date.now()) {
    reg.step = 'EXPIRED';
    await reg.save();
    return null;
  }
  return reg;
}

// Yangi ro'yxatdan o'tish sessiyasi yaratadi. Xom tokenni qaytaradi (deep-link uchun).
export async function createRegistration(opts: {
  phone: string;
  ip?: string;
  userAgent?: string;
  consents?: any;
}): Promise<{ reg: IRegistration; rawToken: string }> {
  // Shu telefon uchun eski faol sessiyalarni bekor qilamiz (bittadan ortiq bo'lmasin).
  await Registration.updateMany(
    { phone: opts.phone, step: { $nin: ['COMPLETED', 'EXPIRED'] } },
    { $set: { step: 'EXPIRED' } }
  );

  const rawToken = generateToken();
  const reg = await Registration.create({
    phone: opts.phone,
    otpTokenHash: hashToken(rawToken),
    step: 'PHONE_ENTERED',
    consents: opts.consents || {},
    phoneAttempts: 0,
    ip: opts.ip,
    userAgent: opts.userAgent,
    expiresAt: newExpiry(),
  });
  return { reg, rawToken };
}

// Bot /start <token> bosdi.
export async function markBotStarted(reg: IRegistration, telegramUserId?: string, telegramUsername?: string) {
  if (reg.step === 'PHONE_ENTERED') reg.step = 'BOT_STARTED';
  if (telegramUserId) reg.telegramUserId = telegramUserId;
  if (telegramUsername) reg.telegramUsername = telegramUsername;
  await reg.save();
  return reg;
}

// Bot: kelgan contact saytdagi raqamga mos keldi.
export async function confirmPhone(reg: IRegistration, telegramUserId: string, telegramChatId: string) {
  reg.step = 'PHONE_CONFIRMED';
  reg.telegramUserId = telegramUserId;
  reg.telegramChatId = telegramChatId;
  await reg.save();
  return reg;
}

// Bot: roziliklar berildi → CONSENT_GIVEN. Sayt polling orqali oldinga o'tadi.
export async function giveConsent(reg: IRegistration, consents: any) {
  reg.consents = { ...(reg.consents || {}), ...consents, consentGivenAt: new Date().toISOString() };
  reg.step = 'CONSENT_GIVEN';
  await reg.save();
  return reg;
}

// Bot: bekor qilindi.
export async function cancelRegistration(reg: IRegistration) {
  reg.step = 'EXPIRED';
  await reg.save();
  return reg;
}
