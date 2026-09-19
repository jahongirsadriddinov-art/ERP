import mongoose, { Schema, Document } from 'mongoose';

// Onlayn (avtomatik) to'lov tanlangan RO'YXATDAN O'TISH uchun — firma va
// uning egasi HALI YARATILMAYDI, faqat Roxiy webhook to'lovni tasdiqlagach
// (routes/payments.ts) yaratiladi. Sabab: avval firma/user DARHOL, to'lovdan
// OLDIN yaratilar edi ("pending" holatda) — agar foydalanuvchi to'lamasdan
// tashlab ketsa, bu yozuv ABADIY osilib qolardi VA uning telefon raqami
// (User.phone unique) boshqa hech qachon ro'yxatdan o'tish uchun ishlatib
// bo'lmas edi (register.ts "Bu raqam bilan firma mavjud" xatosi).
//
// MUHIM: parol shu yerda ALLAQACHON HASH qilingan holda saqlanadi (hech
// qachon ochiq matn emas) — bu yozuv to'lanmay TTL orqali o'chib ketsa ham
// xavfsizlik nuqtai nazaridan zarar yo'q.
export interface IPendingRegistration extends Document {
  webhookToken: string;
  phone: string;
  passwordHash: string;
  // Schema.Types.Mixed sifatida saqlanadi (haqiqiy validatsiya shart emas —
  // bu maydonlar register.ts'da ALLAQACHON tekshirilgan bo'lib keladi);
  // shu sabab TS'da ham bo'sh `any` — Company/User.create() chaqirilganda
  // qat'iy literal-union maydonlar (activityType, currency) bilan
  // to'qnashmasligi uchun.
  owner: any;
  company: any;
  logoUrl?: string;
  language?: 'uz' | 'uz-cyrl' | 'ru';
  branchId: string;
  telegramUserId?: string;
  telegramChatId?: string;
  registrationId?: string;
  planKey: string;
  amount: number;
  promoCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PendingRegistrationSchema: Schema = new Schema({
  webhookToken: { type: String, required: true, unique: true, index: true },
  phone: { type: String, required: true, index: true },
  passwordHash: { type: String, required: true },
  owner: { type: Schema.Types.Mixed, required: true },
  company: { type: Schema.Types.Mixed, required: true },
  logoUrl: { type: String },
  language: { type: String },
  branchId: { type: String, required: true },
  telegramUserId: { type: String },
  telegramChatId: { type: String },
  registrationId: { type: String },
  planKey: { type: String, required: true },
  amount: { type: Number, required: true },
  promoCode: { type: String },
}, { timestamps: true });

// To'lanmagan/tashlab ketilgan urinish 48 soatdan keyin avtomatik o'chadi —
// telefon raqami abadiy band bo'lib qolmasligi uchun (yuqoridagi izohga qarang).
PendingRegistrationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 48 * 60 * 60 });

export default mongoose.model<IPendingRegistration>('PendingRegistration', PendingRegistrationSchema);
