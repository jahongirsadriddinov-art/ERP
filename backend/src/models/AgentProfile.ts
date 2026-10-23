import mongoose, { Schema, Document } from 'mongoose';

// AI ofis (owner 2026-10-22): agentlar ro'yxati — har biri o'z stoli, rangi va rol tavsifi bilan. Standart ro'yxat
// (Backend, Frontend, ..., SMM, Marketing + rollar yordamchilari) birinchi so'rovda yaratiladi (agents/defaults.ts);
// dasturchi nomini/tavsifini o'zgartiradi, yangisini qo'shadi. AI Telegram akkauntlari — AiTgAccount'da (bu yerda emas).
//  • code    — GitHub Actions orqali kod yozadi (PR ochadi, main'ga hech qachon push qilmaydi);
//  • content — backend'da Gemini bilan matn tayyorlaydi (postlar, rejalar);
//  • role    — firma rollari uchun AI yordamchi (faqat ofisda ko'rinadi, buyruq olmaydi);
//  • tg      — zaxira (AI Telegram akkaunti uchun).
export type AgentKind = 'code' | 'content' | 'tg' | 'role';
/** Ofis zonasi (jamoa). */
export type AgentTeam = 'lead' | 'platform' | 'apps' | 'ai' | 'ops' | 'growth' | 'assistants';
export const AGENT_TEAMS: AgentTeam[] = ['lead', 'platform', 'apps', 'ai', 'ops', 'growth', 'assistants'];

export interface IAgentProfile extends Document {
  key: string;
  name: string;
  kind: AgentKind;
  team: AgentTeam;
  description: string;
  systemPrompt: string;
  color: string;
  enabled: boolean;
  order: number;
  builtIn: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AgentProfileSchema = new Schema<IAgentProfile>({
  key: { type: String, required: true, maxlength: 40 },
  name: { type: String, required: true, maxlength: 40 },
  kind: { type: String, enum: ['code', 'content', 'tg', 'role'], required: true },
  team: { type: String, enum: AGENT_TEAMS, default: 'platform' },
  description: { type: String, default: '', maxlength: 300 },
  systemPrompt: { type: String, default: '', maxlength: 4000 },
  color: { type: String, default: '#6366f1', maxlength: 9 },
  enabled: { type: Boolean, default: true },
  order: { type: Number, default: 100 },
  builtIn: { type: Boolean, default: false },
  createdBy: String,
}, { timestamps: true });

AgentProfileSchema.index({ key: 1 }, { unique: true });

export default mongoose.model<IAgentProfile>('AgentProfile', AgentProfileSchema);
