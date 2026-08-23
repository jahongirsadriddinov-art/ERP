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
  // Majburiy obuna (kanal/guruh) — bot foydalanuvchi shu 3 kanalga obuna
  // bo'lmaguncha ishlamaydi (aniq talab). chatId — Telegram'ning ICHKI
  // raqamli chat ID'si (masalan -1001234567890), FAQAT bot o'sha kanal/
  // guruhga administrator sifatida qo'shilgach, `my_chat_member` orqali
  // avtomatik aniqlanadi (private invite-link kanallar uchun boshqa yo'l
  // yo'q — Bot API getChatMember uchun @username yoki raqamli ID kerak,
  // "t.me/+xxx" havolaning o'zi ishlamaydi). Bo'sh (undefined) bo'lsa —
  // o'sha kanal uchun tekshiruv o'tkazib yuboriladi (hali sozlanmagan
  // holatda hech kimni bloklab qo'ymaslik uchun xavfsiz standart).
  requiredChannels: Array<{ chatId?: string; url: string; title: string }>;
  // Bot admin sifatida qo'shilgan barcha kanal/guruhlar — avtomatik
  // to'planadi (my_chat_member), dasturchi shundan requiredChannels'ga
  // moslashtiradi (yoki nom bo'yicha avtomatik moslashtiriladi).
  discoveredChats: Array<{ chatId: string; title: string; type: string }>;
  // Obuna so'ralganda ko'rsatiladigan xabar matni — dasturchi tahrirlashi
  // mumkin (devMessageTexts bilan bir xil {text,entities} shakli, premium
  // emoji/formatlash saqlanishi uchun).
  subscribeGateMsg?: { text: string; entities?: any[] } | string;
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
  requiredChannels: { type: Schema.Types.Mixed, default: [] },
  discoveredChats: { type: Schema.Types.Mixed, default: [] },
  subscribeGateMsg: { type: Schema.Types.Mixed, default: undefined },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IAppSettings>('AppSettings', AppSettingsSchema);
