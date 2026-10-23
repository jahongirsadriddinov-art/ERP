import AgentProfile from '../models/AgentProfile';
import AgentTask from '../models/AgentTask';
import AiCallSession from '../models/AiCallSession';
import AiConversation from '../models/AiConversation';
import AiTgAccount from '../models/AiTgAccount';
import User from '../models/User';
import { ensureDefaults, expireStale, onAgentChange } from './agents/service';

// Dasturchi paneli → AI → "AI ofis" (owner 2026-10-22): agentlar ofisi (3D) holati. Agentlar — AgentProfile ro'yxati
// (code/content/role) + AI Telegram akkauntlari (AiTgAccount). Faollik arzon hisoblanadi: faol qo'ng'iroq sessiyalari
// (AiCallSession.isActive), oxirgi 2 daqiqada yangilangan matnli suhbatlar (AiConversation), faol/yaqinda tugagan
// buyruqlar (AgentTask) — 5 s kesh; buyruq holati o'zgarsa kesh darhol tozalanadi.

export type OfficeAgentKind = 'tg' | 'role' | 'code' | 'content';
export type OfficeActivity = 'call' | 'chat' | 'task' | 'review' | 'idle';
export interface OfficeAgent {
  id: string;
  name: string;
  kind: OfficeAgentKind;
  team: string;
  color: string;
  role?: string;
  busy: boolean;
  activity: OfficeActivity;
  since?: string;
  status?: string;
  task?: { id: string; status: string; text: string; finishedAt?: string };
}
export interface OfficeSnapshot { agents: OfficeAgent[]; generatedAt: string }

export const CHAT_WINDOW_MS = 2 * 60_000;
/** Tugagan buyruq shu muddat ofisda ko'rinadi (bayram / qizil chiroq). */
export const RECENT_FINISH_MS = 90_000;
const CACHE_MS = 5_000;
const MAX_ROWS = 500;

let cache: { at: number; data: OfficeSnapshot } | null = null;
let inflight: Promise<OfficeSnapshot> | null = null;
onAgentChange(() => { cache = null; });

/** Faqat testlar uchun. */
export function __resetOfficeCacheForTests(): void { cache = null; inflight = null; }

type Mark = { activity: 'call' | 'chat'; since: number };
// Qo'ng'iroq suhbatdan ustun; bir xil faollikda — eng erta boshlangani
const mark = (m: Map<string, Mark>, key: string, activity: 'call' | 'chat', since: number) => {
  const cur = m.get(key);
  if (!cur || (activity === 'call' && cur.activity === 'chat') || (activity === cur.activity && since < cur.since)) m.set(key, { activity, since });
};
const ts = (...d: unknown[]): number => {
  for (const v of d) { const n = v ? new Date(v as any).getTime() : NaN; if (Number.isFinite(n)) return n; }
  return Date.now();
};
const TASK_RANK: Record<string, number> = { running: 4, review: 3, queued: 2, failed: 1, done: 1 };

