// Bot qo'shilgan guruh/kanal (owner 2026-10-26: "har bir firma uchun guruh ochib botni admin qilaman,
// umumiy guruh va kanallarga ham — firmaga moslashganlarga alohida buyruqlar bo'lsin").
// companyId bor — firma guruhi (firma buyruqlari ishlaydi); yo'q — umumiy guruh/kanal (hamma uchun ochiq
// buyruqlar). Bitta guruh faqat bitta firmaga bog'lanadi.
import mongoose, { Schema, Document } from 'mongoose';

export interface BotChatLinkDoc extends Document {
  chatId: string;
  type: 'group' | 'supergroup' | 'channel';
  title: string;
  companyId?: string | null;
  companyName?: string | null;
  linkedByUserId?: string | null;
  linkedByName?: string | null;
  linkedAt?: Date | null;
}

const BotChatLinkSchema = new Schema<BotChatLinkDoc>({
  chatId: { type: String, required: true, unique: true, index: true },
  type: { type: String, enum: ['group', 'supergroup', 'channel'], required: true },
  title: { type: String, default: '' },
  companyId: { type: String, default: null, index: true },
  companyName: { type: String, default: null },
  linkedByUserId: { type: String, default: null },
  linkedByName: { type: String, default: null },
  linkedAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model<BotChatLinkDoc>('BotChatLink', BotChatLinkSchema);
