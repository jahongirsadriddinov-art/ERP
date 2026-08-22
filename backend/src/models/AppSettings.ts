import mongoose, { Schema, Document } from 'mongoose';

// Bitta "singleton" yozuv — dasturchi botdan boshqaradigan global
// yoqish/o'chirish tugmalari (texnik ishlar rejimi). Firma darajasida
// EMAS — butun platforma darajasida (barcha firmalar uchun bir xil).
export interface IAppSettings extends Document {
  key: string; // doim 'global'
  siteEnabled: boolean;
  botEnabled: boolean;
  // Dasturchi bot-menyusidagi tugma matnlarini o'zi o'zgartirishi uchun —
  // { 'kb_broadcast': '📣 Elon yuborish', ... }. Bo'sh/mavjud bo'lmagan
  // kalit uchun standart (i18n/bot.ts'dagi) matn ishlatiladi.
  devButtonLabels: Record<string, string>;
  // Dasturchi menyusidagi tugmalar tartibi (atom kalitlar ro'yxati —
  // bot.ts'dagi DEFAULT_DEV_ORDER bilan bir xil kalitlar). Bo'sh bo'lsa —
  // standart (chiroyli, juft qatorli) joylashuv ishlatiladi.
  devButtonOrder: string[];
  // Sayt/bot yoqilganda-o'chirilganda va bot texnik ishlar rejimida
  // foydalanuvchiga ko'rsatiladigan xabarlar — dasturchi ularni ham o'zi
  // qo'lda tahrirlashi mumkin (masalan 'siteEnabledMsg', 'botMaintenanceMsg').
  // {time} bor matnlarda haqiqiy vaqtga almashtiriladi. Bo'sh/mavjud
  // bo'lmagan kalit uchun standart (i18n/bot.ts'dagi) matn ishlatiladi.
  devMessageTexts: Record<string, string>;
  updatedAt: Date;
}

const AppSettingsSchema = new Schema<IAppSettings>({
  key: { type: String, required: true, unique: true, default: 'global' },
  siteEnabled: { type: Boolean, default: true },
  botEnabled: { type: Boolean, default: true },
  devButtonLabels: { type: Schema.Types.Mixed, default: {} },
  devButtonOrder: { type: [String], default: [] },
  devMessageTexts: { type: Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IAppSettings>('AppSettings', AppSettingsSchema);
