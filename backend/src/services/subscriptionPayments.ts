// Roxiy orqali obuna to'lovi buyurtmasini yaratish — sayt (routes/
// subscriptions.ts POST /pay) va bot (services/bot.ts, "💳 To'lash"
// tugmalari) IKKALASI HAM shu bitta funksiyani chaqiradi, shu sabab
// tekshiruvlar (rad etilgan obuna, noto'g'ri tarif) va Payment yozuvi
// mantig'i faqat BIR JOYDA yashaydi.
import { randomBytes } from 'crypto';
import Subscription from '../models/Subscription';
import Payment from '../models/Payment';
import { createRoxiyOrder, RoxiyOrder } from './roxiy';
import { getPlanInfo } from '../config/plans';

export type CreateSubscriptionPaymentResult =
  | { ok: true; order: RoxiyOrder }
  | { ok: false; error: string; httpStatus: number };

export async function createSubscriptionPaymentOrder(
  companyId: string,
  userId: string | undefined,
  planKey: string
): Promise<CreateSubscriptionPaymentResult> {
  const planInfo = getPlanInfo(planKey);
  if (!planInfo || planInfo.amount <= 0) {
    return { ok: false, error: "Noto'g'ri yoki bepul tarif — to'lov shart emas", httpStatus: 400 };
  }

  // Atomik topish-yoki-yaratish — ikkita bir vaqtdagi so'rov bitta firma
  // uchun ikkita alohida (pending) Subscription yozuvini yaratib
  // qo'ymasligi uchun. TO'LIQ kafolat EMAS (companyId'da unique index
  // yo'q), lekin oldingi (umuman himoyasiz) holatdan ancha yaxshi.
  const sub = await Subscription.findOneAndUpdate(
    { companyId },
    { $setOnInsert: { companyId, userId, status: 'pending' } },
    { upsert: true, new: true, sort: { createdAt: -1 } }
  );

  // Dasturchi rad etgan obunani foydalanuvchi o'zi to'lab, tekshiruvsiz
  // qayta faollashtira olmasin.
  if (sub.status === 'rejected') {
    return { ok: false, error: "Obunangiz rad etilgan — dasturchi bilan bog'laning", httpStatus: 403 };
  }

  // MUHIM: sub.selectedPlan bu yerda YOZILMAYDI — qancha kun/qaysi tarif
  // berilishi FAQAT Payment yozuvidan (plan/days) olinadi (webhook
  // to'lovni tasdiqlagach shu bilan sinxronlanadi) — to'lov 'pending'
  // turgan paytda boshqa so'rov tarifni almashtirib yuborishi mumkin edi.
  // Har bir to'lov uchun ALOHIDA webhook tokeni — services/roxiy.ts'dagi
  // izohga qarang (nega bitta umumiy maxfiy kalit emas).
  const webhookToken = randomBytes(24).toString('hex');
  const note = `QurilishERP ${planInfo.label} — ${companyId}`;
  const order = await createRoxiyOrder(planInfo.amount, note, webhookToken);

  await Payment.create({
    companyId,
    subscriptionId: String(sub._id),
    amount: planInfo.amount,
    currency: 'UZS',
    status: 'pending',
    provider: 'roxiy',
    externalId: order.order_hash,
    webhookToken,
    plan: planKey,
    days: planInfo.days,
  });

  return { ok: true, order };
}
