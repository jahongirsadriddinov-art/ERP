import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  phone: string;
  firstName: string;
  lastName?: string;
  role: 'direktor' | 'orinbosar' | 'ishchi' | 'prorab' | 'brigadir' | 'dasturchi';
  telegramChatId?: string;
  telegramVerificationCode?: string;
  telegramVerificationCodeExpires?: Date;
  brigade?: string;
  projectIds?: string[];
  // v1.2 multi-tenant qo'shimchalari (hammasi nullable — eski yozuvlarni buzmaydi)
  companyId?: string;      // qaysi firmaga tegishli (Company._id string ko'rinishida)
  isOwner?: boolean;       // firma egasimi (self-signup orqali ochgan)
  telegramUserId?: string; // Telegram foydalanuvchi ID (chatId dan alohida)
  phoneVerifiedAt?: Date;  // telefon tasdiqlangan vaqti
  passwordHash?: string;   // kelajakdagi parol-login uchun (hozircha login telegram-kod bilan)
  middleName?: string;     // otasining ismi (ixtiyoriy)
  email?: string;          // ixtiyoriy
  position?: string;       // lavozim (default: Direktor)
}

const UserSchema: Schema = new Schema({
  phone: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String },
  role: { type: String, enum: ['direktor', 'orinbosar', 'ishchi', 'prorab', 'brigadir', 'dasturchi'], required: true },
  telegramChatId: { type: String },
  telegramVerificationCode: { type: String },
  telegramVerificationCodeExpires: { type: Date },
  brigade: { type: String },
  projectIds: [{ type: String }],
  // v1.2 multi-tenant (nullable)
  companyId: { type: String, index: true },
  isOwner: { type: Boolean, default: false },
  telegramUserId: { type: String },
  phoneVerifiedAt: { type: Date },
  passwordHash: { type: String },
  middleName: { type: String },
  email: { type: String },
  position: { type: String }
}, { timestamps: true });

export default mongoose.model<IUser>('User', UserSchema);
