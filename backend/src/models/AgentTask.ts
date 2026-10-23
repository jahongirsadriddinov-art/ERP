import mongoose, { Schema, Document } from 'mongoose';

// AI ofis: agentga berilgan buyruq (owner 2026-10-22). Holat: queued (navbatda / sozlanmagan) → [review] → running → done | failed;
// cancelled — dasturchi bekor qildi. code agentlari — GitHub Actions (repository_dispatch) qayta qo'ng'irog'i
// (/api/ai-voice/agent-callback) bilan yangilanadi; content agentlari — backend'da Gemini natijasi (items).
export type AgentTaskStatus = 'queued' | 'review' | 'running' | 'done' | 'failed' | 'cancelled';
/** review — "Yangi funksiya" agenti spetsifikatsiyani tayyorladi, egasi tasdig'ini kutadi. */
export const AGENT_TASK_ACTIVE: AgentTaskStatus[] = ['queued', 'review', 'running'];

/** SMM: qurilmada (brauzer IndexedDB) saqlangan media — serverda faqat metama'lumot (owner 2026-10-23). */
export interface SmmMediaMeta { id: string; kind: 'image' | 'video'; mime?: string; w?: number; h?: number; size?: number; source?: string; at?: Date }
export interface SmmPublishState { status: 'publishing' | 'published' | 'failed'; at?: Date; kind?: string; target?: string; mediaId?: string; messageId?: number; url?: string; error?: string; detail?: string }
export interface AgentTaskItem {
  title: string; text: string; hashtags?: string[];
  // ── SMM (ixtiyoriy) ──
  format?: 'post' | 'carousel' | 'reel' | 'story'; lang?: string; topic?: string; category?: string; imagePrompt?: string;
  scenes?: { title: string; text: string }[]; media?: SmmMediaMeta[];
  approval?: 'none' | 'pending' | 'approved' | 'rejected';
  tg?: SmmPublishState; ig?: SmmPublishState;
}
export interface AgentTaskLink { label: string; url: string }

export interface IAgentTask extends Document {
  agentKey: string;
  agentKind: 'code' | 'content';
  text: string;
  status: AgentTaskStatus;
  summary?: string;
  spec?: string;
  /** Boshliq (manager): maqsad bo'lingan vazifalar; tasdiqdan keyin har biri alohida AgentTask (taskId). */
  plan: { agentKey: string; text: string; taskId?: string }[];
  parentId?: string;
  /** Boshliq yaratgan yangi agent kaliti. */
  spawnedKey?: string;
  items: AgentTaskItem[];
  links: AgentTaskLink[];
  log: { at: Date; text: string }[];
  error?: string;
  createdBy?: string;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AgentTaskSchema = new Schema<IAgentTask>({
  agentKey: { type: String, required: true, maxlength: 40 },
  agentKind: { type: String, enum: ['code', 'content'], required: true },
  text: { type: String, required: true, maxlength: 4000 },
  status: { type: String, enum: ['queued', 'review', 'running', 'done', 'failed', 'cancelled'], default: 'queued' },
  spec: { type: String, maxlength: 6000 },
  plan: {
    type: [new Schema({ agentKey: { type: String, maxlength: 40 }, text: { type: String, maxlength: 2000 }, taskId: String }, { _id: false })],
    default: [],
  },
  parentId: { type: String },
  spawnedKey: { type: String, maxlength: 40 },
  summary: { type: String, maxlength: 4000 },
  items: {
    type: [new Schema({
      title: { type: String, maxlength: 200, default: '' },
      text: { type: String, maxlength: 4000, default: '' },
      hashtags: { type: [String], default: undefined },
      format: { type: String, enum: ['post', 'carousel', 'reel', 'story'] },
      lang: { type: String, maxlength: 8 },
      topic: { type: String, maxlength: 300 },
      category: { type: String, maxlength: 30 },
      imagePrompt: { type: String, maxlength: 1500 },
      scenes: { type: [new Schema({ title: { type: String, maxlength: 120 }, text: { type: String, maxlength: 400 } }, { _id: false })], default: undefined },
      media: {
        type: [new Schema({
          id: { type: String, maxlength: 40 }, kind: { type: String, enum: ['image', 'video'] }, mime: { type: String, maxlength: 60 },
          w: Number, h: Number, size: Number, source: { type: String, maxlength: 20 }, at: Date,
        }, { _id: false })],
        default: undefined,
      },
      approval: { type: String, enum: ['none', 'pending', 'approved', 'rejected'] },
      tg: { type: Schema.Types.Mixed },
      ig: { type: Schema.Types.Mixed },
    }, { _id: false })],
    default: [],
  },
  links: { type: [new Schema({ label: { type: String, maxlength: 60 }, url: { type: String, maxlength: 500 } }, { _id: false })], default: [] },
  log: { type: [new Schema({ at: { type: Date, default: Date.now }, text: { type: String, maxlength: 500 } }, { _id: false })], default: [] },
  error: { type: String, maxlength: 300 },
  createdBy: String,
  startedAt: Date,
  finishedAt: Date,
}, { timestamps: true });

AgentTaskSchema.index({ agentKey: 1, createdAt: -1 });
AgentTaskSchema.index({ status: 1, updatedAt: 1 });
AgentTaskSchema.index({ createdAt: -1 });
AgentTaskSchema.index({ 'items.ig.mediaId': 1 }, { sparse: true });
AgentTaskSchema.index({ parentId: 1 }, { partialFilterExpression: { parentId: { $type: 'string' } } });

export default mongoose.model<IAgentTask>('AgentTask', AgentTaskSchema);
