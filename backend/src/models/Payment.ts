import mongoose, { Schema, Document } from 'mongoose';

// Roxiy (Click/Payme/Paynet) va kelajakdagi boshqa provayderlar uchun to'lov
// yozuvlari — routes/subscriptions.ts (/pay) yaratadi, routes/payments.ts
// (webhook) 'paid'ga o'tkazadi va shu yozuvdan Subscription'ni yangilaydi.
export interface IPayment extends Document {
  companyId?: string;    // RO'YXATDAN O'TISH to'lovlarida hali firma yo'q —
                          // o'rniga pendingRegistrationId to'ldiriladi.
  subscriptionId?: string;
  pendingRegistrationId?: string; // PendingRegistration._id — webhook
                          // to'lovni 'paid'ga o'tkazgach shundan firma/user
                          // yaratadi (routes/payments.ts).
  promoCode?: string;     // qo'llangan promokod (bo'lsa) — webhook shu
                          // orqali PromoCode.usedCount'ni oshiradi.
  amount: number;
  currency: 'UZS' | 'USD';
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  provider?: string;    // masalan: 'payme', 'click', 'stripe', 'roxiy'
  externalId?: string;  // provayderdagi to'lov ID (Roxiy uchun — order_hash)
  webhookToken?: string; // HAR BIR TO'LOV uchun ALOHIDA, tasodifiy token —
                          // webhookning yagona autentifikatsiyasi (services/roxiy.ts
                          // izohiga qarang: nega BITTA umumiy token EMAS).
  plan?: string;        // shu TO'LOVGA tegishli tarif kaliti (PLAN_CONFIG)
  days?: number;        // shu TO'LOVGA tegishli kunlar soni — to'lov yaratilgan
                         // paytdagi PLAN_CONFIG'dan OLIB QO'YILGAN nusxa. Buni
                         // (sub.selectedPlan yoki webhook payti PLAN_CONFIG'dan
                         // qayta qidirish o'rniga) saqlashning sababi ikkita:
                         // (1) to'lov 'pending' turgan payt boshqa /pay so'rovi
                         // sub.selectedPlan'ni almashtirib yuborishi mumkin,
                         // (2) PLAN_CONFIG'dagi tariflar keyinchalik o'zgarishi/
                         // o'chirilishi mumkin — ikkalasida ham to'langan summaga
                         // mos KUNLAR notekshirilgan holda o'zgarib qolmasligi kerak.
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema: Schema = new Schema({
  companyId: { type: String, index: true },
  subscriptionId: { type: String, index: true },
  pendingRegistrationId: { type: String, index: true },
  promoCode: { type: String },
  amount: { type: Number, required: true },
  currency: { type: String, enum: ['UZS', 'USD'], default: 'UZS' },
  status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  provider: { type: String },
  externalId: { type: String },
  webhookToken: { type: String, index: true, unique: true, sparse: true },
  plan: { type: String },
  days: { type: Number }
}, { timestamps: true });

export default mongoose.model<IPayment>('Payment', PaymentSchema);
