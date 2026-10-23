import crypto from 'crypto';
import AgentProfile, { AGENT_TEAMS, type AgentTeam, type IAgentProfile } from '../../models/AgentProfile';
import Company from '../../models/Company';
import Subscription from '../../models/Subscription';
import AgentTask, { AGENT_TASK_ACTIVE, type AgentTaskStatus } from '../../models/AgentTask';
import User from '../../models/User';
import { logAudit } from '../../services/audit';
import { geminiConfigured, geminiTextToJson } from '../../services/gemini';
import { AGENT_DEFAULTS } from './defaults';
import { asSmmItem, featuresContext, newsContext, SMM_KEYS, smmFormatSpec } from '../smm/content';
import { channelConfig, SITE_BUTTON_URL, siteButtonLabel } from '../smm/channel';
import { tgSendPost } from '../smm/telegram';

// AI ofis — boshqaruv markazi (owner 2026-10-22). Agentlar ro'yxati (AgentProfile), buyruqlar (AgentTask) va bajarish:
//  • code agentlari → GitHub Actions repository_dispatch (event 'agent-task'); workflow (.github/workflows/agent-task.yml)
//    Claude Code bilan ishlab PR ochadi va /api/ai-voice/agent-callback'ga holat yuboradi (AGENT_CALLBACK_SECRET);
//    sozlanmagan bo'lsa — vazifa 'queued' qoladi, panel sozlash ro'yxatini ko'rsatadi (yiqilmaydi);
//  • content agentlari (SMM, Marketing) → backend'da Gemini; natija — tayyor postlar (items), avtomatik e'lon QILINMAYDI;
//  • Hisobotchi (reporter) → davr bo'yicha AgentTask'lar hisoboti (Gemini; ishlamasa — tuzilgan ro'yxat), boshqa agent
//    vazifasi tugagach 60 s ichida avtomatik ham tuziladi.
// Telegram'ga yuborish faqat dasturchi bosganda (kanal: AGENT_TG_CHANNEL_ID, dasturchi chati: DEVELOPER_CHAT_ID).

