import mongoose, { Schema, Document } from 'mongoose';

// Bitta "singleton" yozuv — dasturchi botdan boshqaradigan global
// yoqish/o'chirish tugmalari (texnik ishlar rejimi). Firma darajasida
// EMAS — butun platforma darajasida (barcha firmalar uchun bir xil).
export interface IAppSettings extends Document {
  key: string; // doim 'global'
  siteEnabled: boolean;
  botEnabled: boolean;
  updatedAt: Date;
}

const AppSettingsSchema = new Schema<IAppSettings>({
  key: { type: String, required: true, unique: true, default: 'global' },
  siteEnabled: { type: Boolean, default: true },
  botEnabled: { type: Boolean, default: true },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IAppSettings>('AppSettings', AppSettingsSchema);
