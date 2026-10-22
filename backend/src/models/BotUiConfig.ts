import mongoose, { Schema, Document } from 'mongoose';

// Bot dizayni (owner 2026-10-22): dasturchi panelidan HAR BIR bot tugmasining matni (uz/ru), premium
// (custom) emoji ikonkasi va rangi (style), xabarlardagi oddiy emoji → premium emoji almashtirish,
// buyruqlar tavsifi va qo'shilgan emoji paketlari. BITTA yozuv (key: 'global'). Yozuv bo'lmasa —
// bot hozirgi (i18n) matnlar bilan o'zgarishsiz ishlaydi.
export type BotButtonStyle = 'primary' | 'success' | 'danger';

export interface BotButtonOverride {
  text?: { uz?: string; ru?: string };
  iconCustomEmojiId?: string;
  style?: BotButtonStyle;
}

export interface BotEmojiSticker {
  id: string;           // custom_emoji_id
  emoji: string;        // asosiy (oddiy) emoji
  fileId?: string;
  thumbFileId?: string;
  animated?: boolean;
  video?: boolean;
}

export interface BotEmojiPack {
  name: string;
  title: string;
  stickers: BotEmojiSticker[];
  loadedAt: Date;
}

export interface BotUiDraft {
  source: 'ai' | 'keywords';
  createdAt: Date;
  buttons: Record<string, { iconCustomEmojiId?: string; style?: BotButtonStyle }>;
  messageEmoji: Record<string, string>;
  note?: string;
}

export interface IBotUiConfig extends Document {
  key: string;
  buttons: Record<string, BotButtonOverride>;
  /** oddiy emoji → custom_emoji_id (xabar matnlarida almashtiriladi) */
  messageEmoji: { emoji: string; id: string }[];
  messageEmojiEnabled: boolean;
  /** tugmaga ikonka qo'yilganda matn boshidagi oddiy emoji olib tashlansin (ikki marta ko'rinmasin) */
  stripEmojiWhenIcon: boolean;
  commands: { command: string; enabled: boolean; description: { uz?: string; ru?: string } }[];
  packs: BotEmojiPack[];
  draft: BotUiDraft | null;
  updatedBy?: string;
  updatedAt?: Date;
}

const StickerSchema = new Schema<BotEmojiSticker>({
  id: { type: String, required: true }, emoji: { type: String, default: '' }, fileId: String, thumbFileId: String,
  animated: Boolean, video: Boolean,
}, { _id: false });

const BotUiConfigSchema = new Schema<IBotUiConfig>({
  key: { type: String, required: true, unique: true, default: 'global' },
  buttons: { type: Schema.Types.Mixed, default: {} },
  messageEmoji: { type: [{ emoji: String, id: String, _id: false }], default: [] },
  messageEmojiEnabled: { type: Boolean, default: true },
  stripEmojiWhenIcon: { type: Boolean, default: true },
  commands: { type: [{ command: String, enabled: { type: Boolean, default: true }, description: { uz: String, ru: String }, _id: false }], default: [] },
  packs: { type: [{ name: String, title: String, stickers: [StickerSchema], loadedAt: Date, _id: false }], default: [] },
  draft: { type: Schema.Types.Mixed, default: null },
  updatedBy: String,
}, { timestamps: true, minimize: false });

export default mongoose.models.BotUiConfig as mongoose.Model<IBotUiConfig> || mongoose.model<IBotUiConfig>('BotUiConfig', BotUiConfigSchema);