export const REPORTER_KEY = 'reporter';
export const FEATURE_KEY = 'feature';
export const MANAGER_KEY = 'manager';
export const MAX_PLAN_ITEMS = 8;
export const MAX_AGENTS = 80;
/** Boshliq buyrug'i yangi agent yaratish haqida: "X ishi uchun agent yonla", "yangi agent qo'sh: ...", "создай агента ...". */
export const SPAWN_RE = /(agent\S*\s+(yonla|yoqla|qo['‘’`]?sh|yarat|och|ishga\s*tushir))|(yangi\s+agent)|(созда\S*\s+(нов\S*\s+)?агент)|(нов\S+\s+агент)|(добав\S*\s+(нов\S*\s+)?агент)/i;
export const MAX_ACTIVE_PER_AGENT = 10;
export const STALE_RUNNING_MS = 3 * 60 * 60_000;
export const AUTO_REPORT_DELAY_MS = 60_000;
const DISPATCH_EVENT = 'agent-task';
const DAY = 24 * 60 * 60_000;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PR_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(pull|actions\/runs)\/\d+/;

// ───────────── Sozlamalar (har chaqiruvda env o'qiladi) ─────────────
const env = (k: string) => (process.env[k] || '').trim();
export function agentConfig() {
  const base = env('AGENT_CALLBACK_URL') || ((env('RENDER_EXTERNAL_URL') || env('BACKEND_URL')) ? `${(env('RENDER_EXTERNAL_URL') || env('BACKEND_URL')).replace(/\/+$/, '')}/api/ai-voice/agent-callback` : '');
  return {
    githubToken: env('AGENT_GITHUB_TOKEN'), repo: env('AGENT_GITHUB_REPO'), callbackSecret: env('AGENT_CALLBACK_SECRET'),
    callbackUrl: base, tgChannel: env('AGENT_TG_CHANNEL_ID'), devChat: env('DEVELOPER_CHAT_ID'), botToken: env('TELEGRAM_BOT_TOKEN'),
  };
}
export const githubReady = (c = agentConfig()) => !!(c.githubToken && REPO_RE.test(c.repo) && c.callbackSecret && /^https?:\/\//.test(c.callbackUrl));

export interface SetupItem { key: string; ok: boolean | null; where: 'backend' | 'github'; required: boolean; for: 'code' | 'content' | 'reporter' }
/** Sozlash ro'yxati (faqat NOMLAR va holat — qiymatlar hech qachon qaytarilmaydi). ok:null — backend tekshira olmaydi. */
export function setupChecklist(): { codeReady: boolean; contentReady: boolean; items: SetupItem[] } {
  const c = agentConfig();
  const items: SetupItem[] = [
    { key: 'AGENT_GITHUB_TOKEN', ok: !!c.githubToken, where: 'backend', required: true, for: 'code' },
    { key: 'AGENT_GITHUB_REPO', ok: REPO_RE.test(c.repo), where: 'backend', required: true, for: 'code' },
    { key: 'AGENT_CALLBACK_SECRET', ok: !!c.callbackSecret, where: 'backend', required: true, for: 'code' },
    { key: 'AGENT_CALLBACK_URL', ok: /^https?:\/\//.test(c.callbackUrl), where: 'backend', required: true, for: 'code' },
    // Claude obunasi orqali (owner 2026-10-23: API kalit sotib olmaydi) — `claude setup-token`
    { key: 'CLAUDE_CODE_OAUTH_TOKEN', ok: null, where: 'github', required: true, for: 'code' },
    { key: 'AGENT_CALLBACK_SECRET (GitHub)', ok: null, where: 'github', required: true, for: 'code' },
    { key: 'GEMINI_API_KEY', ok: geminiConfigured(), where: 'backend', required: true, for: 'content' },
    { key: 'AGENT_TG_CHANNEL_ID', ok: !!(c.tgChannel && c.botToken), where: 'backend', required: false, for: 'content' },
    { key: 'DEVELOPER_CHAT_ID', ok: !!(c.devChat && c.botToken), where: 'backend', required: false, for: 'reporter' },
  ];
  return { codeReady: githubReady(c), contentReady: geminiConfigured(), items };
}

// ───────────── Test ilgaklari ─────────────
type ContentRunner = (prompt: string) => Promise<any>;
const defaultRunner: ContentRunner = (p) => geminiTextToJson(p);
let contentRunner: ContentRunner = defaultRunner;
let officeInvalidate: () => void = () => {};
/** Faqat testlar uchun: Gemini o'rniga soxta. null — asl holat. */
export function __setContentRunnerForTests(fn: ContentRunner | null): void { contentRunner = fn || defaultRunner; }
export function onAgentChange(fn: () => void): void { officeInvalidate = fn; }
let defaultsReady: Promise<void> | null = null;
let autoTimer: NodeJS.Timeout | null = null;
const pending = new Set<Promise<unknown>>();
export function __resetAgentsForTests(): void {
  defaultsReady = null;
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
}
/** Testlar: fon ishlari (Gemini, dispatch) tugashini kutish. */
export async function __drainAgentsForTests(): Promise<void> { while (pending.size) await Promise.allSettled([...pending]); }
const background = (p: Promise<unknown>) => {
  const q = p.catch((e) => console.error('[agents] fon xatosi:', (e as Error)?.message)).finally(() => pending.delete(q));
  pending.add(q);
};

// ───────────── Profillar ─────────────
export function ensureDefaults(): Promise<void> {
  if (!defaultsReady) {
    defaultsReady = AgentProfile.bulkWrite(AGENT_DEFAULTS.map((d, i) => ({
      updateOne: {
        filter: { key: d.key },
        update: { $setOnInsert: { ...d, enabled: true, order: (i + 1) * 10, builtIn: true } },
        upsert: true,
      },
    })), { ordered: false }).then(() => undefined).catch((e) => { defaultsReady = null; throw e; });
  }
  return defaultsReady;
}

export interface AgentProfileDto {
  key: string; name: string; kind: string; team: string; description: string; systemPrompt: string; color: string; enabled: boolean; builtIn: boolean;
}
export const profileDto = (p: any): AgentProfileDto => ({
  key: p.key, name: p.name, kind: p.kind, team: p.team || 'platform', description: p.description || '', systemPrompt: p.systemPrompt || '',
  color: p.color || '#6366f1', enabled: p.enabled !== false, builtIn: !!p.builtIn,
});

export async function listProfiles(): Promise<AgentProfileDto[]> {
  await ensureDefaults();
  const rows = await AgentProfile.find({}).sort({ order: 1, createdAt: 1 }).limit(200).lean();
  return rows.map(profileDto);
}

const cleanText = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : undefined;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Audit: agent qo'shildi / o'zgardi (kim, qachon) — AuditLog, entity 'ai_office_agent'. */
async function auditAgent(by: string, action: 'create' | 'update', key: string, description: string, req?: any, newValue?: unknown): Promise<void> {
  const u: any = /^[0-9a-f]{24}$/i.test(by) ? await User.findById(by).select('firstName lastName role').lean().catch(() => null) : null;
  await logAudit({
    userId: by || 'system', userName: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Dasturchi', userRole: u?.role || 'dasturchi',
    action, entity: 'ai_office_agent', entityId: key, description, newValue, req,
  }).catch(() => {});
}

export async function createProfile(body: Record<string, unknown>, by: string, opts: { req?: any; via?: string } = {}): Promise<{ ok: true; profile: AgentProfileDto } | { ok: false; error: string }> {
  await ensureDefaults();
  const name = cleanText(body.name, 40);
  const kind = body.kind === 'content' ? 'content' : body.kind === 'code' ? 'code' : null;
  if (!name || !kind) return { ok: false, error: 'invalid' };
  if (await AgentProfile.countDocuments({}) >= MAX_AGENTS) return { ok: false, error: 'too_many' };
  if (await AgentProfile.exists({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) return { ok: false, error: 'name_taken' };
  const color = typeof body.color === 'string' && COLOR_RE.test(body.color) ? body.color : '#6366f1';
  const team = AGENT_TEAMS.includes(body.team as any) && body.team !== 'lead' && body.team !== 'assistants' ? (body.team as AgentTeam) : kind === 'content' ? 'growth' : 'platform';
  const doc = await AgentProfile.create({
    key: `custom-${crypto.randomBytes(4).toString('hex')}`, name, kind, team, color,
    description: cleanText(body.description, 300) || '', systemPrompt: cleanText(body.systemPrompt, 4000) || '',
    enabled: true, order: 500, builtIn: false, createdBy: by,
  });
  officeInvalidate();
  await auditAgent(by, 'create', doc.key, `AI ofis: yangi agent "${name}"${opts.via ? ` (${opts.via})` : ''}`, opts.req, { name, kind, team });
  return { ok: true, profile: profileDto(doc) };
}

export async function updateProfile(key: string, body: Record<string, unknown>, by = '', req?: any): Promise<AgentProfileDto | null> {
  await ensureDefaults();
  const set: Record<string, unknown> = {};
  const name = cleanText(body.name, 40);
  if (name) set.name = name;
  const desc = cleanText(body.description, 300);
  if (desc !== undefined) set.description = desc;
  const sp = cleanText(body.systemPrompt, 4000);
  if (sp !== undefined) set.systemPrompt = sp;
  if (typeof body.enabled === 'boolean') set.enabled = body.enabled;
  if (typeof body.color === 'string' && COLOR_RE.test(body.color)) set.color = body.color;
  if (AGENT_TEAMS.includes(body.team as any)) set.team = body.team;
  const doc = await AgentProfile.findOneAndUpdate({ key }, { $set: set }, { returnDocument: 'after' }).lean();
  officeInvalidate();
  if (doc) await auditAgent(by, 'update', key, `AI ofis: agent "${(doc as any).name}" o'zgartirildi`, req, set);
  return doc ? profileDto(doc) : null;
}

// ───────────── Vazifalar ─────────────
export const taskDto = (t: any) => ({
  id: String(t._id), agentKey: t.agentKey, agentKind: t.agentKind, text: t.text, status: t.status as AgentTaskStatus,
  summary: t.summary || undefined, spec: t.spec || undefined, parentId: t.parentId || undefined, spawnedKey: t.spawnedKey || undefined,
  plan: (t.plan || []).map((p: any) => ({ agentKey: p.agentKey, text: p.text, ...(p.taskId ? { taskId: String(p.taskId) } : {}) })),
  items: (t.items || []).map(itemDto),
  links: (t.links || []).map((l: any) => ({ label: l.label, url: l.url })),
  log: (t.log || []).slice(-50).map((l: any) => ({ at: new Date(l.at).toISOString(), text: l.text })),
  error: t.error || undefined,
  createdAt: new Date(t.createdAt).toISOString(),
  startedAt: t.startedAt ? new Date(t.startedAt).toISOString() : undefined,
  finishedAt: t.finishedAt ? new Date(t.finishedAt).toISOString() : undefined,
});
export type AgentTaskDto = ReturnType<typeof taskDto>;

const isoOf = (d: unknown) => (d ? new Date(d as string).toISOString() : undefined);
const pubDto = (p: any) => (p && p.status ? {
  status: p.status, at: isoOf(p.at), ...(p.kind ? { kind: p.kind } : {}), ...(p.target ? { target: p.target } : {}),
  ...(p.url ? { url: p.url } : {}), ...(p.error ? { error: p.error } : {}), ...(p.detail ? { detail: String(p.detail).slice(0, 300) } : {}),
} : undefined);
/** Item DTO — SMM maydonlari (format, slaydlar, qurilmadagi media metama'lumoti, e'lon holati) bo'lsa qo'shiladi. */
export function itemDto(i: any) {
  return {
    title: i.title || '', text: i.text || '', ...(i.hashtags?.length ? { hashtags: i.hashtags } : {}),
    ...(i.format ? { format: i.format } : {}), ...(i.lang ? { lang: i.lang } : {}), ...(i.topic ? { topic: i.topic } : {}),
    ...(i.category ? { category: i.category } : {}), ...(i.imagePrompt ? { imagePrompt: i.imagePrompt } : {}),
    ...(i.scenes?.length ? { scenes: i.scenes.map((x: any) => ({ title: x.title || '', text: x.text || '' })) } : {}),
    ...(i.media?.length ? { media: i.media.map((m: any) => ({ id: m.id, kind: m.kind, ...(m.mime ? { mime: m.mime } : {}), ...(m.w ? { w: m.w, h: m.h } : {}), ...(m.size ? { size: m.size } : {}), ...(m.source ? { source: m.source } : {}), ...(m.at ? { at: isoOf(m.at) } : {}) })) } : {}),
    ...(i.approval && i.approval !== 'none' ? { approval: i.approval } : {}),
    ...(pubDto(i.tg) ? { tg: pubDto(i.tg) } : {}), ...(pubDto(i.ig) ? { ig: pubDto(i.ig) } : {}),
  };
}

const logLine = (text: string) => ({ at: new Date(), text: text.slice(0, 500) });

/** 3 soatdan beri javobsiz 'running' code vazifalari — 'failed' (timeout). Arzon: indeks {status, updatedAt}. */
export async function expireStale(now = Date.now()): Promise<void> {
  const r = await AgentTask.updateMany(
    { status: 'running', agentKind: 'code', updatedAt: { $lt: new Date(now - STALE_RUNNING_MS) } },
    { $set: { status: 'failed', error: 'timeout', finishedAt: new Date(now) }, $push: { log: logLine("Javob kelmadi (3 soat) — to'xtatildi") } },
  );
  if (r.modifiedCount) officeInvalidate();
}

export async function listTasks(q: { agentKey?: string; limit?: number }): Promise<AgentTaskDto[]> {
  await expireStale();
  const filter: Record<string, unknown> = {};
  if (q.agentKey) filter.agentKey = q.agentKey;
  const rows = await AgentTask.find(filter).sort({ createdAt: -1 }).limit(Math.min(Math.max(q.limit || 30, 1), 100)).lean();
  return rows.map(taskDto);
}

export async function getTask(id: string): Promise<AgentTaskDto | null> {
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  const t = await AgentTask.findById(id).lean();
  return t ? taskDto(t) : null;
}

export async function createTask(agentKey: string, rawText: unknown, by: string, opts: { auto?: boolean; parentId?: string } = {}):
  Promise<{ ok: true; task: AgentTaskDto } | { ok: false; error: string; status: number }> {
  await ensureDefaults();
  const text = cleanText(rawText, 4000);
  if (!text) return { ok: false, error: 'invalid', status: 400 };
  const profile: any = await AgentProfile.findOne({ key: agentKey }).lean();
  if (!profile) return { ok: false, error: 'agent_not_found', status: 404 };
  if (profile.kind !== 'code' && profile.kind !== 'content') return { ok: false, error: 'agent_no_tasks', status: 400 };
  if (!profile.enabled) return { ok: false, error: 'agent_disabled', status: 409 };
  if (await AgentTask.countDocuments({ agentKey, status: { $in: AGENT_TASK_ACTIVE } }) >= MAX_ACTIVE_PER_AGENT) {
    return { ok: false, error: 'too_many_active', status: 429 };
  }
  const doc: any = await AgentTask.create({
    agentKey, agentKind: profile.kind, text, status: 'queued', createdBy: by, ...(opts.parentId ? { parentId: opts.parentId } : {}),
    log: [logLine(opts.auto ? 'Avtomatik hisobot' : 'Buyruq qabul qilindi')],
  });
  officeInvalidate();
  background(start(String(doc._id), profile, false));
  return { ok: true, task: taskDto(doc) };
}

/** Avtopilot uchun: vazifa yaratib, natijasini KUTISH (fon ishi emas). */
export async function createTaskAndWait(agentKey: string, text: string, by: string): Promise<{ ok: true; task: AgentTaskDto } | { ok: false; error: string; status: number }> {
  await ensureDefaults();
  const profile: any = await AgentProfile.findOne({ key: agentKey }).lean();
  if (!profile) return { ok: false, error: 'agent_not_found', status: 404 };
  if (!profile.enabled) return { ok: false, error: 'agent_disabled', status: 409 };
  const doc: any = await AgentTask.create({ agentKey, agentKind: profile.kind, text: text.slice(0, 4000), status: 'queued', createdBy: by, log: [logLine('Avtopilot vazifasi')] });
  officeInvalidate();
  await start(String(doc._id), profile, false);
  const t = await AgentTask.findById(doc._id).lean();
  return { ok: true, task: taskDto(t) };
}

export async function cancelTask(id: string): Promise<AgentTaskDto | null | 'not_active'> {
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  const t = await AgentTask.findOneAndUpdate(
    { _id: id, status: { $in: AGENT_TASK_ACTIVE } },
    { $set: { status: 'cancelled', finishedAt: new Date() }, $push: { log: logLine('Dasturchi bekor qildi') } },
    { returnDocument: 'after' },
  ).lean();
  if (!t) return (await AgentTask.exists({ _id: id })) ? 'not_active' : null;
  // Boshliq maqsadi bekor qilinsa — uning faol bo'lak vazifalari ham
  await AgentTask.updateMany({ parentId: id, status: { $in: AGENT_TASK_ACTIVE } },
    { $set: { status: 'cancelled', finishedAt: new Date() }, $push: { log: logLine('Boshliq maqsadi bekor qilindi') } });
  officeInvalidate();
  return taskDto(t);
}

/** Navbatdagi (sozlanmagan paytda qolgan) yoki muvaffaqiyatsiz vazifani qayta yuborish. */
export async function retryTask(id: string): Promise<AgentTaskDto | null | 'not_retryable'> {
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  const t: any = await AgentTask.findOneAndUpdate(
    { _id: id, status: { $in: ['queued', 'failed'] } },
    { $set: { status: 'queued' }, $unset: { error: 1, finishedAt: 1 }, $push: { log: logLine('Qayta yuborildi') } },
    { returnDocument: 'after' },
  ).lean();
  if (!t) return (await AgentTask.exists({ _id: id })) ? 'not_retryable' : null;
  const profile: any = await AgentProfile.findOne({ key: t.agentKey }).lean();
  if (!profile) return 'not_retryable';
  if (t.parentId) await AgentTask.updateOne({ _id: t.parentId, status: { $in: ['done', 'failed'] } }, { $set: { status: 'running' }, $unset: { finishedAt: 1, error: 1 } });
  officeInvalidate();
  background(start(id, profile, !!t.spec || (t.plan || []).length > 0));
  return taskDto(t);
}

// Holat o'tishi: faqat faol vazifa yangilanadi (bekor qilingan / tugagan qayta ochilmaydi)
async function transition(id: string, from: AgentTaskStatus[], status: AgentTaskStatus, set: Record<string, unknown>, log: string): Promise<boolean> {
  const fin = status === 'done' || status === 'failed';
  const r = await AgentTask.updateOne(
    { _id: id, status: { $in: from } },
    { $set: { status, ...set, ...(fin ? { finishedAt: new Date() } : {}) }, $push: { log: logLine(log) } },
  );
  if (r.modifiedCount) {
    officeInvalidate();
    if (fin) background(afterFinish(id, status));
  }
  return r.modifiedCount > 0;
}

const start = (id: string, profile: any, hasSpec: boolean): Promise<void> =>
  profile.key === MANAGER_KEY ? managerStart(id)
  : profile.kind === 'content' ? runContent(id, profile)
    : profile.key === FEATURE_KEY && !hasSpec ? draftSpec(id, profile)
      : dispatchCode(id, profile);

// ───────────── Yangi funksiya: spetsifikatsiya → tasdiq → kod ─────────────
/** Spetsifikatsiya (AI'siz zaxira — shablon). */
export const fallbackSpec = (text: string) => [
  `Nima: ${text}`, "Kim foydalanadi: (aniqlashtiring — direktor / o'rinbosar / prorab / ishchi / dasturchi)",
  "Ekranlar: (qaysi bo'limda, qanday tugma/forma)", "Ma'lumotlar: (qanday yozuvlar saqlanadi)", 'Tekshiruv: backend va e2e testlar',
].join('\n');

async function draftSpec(id: string, profile: any): Promise<void> {
  if (!(await transition(id, ['queued'], 'running', { startedAt: new Date() }, 'Spetsifikatsiya yozyapman'))) return;
  const t: any = await AgentTask.findById(id).lean();
  if (!t) return;
  let spec = fallbackSpec(t.text);
  let via = "shablon (AI'siz)";
  try {
    const out = await contentRunner(`${profile.systemPrompt}
Dasturchi YANGI funksiya so'radi: """${t.text}"""
Kod yozishdan OLDIN egasi tasdiqlashi uchun qisqa spetsifikatsiya tuz (oddiy o'zbek tilida, lotin): nima qiladi, kim foydalana oladi (rollar), qaysi ekranlar/tugmalar, qanday ma'lumot saqlanadi, chegaralar va testlar.
FAQAT JSON qaytar: {"spec": "spetsifikatsiya matni (qatorlar \n bilan, 8–20 qator)"}`);
    const s = cleanText(out?.spec, 6000);
    if (s) { spec = s; via = 'AI'; }
  } catch { /* zaxira shablon */ }
  await transition(id, ['running'], 'review', { spec }, `Spetsifikatsiya tayyor (${via}) — tasdiqlang`);
}

/** Egasi tasdiqladi: "Yangi funksiya" — spetsifikatsiya (tahrirlangan bo'lishi mumkin) → kod (GitHub); Boshliq — reja
 *  (tahrirlangan/qisqartirilgan bo'lishi mumkin) → har band alohida agent vazifasi. */
export async function approveTask(id: string, body: { spec?: unknown; plan?: unknown }, by: string): Promise<AgentTaskDto | null | 'not_review' | 'invalid'> {
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  const cur: any = await AgentTask.findById(id).select('agentKey status plan').lean();
  if (!cur) return null;
  if (cur.status !== 'review') return 'not_review';
  if (cur.agentKey === MANAGER_KEY) {
    const roster = await taskableKeys();
    const plan = cleanPlan(body.plan === undefined ? (cur.plan || []) : body.plan, roster);
    if (!plan.length) return 'invalid';
    const t: any = await AgentTask.findOneAndUpdate(
      { _id: id, status: 'review' },
      { $set: { status: 'running', plan }, $push: { log: logLine(`Egasi rejani tasdiqladi — ${plan.length} ta vazifa tarqatildi`) } },
      { returnDocument: 'after' },
    ).lean();
    if (!t) return 'not_review';
    const withIds: { agentKey: string; text: string; taskId?: string }[] = [];
    for (const item of plan) {
      const r = await createTask(item.agentKey, item.text, by, { parentId: id });
      withIds.push(r.ok ? { ...item, taskId: r.task.id } : item);
      if (!r.ok) await AgentTask.updateOne({ _id: id }, { $push: { log: logLine(`${item.agentKey}: vazifa berilmadi (${r.error})`) } });
    }
    const done: any = await AgentTask.findOneAndUpdate({ _id: id }, { $set: { plan: withIds } }, { returnDocument: 'after' }).lean();
    officeInvalidate();
    background(updateParent(id));
    return taskDto(done);
  }
  const spec = cleanText(body.spec, 6000);
  const t: any = await AgentTask.findOneAndUpdate(
    { _id: id, status: 'review' },
    { $set: { status: 'queued', ...(spec ? { spec } : {}) }, $push: { log: logLine('Egasi tasdiqladi — kod yozishga yuborildi') } },
    { returnDocument: 'after' },
  ).lean();
  if (!t) return 'not_review';
  const profile: any = await AgentProfile.findOne({ key: t.agentKey }).lean();
  officeInvalidate();
  if (profile) background(dispatchCode(id, profile));
  return taskDto(t);
}

// ───────────── Boshliq (manager) ─────────────
async function managerStart(id: string): Promise<void> {
  const t: any = await AgentTask.findById(id).select('text').lean();
  if (t && SPAWN_RE.test(String(t.text))) return spawnAgent(id);
  return draftPlan(id);
}

const TEAM_HINTS: [RegExp, string][] = [
  [/smm|post|marketing|reklama|kontent|matn|javob|support|mijoz|hujjat|qo'llanma|tarif|obuna|hisobot/i, 'growth'],
  [/ilova|android|windows|tauri|apk|ios|sayt|landing|mini\s*app|gps|xarita/i, 'apps'],
  [/\bai\b|bot|gemini|ovoz|qo'ng'iroq|telegram|bildirishnoma/i, 'ai'],
  [/test|qa|xavfsiz|deploy|devops|server|tezlik|monitoring|xato|tarjima|i18n/i, 'ops'],
];
const CONTENT_RE = /smm|post|marketing|reklama|kontent|matn yoz|javob|support|mijozlar|hujjat|qo'llanma|maqola|kopirayt|sotuv/i;

/** Boshliqdan yangi agent: nomi/roli Gemini bilan (yoki buyruqdan), serverda saqlanadi, ofisda o'z stolini oladi. */
export function fallbackAgentDraft(text: string): { name: string; kind: 'code' | 'content'; team: string; description: string; systemPrompt: string } {
  const after = text.includes(':') ? text.slice(text.indexOf(':') + 1) : text;
  const core = after
    .replace(/(yangi\s+)?agent\S*\s*(yonla|yoqla|qo['‘’`]?sh|yarat|och|ishga\s*tushir)\S*/ig, '')
    .replace(/yangi\s+agent/ig, '').replace(/\s+(ishi\s+)?uchun\b/ig, '').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
  const words = core.split(' ').filter(Boolean).slice(0, 4).join(' ');
  const name = (words ? words[0].toUpperCase() + words.slice(1) : 'Yangi agent').slice(0, 40);
  const kind = CONTENT_RE.test(text) ? 'content' : 'code';
  const team = TEAM_HINTS.find(([re]) => re.test(text))?.[1] || (kind === 'content' ? 'growth' : 'platform');
  const description = (core || text).slice(0, 300);
  return { name, kind, team, description, systemPrompt: `Sen "${name}" agentisan. Vazifang: ${description}. Aniq, xavfsiz ishla; natijani qisqa xulosa bilan ber.` };
}

async function spawnAgent(id: string): Promise<void> {
  if (!(await transition(id, ['queued'], 'running', { startedAt: new Date() }, "Yangi agent uchun stol tayyorlayapman"))) return;
  const t: any = await AgentTask.findById(id).lean();
  if (!t) return;
  let draft = fallbackAgentDraft(String(t.text));
  try {
    const out = await contentRunner(`Sen AI ofis Boshlig'isan. Egasi yangi agent so'radi: """${t.text}"""
Shu agentni tavsifla. Jamoalar: platform (backend/frontend/ma'lumotlar), apps (ilovalar, sayt), ai (AI va botlar), ops (sifat, xavfsizlik, deploy), growth (kontent, marketing, hisobot).
Turi: "code" — kod yozadi (GitHub PR); "content" — matn/reja tayyorlaydi.
FAQAT JSON qaytar: {"name": "qisqa nom (2-3 so'z, o'zbekcha)", "kind": "code|content", "team": "platform|apps|ai|ops|growth", "description": "1 jumla", "systemPrompt": "agent roli, sohasi va qoidalari (3-6 jumla)"}`);
    if (out && typeof out === 'object' && typeof out.name === 'string' && out.name.trim()) {
      draft = {
        name: out.name, kind: out.kind === 'content' ? 'content' : out.kind === 'code' ? 'code' : draft.kind,
        team: typeof out.team === 'string' ? out.team : draft.team,
        description: typeof out.description === 'string' ? out.description : draft.description,
        systemPrompt: typeof out.systemPrompt === 'string' && out.systemPrompt.trim() ? out.systemPrompt : draft.systemPrompt,
      };
    }
  } catch { /* zaxira — buyruqdan */ }
  const palette = ['#f97316', '#06b6d4', '#a855f7', '#22c55e', '#ec4899', '#eab308', '#3b82f6', '#14b8a6', '#ef4444', '#8b5cf6'];
  const color = palette[parseInt(String(id).slice(-2), 16) % palette.length];
  let r = await createProfile({ ...draft, color }, t.createdBy || '', { via: 'Boshliq' });
  if (!r.ok && r.error === 'name_taken') r = await createProfile({ ...draft, name: `${draft.name.slice(0, 36)} 2`, color }, t.createdBy || '', { via: 'Boshliq' });
  if (!r.ok) {
    await transition(id, ['running'], 'failed', { error: r.error === 'too_many' ? 'too_many_agents' : 'agent_invalid' },
      r.error === 'too_many' ? `Agentlar soni chegarasi (${MAX_AGENTS}) — avval keraksizini o'chiring` : "Agent ma'lumoti noto'g'ri");
    return;
  }
  const p = r.profile;
  await transition(id, ['running'], 'done', {
    spawnedKey: p.key, summary: `Yangi agent qo'shildi: ${p.name} (${p.kind === 'code' ? 'kod' : 'kontent'} agenti). Ofisda o'z stoliga o'tirdi — unga buyruq berishingiz mumkin.`,
    items: [{ title: p.name, text: `${p.description}\n\nRoli: ${p.systemPrompt}`.slice(0, 4000) }],
  }, `Yangi agent: ${p.name}`);
}

async function taskableKeys(): Promise<Map<string, any>> {
  const rows: any[] = await AgentProfile.find({ kind: { $in: ['code', 'content'] }, enabled: true, key: { $nin: [MANAGER_KEY, REPORTER_KEY] } })
    .select('key name kind description').lean();
  return new Map(rows.map((r) => [r.key, r]));
}
export function cleanPlan(v: unknown, roster: Map<string, any>): { agentKey: string; text: string }[] {
  if (!Array.isArray(v)) return [];
  return v.map((x: any) => ({ agentKey: typeof x?.agentKey === 'string' ? x.agentKey : '', text: cleanText(x?.text ?? x?.task, 2000) || '' }))
    .filter((x) => roster.has(x.agentKey) && x.text).slice(0, MAX_PLAN_ITEMS);
}

async function draftPlan(id: string): Promise<void> {
  if (!(await transition(id, ['queued'], 'running', { startedAt: new Date() }, "Maqsadni vazifalarga bo'lyapman"))) return;
  const t: any = await AgentTask.findById(id).lean();
  if (!t) return;
  const roster = await taskableKeys();
  const boss: any = await AgentProfile.findOne({ key: MANAGER_KEY }).lean();
  let plan: { agentKey: string; text: string }[] = [];
  let via = 'AI';
  try {
    const out = await contentRunner(`${boss?.systemPrompt || 'Sen Boshliq agentisan.'}
Agentlar (key — nomi — turi — sohasi): ${[...roster.values()].map((r) => `${r.key} — ${r.name} — ${r.kind} — ${r.description || ''}`).join('; ')}
Egasining maqsadi: """${t.text}"""
FAQAT JSON qaytar: {"plan": [{"agentKey": "ro'yxatdagi key", "text": "aniq vazifa matni (o'zbekcha)"}]} — 1–${MAX_PLAN_ITEMS} ta.`);
    plan = cleanPlan(out?.plan, roster);
  } catch { /* zaxira pastda */ }
  if (!plan.length) {
    via = "AI'siz";
    const fallback = roster.has(FEATURE_KEY) ? FEATURE_KEY : [...roster.keys()][0];
    if (fallback) plan = [{ agentKey: fallback, text: t.text }];
  }
  if (!plan.length) {
    await transition(id, ['running'], 'failed', { error: 'no_agents' }, "Vazifa beradigan agent yo'q");
    return;
  }
  await transition(id, ['running'], 'review', { plan }, `Reja tayyor (${via}, ${plan.length} ta vazifa) — tasdiqlang`);
}

/** Bo'lak vazifa tugadi: boshliq kuzatadi — hammasi tugasa maqsad yopiladi. */
async function updateParent(parentId: string): Promise<void> {
  const parent: any = await AgentTask.findById(parentId).select('status plan').lean();
  if (!parent || parent.status !== 'running' || !(parent.plan || []).length) return;
  const kids: any[] = await AgentTask.find({ parentId }).select('status agentKey').lean();
  if (!kids.length) {
    await transition(parentId, ['running'], 'failed', { error: 'no_tasks' }, 'Hech bir vazifa berilmadi');
    return;
  }
  if (kids.some((k) => AGENT_TASK_ACTIVE.includes(k.status))) return;
  const n = (st: string) => kids.filter((k) => k.status === st).length;
  const summary = `Maqsad bo'yicha ${kids.length} ta vazifa: tayyor ${n('done')}, xato ${n('failed')}, bekor ${n('cancelled')}.`;
  await transition(parentId, ['running'], n('done') ? 'done' : 'failed', { summary, ...(n('done') ? {} : { error: 'all_failed' }) }, summary);
}

async function afterFinish(id: string, status: AgentTaskStatus): Promise<void> {
  const t: any = await AgentTask.findById(id).select('agentKey parentId').lean();
  if (!t) return;
  if (t.parentId) {
    if (status === 'failed') {
      await AgentTask.updateOne({ _id: t.parentId }, { $push: { log: logLine(`${t.agentKey}: vazifa xato bilan tugadi — "Qayta yuborish" yoki boshqa agentga bering`) } });
    }
    await updateParent(t.parentId);
  }
  if (t.agentKey !== REPORTER_KEY && t.agentKey !== MANAGER_KEY) maybeAutoReport(id);
}

// ───────────── code: GitHub Actions ─────────────
async function dispatchCode(id: string, profile: IAgentProfile | any): Promise<void> {
  const c = agentConfig();
  if (!githubReady(c)) {
    await AgentTask.updateOne({ _id: id, status: 'queued' }, { $push: { log: logLine("GitHub sozlanmagan — vazifa navbatda kutadi (sozlash ro'yxatiga qarang)") } });
    return;
  }
  const t: any = await AgentTask.findById(id).lean();
  if (!t || t.status !== 'queued') return;
  let status = 0;
  try {
    const res = await fetch(`https://api.github.com/repos/${c.repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json', 'User-Agent': 'QurilishERP-agents',
      },
      body: JSON.stringify({
        event_type: DISPATCH_EVENT,
        client_payload: {
          taskId: id, agentKey: profile.key, agentName: profile.name,
          rolePrompt: String(profile.systemPrompt || '').slice(0, 4000), callbackUrl: c.callbackUrl,
          text: t.spec ? `${t.text}

---
Tasdiqlangan spetsifikatsiya (egasi tasdiqlagan — shunga qat'iy amal qil):
${t.spec}`.slice(0, 10_000) : t.text,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
  } catch {
    status = -1;
  }
  if (status >= 200 && status < 300) {
    await transition(id, ['queued'], 'running', { startedAt: new Date() }, "GitHub Actions'ga yuborildi — agent ishni boshladi");
  } else {
    // Token/sir hech qachon xatoga qo'shilmaydi — faqat HTTP kod
    await transition(id, ['queued'], 'failed', { error: status === -1 ? 'github_unreachable' : `github_${status}` },
      status === -1 ? "GitHub'ga ulanib bo'lmadi" : `GitHub rad etdi (HTTP ${status}) — token huquqlari va repo nomini tekshiring`);
  }
}

export interface CallbackBody { taskId?: unknown; status?: unknown; summary?: unknown; prUrl?: unknown; runUrl?: unknown; log?: unknown }
/** GitHub workflow qayta qo'ng'irog'i. Sir — routeda tekshiriladi (constant-time). */
export async function applyCallback(b: CallbackBody): Promise<{ ok: boolean; error?: string; status?: number }> {
  const id = typeof b.taskId === 'string' ? b.taskId : '';
  if (!/^[0-9a-f]{24}$/i.test(id)) return { ok: false, error: 'invalid', status: 400 };
  const st = b.status === 'running' || b.status === 'done' || b.status === 'failed' ? b.status : null;
  if (!st) return { ok: false, error: 'invalid', status: 400 };
  const t: any = await AgentTask.findById(id).select('status agentKind links').lean();
  if (!t || t.agentKind !== 'code') return { ok: false, error: 'not_found', status: 404 };
  const links = [...(t.links || [])];
  const addLink = (label: string, url: unknown) => {
    if (typeof url === 'string' && PR_RE.test(url) && !links.some((l: any) => l.url === url)) links.push({ label, url: url.slice(0, 500) });
  };
  addLink('Pull request', b.prUrl);
  addLink('GitHub Actions', b.runUrl);
  const summary = cleanText(b.summary, 4000);
  const extra = cleanText(b.log, 400);
  const set: Record<string, unknown> = { links };
  if (summary) set.summary = summary;
  if (st === 'running') {
    const ok = await transition(id, ['queued', 'running'], 'running', { ...set, ...(t.status === 'queued' ? { startedAt: new Date() } : {}) }, extra || 'Agent ishlayapti');
    return ok ? { ok: true } : { ok: true, error: 'ignored' };
  }
  if (st === 'failed') set.error = 'workflow_failed';
  const ok = await transition(id, ['queued', 'running'], st, set,
    extra || (st === 'done' ? (typeof b.prUrl === 'string' ? 'Tayyor — PR ochildi' : "Tayyor — o'zgarish yo'q") : 'Workflow xato bilan tugadi'));
  return ok ? { ok: true } : { ok: true, error: 'ignored' };
}

export function callbackSecretOk(given: unknown): 'ok' | 'bad' | 'unconfigured' {
  const want = agentConfig().callbackSecret;
  if (!want) return 'unconfigured';
  if (typeof given !== 'string' || !given) return 'bad';
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b) ? 'ok' : 'bad';
}

// ───────────── content: Gemini ─────────────
const asItems = (v: unknown) => (Array.isArray(v) ? v : []).slice(0, 12).map((i: any) => ({
  title: cleanText(i?.title, 200) || '', text: cleanText(i?.text, 4000) || '',
  ...(Array.isArray(i?.hashtags) ? { hashtags: i.hashtags.filter((h: unknown) => typeof h === 'string').slice(0, 15).map((h: string) => h.slice(0, 60)) } : {}),
})).filter((i) => i.text);

async function runContent(id: string, profile: any): Promise<void> {
  const ok = await transition(id, ['queued'], 'running', { startedAt: new Date() }, profile.key === REPORTER_KEY ? "Vazifalarni yig'yapman" : 'Yozyapman');
  if (!ok) return;
  const t: any = await AgentTask.findById(id).lean();
  if (!t) return;
  if (profile.key === REPORTER_KEY) return runReport(id, t, profile);
  const smm = SMM_KEYS.includes(profile.key);
  const lang = (/\[lang:(uz|ru|both)\]/.exec(String(t.text))?.[1] as 'uz' | 'ru' | 'both' | undefined) || (/[а-яё]/i.test(String(t.text)) ? 'ru' : 'uz');
  const prompt = smm ? `${profile.systemPrompt || `Sen ${profile.name} agentisan.`}

Bugungi sana: ${new Date().toISOString().slice(0, 10)}.
${featuresContext()}
${await newsContext().catch(() => '')}
Buyruq: """${t.text}"""

${smmFormatSpec(lang)}
Buyruqda son aytilmagan bo'lsa 2–4 ta item.` : `${profile.systemPrompt || `Sen ${profile.name} agentisan.`}

Bugungi sana: ${new Date().toISOString().slice(0, 10)}.
${await contextFor(profile.key)}Dasturchidan buyruq: """${t.text}"""

Natijani FAQAT JSON ko'rinishida qaytar: {"summary": "1-3 jumla xulosa", "items": [{"title": "qisqa sarlavha", "text": "tayyor matn (post/caption/reja bandi)", "hashtags": ["#..."]}]}.
Tilni buyruq tilidan ol (o'zbekcha bo'lsa — lotin yozuvida o'zbekcha). 1–8 ta item. Hech narsani avtomatik e'lon qilma.`;
  try {
    const out = await contentRunner(prompt);
    const items = smm
      ? (Array.isArray(out?.items) ? out.items : []).slice(0, 12).map((i: any) => asSmmItem(i, lang)).filter(Boolean) as any[]
      : asItems(out?.items);
    if (!items.length) throw new Error('empty');
    await transition(id, ['running'], 'done', { summary: cleanText(out?.summary, 4000) || '', items }, `Tayyor — ${items.length} ta matn`);
  } catch (e) {
    const msg = String((e as Error)?.message || '');
    await transition(id, ['running'], 'failed', { error: /sozlanmagan|GEMINI/i.test(msg) ? 'gemini_unconfigured' : 'gemini_failed' },
      /sozlanmagan|GEMINI/i.test(msg) ? 'Gemini kaliti sozlanmagan' : "AI javob bermadi — keyinroq qayta urinib ko'ring");
  }
}

/** Agentga kerakli ma'lumot (faqat o'qish). Tariflar boshqaruvchisi — firmalar obunalari ro'yxati (ko'pi bilan 150). */
export async function contextFor(key: string): Promise<string> {
  if (key !== 'billing') return '';
  const subs: any[] = await Subscription.find({}).sort({ updatedAt: -1 }).limit(300)
    .select('companyId plan selectedPlan status amount currentPeriodEnd cancelRequestedAt customFeatures').lean();
  const latest = new Map<string, any>();
  for (const s of subs) if (!latest.has(String(s.companyId))) latest.set(String(s.companyId), s);
  const rows = [...latest.values()].slice(0, 150);
  const ids = rows.map((r) => String(r.companyId)).filter((id) => /^[0-9a-f]{24}$/i.test(id));
  const names = new Map((await Company.find({ _id: { $in: ids } }).select('name').lean()).map((c: any) => [String(c._id), c.name]));
  const now = Date.now();
  const list = rows.map((r) => ({
    firma: names.get(String(r.companyId)) || String(r.companyId).slice(-6), tarif: r.selectedPlan || r.plan, holat: r.status,
    summa: r.amount || undefined, tugashiga_kun: r.currentPeriodEnd ? Math.ceil((new Date(r.currentPeriodEnd).getTime() - now) / DAY) : undefined,
    bekor_soralgan: r.cancelRequestedAt ? true : undefined, qoshimcha: r.customFeatures?.length ? r.customFeatures : undefined,
  }));
  return `Obunalar (faqat o'qish uchun, ${list.length} ta firma, JSON): ${JSON.stringify(list)}

`;
}

// ───────────── Hisobotchi ─────────────
const TZ_OFFSET = 5 * 60 * 60_000; // Asia/Tashkent (UTC+5, yozgi vaqt yo'q)
/** Buyruq matnidan davr: "bugun" — Toshkent kuni boshidan; "hafta" — 7 kun; "oy" — 30 kun; aks holda 24 soat. */
export function reportPeriod(text: string, now = Date.now(), lastReportAt?: number): { from: number; label: string } {
  const s = text.toLowerCase();
  if (/hafta|недел/.test(s)) return { from: now - 7 * DAY, label: 'oxirgi 7 kun' };
  if (/\boy\b|oylik|месяц/.test(s)) return { from: now - 30 * DAY, label: 'oxirgi 30 kun' };
  if (/bugun|сегодня/.test(s)) return { from: Math.floor((now + TZ_OFFSET) / DAY) * DAY - TZ_OFFSET, label: 'bugun' };
  if (lastReportAt && now - lastReportAt < DAY) return { from: lastReportAt, label: "oxirgi hisobotdan beri" };
  return { from: now - DAY, label: 'oxirgi 24 soat' };
}

const ST_UZ: Record<string, string> = { queued: 'navbatda', running: 'bajarilmoqda', done: 'tayyor', failed: 'xato', cancelled: 'bekor qilindi' };
const ERR_UZ: Record<string, string> = {
  timeout: "3 soat ichida javob kelmadi", github_unreachable: "GitHub'ga ulanib bo'lmadi", workflow_failed: 'GitHub Actions xato bilan tugadi',
  gemini_unconfigured: 'Gemini kaliti sozlanmagan', gemini_failed: 'AI javob bermadi',
};
const errUz = (e?: string) => (e ? ERR_UZ[e] || (e.startsWith('github_') ? `GitHub rad etdi (${e.slice(7)})` : e) : '');

/** AI'siz tuzilgan hisobot (zaxira). */
export function plainReport(tasks: any[], names: Map<string, string>, label: string): string {
  if (!tasks.length) return `Hisobot (${label}): bu davrda agentlarga vazifa berilmagan.`;
  const count = (s: string) => tasks.filter((t) => t.status === s).length;
  const lines = [`Hisobot (${label}): jami ${tasks.length} ta vazifa — tayyor ${count('done')}, bajarilmoqda ${count('running')}, navbatda ${count('queued')}, xato ${count('failed')}, bekor ${count('cancelled')}.`, ''];
  for (const t of tasks) {
    const link = (t.links || []).find((l: any) => /\/pull\//.test(l.url))?.url;
    lines.push(`• ${names.get(t.agentKey) || t.agentKey}: "${String(t.text).slice(0, 120)}" — ${ST_UZ[t.status] || t.status}${t.error ? ` (${errUz(t.error)})` : ''}${link ? ` — ${link}` : ''}${t.summary ? `\n  ${String(t.summary).slice(0, 300)}` : ''}`);
  }
  const todo: string[] = [];
  if (tasks.some((t) => t.status === 'queued' && t.agentKind === 'code')) todo.push("GitHub sozlamalarini tugating — code vazifalari navbatda kutmoqda.");
  if (tasks.some((t) => (t.links || []).some((l: any) => /\/pull\//.test(l.url)) && t.status === 'done')) todo.push("Ochilgan PR'larni ko'rib chiqib, birlashtiring (merge).");
  if (tasks.some((t) => t.status === 'failed')) todo.push("Xato bo'lgan vazifalarni ko'rib chiqing va qayta yuboring.");
  if (todo.length) lines.push('', 'Sizdan kerak:', ...todo.map((x) => `• ${x}`));
  return lines.join('\n');
}

async function runReport(id: string, t: any, profile: any): Promise<void> {
  const last: any = await AgentTask.findOne({ agentKey: REPORTER_KEY, status: 'done', _id: { $ne: id } }).sort({ createdAt: -1 }).select('createdAt').lean();
  const period = reportPeriod(t.text, Date.now(), last ? new Date(last.createdAt).getTime() : undefined);
  const from = new Date(period.from);
  const tasks: any[] = await AgentTask.find({ agentKey: { $ne: REPORTER_KEY }, $or: [{ createdAt: { $gte: from } }, { finishedAt: { $gte: from } }] })
    .sort({ createdAt: 1 }).limit(200).select('agentKey agentKind text status summary error links createdAt finishedAt').lean();
  const names = new Map((await AgentProfile.find({}).select('key name').lean()).map((p: any) => [p.key, p.name]));
  const plain = plainReport(tasks, names, period.label);
  const links = tasks.flatMap((x) => (x.links || []).filter((l: any) => /\/pull\//.test(l.url)).map((l: any) => ({ label: `${names.get(x.agentKey) || x.agentKey}: PR`, url: l.url }))).slice(0, 20);
  let summary = plain;
  let via = "AI'siz ro'yxat";
  if (tasks.length) {
    try {
      const out = await contentRunner(`${profile.systemPrompt || 'Sen Hisobotchi agentisan.'}
Quyidagi agent vazifalari bo'yicha egasi uchun ODDIY o'zbek tilida (lotin) hisobot yoz: qaysi agent nima qildi, holati, natija/PR havolalari, nima xato bo'ldi va nega, egasi keyin nima qilishi kerak. Qisqa, aniq, texnik so'zlarsiz.
Davr: ${period.label}. Buyruq: """${t.text}"""
Ma'lumot (JSON): ${JSON.stringify(tasks.map((x) => ({
    agent: names.get(x.agentKey) || x.agentKey, vazifa: String(x.text).slice(0, 300), holat: ST_UZ[x.status], xato: errUz(x.error) || undefined,
    xulosa: x.summary ? String(x.summary).slice(0, 400) : undefined, pr: (x.links || []).find((l: any) => /\/pull\//.test(l.url))?.url,
  })))}
FAQAT JSON qaytar: {"summary": "to'liq hisobot matni (qatorlar \\n bilan)"}`);
      const s = cleanText(out?.summary, 4000);
      if (s) { summary = s; via = 'AI'; }
    } catch { /* zaxira — tuzilgan ro'yxat */ }
  }
  await transition(id, ['running'], 'done', { summary, links }, `Hisobot tayyor (${via}, ${tasks.length} ta vazifa)`);
}

/** Boshqa agent vazifasi tugagach — 60 s kutib (yana tugaganlarini ham qo'shib) bitta avtomatik hisobot. */
function maybeAutoReport(finishedId: string): void {
  if (autoTimer) return;
  autoTimer = setTimeout(() => {
    autoTimer = null;
    background((async () => {
      const t: any = await AgentTask.findById(finishedId).select('agentKey').lean();
      if (!t || t.agentKey === REPORTER_KEY) return;
      const rep: any = await AgentProfile.findOne({ key: REPORTER_KEY }).lean();
      if (!rep?.enabled) return;
      if (await AgentTask.exists({ agentKey: REPORTER_KEY, status: { $in: AGENT_TASK_ACTIVE } })) return;
      await createTask(REPORTER_KEY, 'Avtomatik: yakunlangan vazifalar hisoboti', 'auto', { auto: true });
    })());
  }, AUTO_REPORT_DELAY_MS);
  autoTimer.unref?.();
}
/** Testlar: kutilayotgan avtomatik hisobotni darhol ishga tushirish. */
export async function __fireAutoReportForTests(): Promise<boolean> {
  if (!autoTimer) return false;
  const fn = (autoTimer as any)._onTimeout as (() => void) | undefined;
  clearTimeout(autoTimer);
  autoTimer = null;
  // _onTimeout ichida autoTimer=null qilinadi, so'ng fon ishi
  fn?.();
  await __drainAgentsForTests();
  return true;
}

// ───────────── Telegram'ga yuborish (faqat dasturchi bosganda) ─────────────
export async function sendTaskToTelegram(id: string, target: unknown, index: unknown, requesterId?: string): Promise<{ ok: boolean; error?: string; status?: number; sentTo?: 'channel' | 'developer' }> {
  if (!/^[0-9a-f]{24}$/i.test(id)) return { ok: false, error: 'not_found', status: 404 };
  const t: any = await AgentTask.findById(id).lean();
  if (!t) return { ok: false, error: 'not_found', status: 404 };
  if (t.status !== 'done') return { ok: false, error: 'not_done', status: 409 };
  const c = agentConfig();
  if (target !== 'channel' && target !== 'developer') return { ok: false, error: 'invalid', status: 400 };
  // Owner 2026-10-23: kanal ulangan bo'lsa (UI'dan — SMM sozlamalari, yoki env AGENT_TG_CHANNEL_ID) post DOIM kanalga;
  // kanal umuman yo'q bo'lsa — bosgan dasturchining o'z Telegram chatiga (javobda qayerga ketgani aytiladi)
  const ch = await channelConfig();
  let chat = target === 'channel' ? ch.chat : c.devChat;
  let sentTo: 'channel' | 'developer' = target === 'channel' && ch.chat ? 'channel' : 'developer';
  if (!chat || target === 'developer') {
    const own: any = requesterId && /^[0-9a-f]{24}$/i.test(requesterId) ? await User.findById(requesterId).select('telegramChatId').lean().catch(() => null) : null;
    if (!chat && own?.telegramChatId) chat = String(own.telegramChatId);
    if (target === 'channel' && !ch.chat) sentTo = 'developer';
  }
  // sozlanmagan — server xatosi emas (409), xatolar ro'yxatini to'ldirmasin
  if (!chat || !c.botToken) return { ok: false, error: 'not_configured', status: 409 };
  let item: { title?: string; text?: string; hashtags?: string[] };
  if (typeof index === 'number' && Number.isInteger(index)) {
    const it = t.items?.[index];
    if (!it) return { ok: false, error: 'invalid', status: 400 };
    item = { title: it.title, text: it.text, hashtags: it.hashtags };
  } else {
    item = { text: t.summary || '' };
  }
  if (!item.text) return { ok: false, error: 'empty', status: 400 };
  try {
    const url = SITE_BUTTON_URL();
    await tgSendPost({ token: c.botToken, chat, username: sentTo === 'channel' ? ch.username : undefined, item, files: [],
      ...(sentTo === 'channel' && ch.siteButton && typeof index === 'number' ? { button: { text: siteButtonLabel(url), url } } : {}) });
  } catch {
    return { ok: false, error: 'telegram_failed', status: 502 };
  }
  await AgentTask.updateOne({ _id: id }, { $push: { log: logLine(sentTo === 'channel' ? "Telegram kanalga yuborildi" : "Dasturchi chatiga yuborildi") } });
  return { ok: true, sentTo };
}

// ───────────── Suhbat (owner 2026-10-23): agent o'z ishi haqidagi savolga javob beradi ─────────────
/** Agent bilan erkin suhbat — buyruq emas (vazifa yaratilmaydi). Javob: 1–4 gap, savol tilida, agent nomidan. */
export async function chatWithAgent(key: string, rawText: unknown, rawHistory: unknown):
  Promise<{ ok: true; reply: string } | { ok: false; status: number; error: string }> {
  const text = typeof rawText === 'string' ? rawText.trim().slice(0, 2000) : '';
  if (!text) return { ok: false, status: 400, error: 'invalid' };
  await ensureDefaults();
  const p = await AgentProfile.findOne({ key }).lean();
  if (!p) return { ok: false, status: 404, error: 'agent_not_found' };
  if (!geminiConfigured() && contentRunner === defaultRunner) return { ok: false, status: 503, error: 'not_configured' };
  const history = (Array.isArray(rawHistory) ? rawHistory : []).slice(-8)
    .filter((h: any) => h && (h.role === 'me' || h.role === 'agent') && typeof h.text === 'string')
    .map((h: any) => `${h.role === 'me' ? 'Egasi' : p.name}: ${String(h.text).slice(0, 600)}`);
  const tasks = (await listTasks({ agentKey: key, limit: 5 }))
    .map((t) => `- [${t.status}] ${t.text.slice(0, 160)}${t.summary ? ` → ${t.summary.slice(0, 200)}` : ''}`);
  const prompt = [
    `Sen "${p.name}" agentisan (AI ofis xodimi). Roling: ${p.description || p.kind}.`,
    p.systemPrompt ? `Ish yo'riqnomang (qisqa): ${p.systemPrompt.slice(0, 1500)}` : '',
    tasks.length ? `So'nggi vazifalaring:\n${tasks.join('\n')}` : "Hozircha vazifang yo'q.",
    history.length ? `Suhbat tarixi:\n${history.join('\n')}` : '',
    `Egasi: ${text}`,
    "Egasi bilan jonli suhbatlashyapsan (ovoz bilan ham o'qiladi). Savol tilida (o'zbekcha bo'lsa lotin yozuvida, ruscha bo'lsa ruscha) " +
    "1–4 qisqa gap bilan, birinchi shaxsda, samimiy va aniq javob ber. Ish bajarilishi kerak bo'lsa — buni \"buyruq\" sifatida yuborishni taklif qil " +
    "(suhbatda hech narsa bajarilmaydi). Faqat JSON qaytar: {\"reply\": \"...\"}",
  ].filter(Boolean).join('\n\n');
  try {
    const out = await contentRunner(prompt);
    const reply = typeof out?.reply === 'string' ? out.reply.trim().slice(0, 1500) : '';
    if (!reply) return { ok: false, status: 502, error: 'empty' };
    return { ok: true, reply };
  } catch {
    return { ok: false, status: 502, error: 'ai_failed' };
  }
}
