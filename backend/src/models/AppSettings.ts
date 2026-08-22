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
  // Admin (direktor/orinbosar) va ishchi menyulari uchun ham xuddi
  // shunday — dasturchi "⚙️ Tugmalarni sozlash"dan ULARNI HAM tahrirlaydi
  // (aniq talab: "boshqa userlarnikini ham taxrirlap bolsin orin bosar
  // direktor ishchi va boshlarnikini ham").
  adminButtonLabels: Record<string, string>;
  adminButtonOrder: string[];
  userButtonLabels: Record<string, string>;
  userButtonOrder: string[];
  // Sayt/bot yoqilganda-o'chirilganda va bot texnik ishlar rejimida
  // foydalanuvchiga ko'rsatiladigan xabarlar — dasturchi ularni ham o'zi
  // qo'lda tahrirlashi mumkin (masalan 'siteEnabledMsg', 'botMaintenanceMsg').
  // Har bir qiymat { text, entities } — entities Telegramning o'z
  // formatlash/PREMIUM EMOJI ma'lumoti (msg.entities), shu bilan birga
  // saqlanadi va qayta yuborilganda ISHLATILADI — shu sabab dasturchi
  // yuborgan premium emoji o'zgarmasdan yetib boradi. {time} bor matnlarda
  // haqiqiy vaqtga almashtiriladi (entity offsetlari ham moslashtiriladi).
  // Eski (faqat string) qiymatlar ham o'qishda qo'llab-quvvatlanadi.
  // Bo'sh/mavjud bo'lmagan kalit uchun standart (i18n/bot.ts'dagi) matn
  // ishlatiladi.
  devMessageTexts: Record<string, { text: string; entities?: any[] } | string>;
  updatedAt: Date;
}

const AppSettingsSchema = new Schema<IAppSettings>({
  key: { type: String, required: true, unique: true, default: 'global' },
  siteEnabled: { type: Boolean, default: true },
  botEnabled: { type: Boolean, default: true },
  devButtonLabels: { type: Schema.Types.Mixed, default: {} },
  devButtonOrder: { type: [String], default: [] },
  adminButtonLabels: { type: Schema.Types.Mixed, default: {} },
  adminButtonOrder: { type: [String], default: [] },
  userButtonLabels: { type: Schema.Types.Mixed, default: {} },
  userButtonOrder: { type: [String], default: [] },
  devMessageTexts: { type: Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IAppSettings>('AppSettings', AppSettingsSchema);
