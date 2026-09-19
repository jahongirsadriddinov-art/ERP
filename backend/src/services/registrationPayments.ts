// RO'YXATDAN O'TISH paytida "onlayn (avtomatik)" to'lov tanlanganda
// chaqiriladi (routes/register.ts). services/subscriptionPayments.ts'dan
// FARQI: bu yerda hali FIRMA HAM, FOYDALANUVCHI HAM yo'q — ular Roxiy
// webhook to'lovni tasdiqlagach (routes/payments.ts) yaratiladi. Shu
// sabab bu yerda Subscription/Company/User o'rniga PendingRegistration
// yoziladi (models/PendingRegistration.ts'dagi izohga qarang).
import { randomBytes } from 'crypto';
import PendingRegistration from '../models/PendingRegistration';
import Payment from '../models/Payment';
import { createRoxiyOrder, RoxiyOrder } from './roxiy';
import { getPlanInfo } from '../config/plans';
import { checkPromoCode } from './promoCodes';
import { generateBranchId } from '../models/Counter';

export type CreateRegistrationPaymentResult =
  | { ok: true; order: RoxiyOrder; amount: number; branchId: string }
  | { ok: false; error: string };

export interface RegistrationPaymentInput {
  phone: string;
  passwordHash: string;
  owner: { firstName: string; lastName: string; middleName?: string; email?: string; position?: string };
  company: {
    name: string; legalName?: string; inn?: string; address?: string; region?: string;
    activityType?: string; employeeRange?: string; currency?: string;
  };
  logoUrl?: string;
  language?: 'uz' | 'uz-cyrl' | 'ru';
  telegramUserId?: string;
  telegramChatId?: string;
  registrationId?: string;
  planKey: string;
  promoCode?: string;
}

export async function createRegistrationPaymentOrder(input: RegistrationPaymentInput): Promise<CreateRegistrationPaymentResult> {
  const planInfo = getPlanInfo(input.planKey);
  if (!planInfo || planInfo.amount <= 0) {
    return { ok: false, error: "Noto'g'ri yoki bepul tarif — to'lov shart emas" };
  }

  let amount = planInfo.amount;
  let appliedPromo: string | undefined;
  if (input.promoCode) {
    const promoResult = await checkPromoCode(input.promoCode, input.planKey, planInfo.amount);
    if (!promoResult.ok) return { ok: false, error: promoResult.error || 'Promokod yaroqsiz' };
    amount = promoResult.finalAmount!;
    appliedPromo = input.promoCode.trim().toUpperCase();
  }

  // Promokod summani 0 (yoki manfiyga yaqin) qilib qo'ysa — bu endi "to'lov"
  // emas, "bepul" holat, Roxiy'ga 0 so'mlik buyurtma yuborib bo'lmaydi.
  // Chaqiruvchi (register.ts) bu holatni bepul yo'l bilan (admin tasdig'ini
  // kutib) ishlashi kerak — himoya sifatida shu yerda ham rad etiladi.
  if (amount <= 0) {
    return { ok: false, error: "Promokod bilan summa 0 bo'lib qoldi — bepul yo'l orqali davom eting" };
  }

  // Shu telefon uchun avvalgi to'lanmagan urinish(lar) bo'lsa — tozalaymiz
  // (ular baribir TTL orqali o'chib ketardi, lekin darhol tozalash aniqroq:
  // foydalanuvchi bir necha marta "onlayn to'lov" tugmasini bossa, faqat
  // OXIRGI (haqiqiy to'lanadigan) buyurtma qoladi).
  await PendingRegistration.deleteMany({ phone: input.phone }).catch(() => {});

  const branchId = await generateBranchId(new Date().getFullYear());
  const webhookToken = randomBytes(24).toString('hex');
  const note = `QurilishERP ro'yxat: ${planInfo.label} — ${input.phone}`;
  const order = await createRoxiyOrder(amount, note, webhookToken);

  const pending = await PendingRegistration.create({
    webhookToken,
    phone: input.phone,
    passwordHash: input.passwordHash,
    owner: input.owner,
    company: input.company,
    logoUrl: input.logoUrl,
    language: input.language,
    branchId,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    registrationId: input.registrationId,
    planKey: input.planKey,
    amount,
    promoCode: appliedPromo,
  });

  await Payment.create({
    pendingRegistrationId: String(pending._id),
    amount,
    currency: 'UZS',
    status: 'pending',
    provider: 'roxiy',
    externalId: order.order_hash,
    webhookToken,
    plan: input.planKey,
    days: planInfo.days,
    promoCode: appliedPromo,
  });

  return { ok: true, order, amount, branchId };
}
