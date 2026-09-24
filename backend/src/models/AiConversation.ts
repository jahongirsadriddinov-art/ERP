import mongoose, { Schema, Document } from 'mongoose';

// AI yordamchi suhbatlari tarixi — "yangi suhbat boshlash" bosilganda eskisi
// yo'qolmasin, keyin qaytib ko'rish/davom ettirish mumkin bo'lsin. Suhbat
// FAQAT o'z egasiga ko'rinadi (userId bo'yicha filtr routes/ai.ts'da).
export interface IAiConversation extends Document {
  userId: string;
  companyId?: string;
  title: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  createdAt: Date;
  updatedAt: Date;
}

const AiConversationSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  companyId: { type: String, index: true },
  title: { type: String, default: '' },
  messages: {
    type: [new Schema({ role: { type: String, enum: ['user', 'assistant'], required: true }, content: { type: String, default: '' } }, { _id: false })],
    default: [],
  },
}, { timestamps: true });

AiConversationSchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.model<IAiConversation>('AiConversation', AiConversationSchema);
