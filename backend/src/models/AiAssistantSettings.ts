import mongoose, { Schema, Document } from 'mongoose';

// AI ovozli yordamchi — firma sozlamalari (bitta firma = bitta hujjat).
// Murakkab bo'limlar Mixed sifatida saqlanadi; to'liq shakl va standart
// qiymatlar aiVoice/settings.ts'da (mergeDefaults) — o'qishda doim birlashtiriladi.
// timezone v1'da QULFLANGAN: 'Asia/Tashkent' (Attendance.date bilan kelishuv, review C7).
export interface IAiAssistantSettings extends Document {
  companyId: string;
  enabled: boolean;
  language: 'uz' | 'ru' | 'auto';
  voiceName: string;
  timezone: 'Asia/Tashkent';
  disclosureText?: string;
  persona?: any;
  avatar?: any;
  attendance: any;
  calls: any;
  fallbackOrder: string[];
  reminders: any;
  tools: any;
  provider: any;
  brain: any;            // matn miyasi: {provider:'gemini'|'claude', fallback:'openrouter'|'none', effort}
  limits: any;
  privacy: any;
  version: number;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AiAssistantSettingsSchema = new Schema<IAiAssistantSettings>({
  companyId: { type: String, required: true },
  enabled: { type: Boolean, default: false },
  language: { type: String, enum: ['uz', 'ru', 'auto'], default: 'uz' },
  voiceName: { type: String, default: 'Kore', maxlength: 40 },
  timezone: { type: String, enum: ['Asia/Tashkent'], default: 'Asia/Tashkent' },
  disclosureText: { type: String, maxlength: 300 },
  persona: { type: Schema.Types.Mixed },
  avatar: { type: Schema.Types.Mixed },
  attendance: { type: Schema.Types.Mixed, default: () => ({}) },
  calls: { type: Schema.Types.Mixed, default: () => ({}) },
  fallbackOrder: { type: [String], default: undefined },
  reminders: { type: Schema.Types.Mixed, default: () => ({}) },
  tools: { type: Schema.Types.Mixed, default: () => ({}) },
  provider: { type: Schema.Types.Mixed, default: () => ({}) },
  brain: { type: Schema.Types.Mixed, default: () => ({}) },
  limits: { type: Schema.Types.Mixed, default: () => ({}) },
  privacy: { type: Schema.Types.Mixed, default: () => ({}) },
  version: { type: Number, default: 0 },
  updatedBy: { type: String },
}, { timestamps: true, minimize: false });

AiAssistantSettingsSchema.index({ companyId: 1 }, { unique: true });

export default mongoose.model<IAiAssistantSettings>('AiAssistantSettings', AiAssistantSettingsSchema);