async function compute(now: number): Promise<OfficeSnapshot> {
  await ensureDefaults();
  await expireStale(now);
  const [profiles, accounts, sessions, convs, tasks] = await Promise.all([
    AgentProfile.find({ enabled: true, kind: { $ne: 'tg' } }).sort({ order: 1, createdAt: 1 }).limit(200).select('key name kind team color').lean(),
    AiTgAccount.find({}).sort({ createdAt: 1 }).limit(100).select('label displayName username status').lean(),
    AiCallSession.find({ isActive: true }).limit(MAX_ROWS).select('employeeId channel tgAccountId startedAt answeredAt createdAt').lean(),
    AiConversation.find({ updatedAt: { $gte: new Date(now - CHAT_WINDOW_MS) }, source: { $nin: ['voice_inapp', 'telegram_call'] } })
      .sort({ updatedAt: -1 }).limit(MAX_ROWS).select('userId source createdAt updatedAt').lean(),
    AgentTask.find({ $or: [{ status: { $in: ['queued', 'review', 'running'] } }, { finishedAt: { $gte: new Date(now - RECENT_FINISH_MS) }, status: { $in: ['done', 'failed'] } }] })
      .sort({ createdAt: -1 }).limit(MAX_ROWS).select('agentKey status text startedAt createdAt finishedAt').lean(),
  ]) as [any[], any[], any[], any[], any[]];

  const userIds = [...new Set([...sessions.map((s) => String(s.employeeId)), ...convs.map((c) => String(c.userId))])]
    .filter((id) => /^[0-9a-f]{24}$/i.test(id));
  const users: any[] = userIds.length ? await User.find({ _id: { $in: userIds } }).select('role').lean() : [];
  const roleOf = new Map(users.map((u) => [String(u._id), String(u.role)]));

  const marks = new Map<string, Mark>();
  for (const s of sessions) {
    const since = ts(s.answeredAt, s.startedAt, s.createdAt);
    if (s.tgAccountId) mark(marks, `tg:${s.tgAccountId}`, 'call', since);
    const role = roleOf.get(String(s.employeeId));
    if (role === 'dasturchi') mark(marks, 'devpanel', 'call', since);
    else if (role) mark(marks, `role-${role}`, 'call', since);
  }
  for (const c of convs) {
    const role = roleOf.get(String(c.userId));
    const since = ts(c.updatedAt, c.createdAt);
    if (role === 'dasturchi') mark(marks, c.source === 'bot' ? 'devbot' : 'devpanel', 'chat', since);
    else if (role) mark(marks, `role-${role}`, 'chat', since);
  }
  // Har agent uchun eng muhim buyruq: running > review > queued > yaqinda tugagan
  const taskOf = new Map<string, any>();
  for (const t of tasks) {
    const cur = taskOf.get(t.agentKey);
    if (!cur || (TASK_RANK[t.status] || 0) > (TASK_RANK[cur.status] || 0)) taskOf.set(t.agentKey, t);
  }

  const build = (id: string, name: string, kind: OfficeAgentKind, team: string, color: string, extra: Partial<OfficeAgent> = {}): OfficeAgent => {
    const m = marks.get(id);
    const t = taskOf.get(id);
    const working = t?.status === 'running';
    const activity: OfficeActivity = working ? 'task' : m ? m.activity : t?.status === 'review' ? 'review' : 'idle';
    const since = working ? ts(t.startedAt, t.createdAt) : m ? m.since : t?.status === 'review' ? ts(t.createdAt) : undefined;
    return {
      id, name, kind, team, color, ...extra, busy: working || !!m, activity,
      ...(since ? { since: new Date(since).toISOString() } : {}),
      ...(t ? { task: { id: String(t._id), status: t.status, text: String(t.text).slice(0, 160), ...(t.finishedAt ? { finishedAt: new Date(t.finishedAt).toISOString() } : {}) } } : {}),
    };
  };
  const agents: OfficeAgent[] = [
    ...profiles.map((p) => build(p.key, p.name, p.kind, p.team || 'platform', p.color || '#D97757', p.kind === 'role' ? { role: String(p.key).slice(5) } : {})),
    ...accounts.map((a, i) => build(`tg:${a._id}`, String(a.label || a.displayName || a.username || `AI ${i + 1}`).slice(0, 40), 'tg', 'ai', '#D97757', { status: a.status })),
  ];
  return { agents, generatedAt: new Date(now).toISOString() };
}

/** Ofis holati — 5 s kesh, bir vaqtda kelgan so'rovlar bitta hisobni bo'lishadi. */
export async function officeSnapshot(now: number = Date.now()): Promise<OfficeSnapshot> {
  if (cache && now - cache.at < CACHE_MS) return cache.data;
  if (inflight) return inflight;
  inflight = compute(now)
    .then((data) => { cache = { at: now, data }; return data; })
    .finally(() => { inflight = null; });
  return inflight;
}
