import AgentTask from '../../models/AgentTask';
import User from '../../models/User';
import { logAudit } from '../../services/audit';
import { itemDto } from '../agents/service';

// SMM post (AgentTask item) tahriri: matn/heshteg/format/slaydlar, qurilmadagi media metama'lumoti, tasdiq.

const ID_RE = /^[0-9a-f]{24}$/i;
const MEDIA_ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const MEDIA_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
const SOURCES = ['ai', 'template', 'upload', 'code', 'client'];
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : undefined);
const logLine = (text: string) => ({ at: new Date(), text: text.slice(0, 500) });

type R = { ok: true; item: ReturnType<typeof itemDto> } | { ok: false; status: number; error: string };

async function load(taskId: string, index: number): Promise<{ t: any; it: any } | { error: string; status: number }> {
  if (!ID_RE.test(taskId)) return { error: 'not_found', status: 404 };
  const t: any = await AgentTask.findById(taskId).lean();
  if (!t) return { error: 'not_found', status: 404 };
  if (!Number.isInteger(index) || !t.items?.[index]) return { error: 'invalid', status: 400 };
  if (t.status !== 'done') return { error: 'not_done', status: 409 };
  return { t, it: t.items[index] };
}

async function audit(by: string, action: 'update' | 'approve' | 'reject', entityId: string, description: string, req?: any, newValue?: unknown) {
  const u: any = ID_RE.test(by) ? await User.findById(by).select('firstName lastName role').lean().catch(() => null) : null;
  await logAudit({
    userId: by || 'system', userName: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Dasturchi', userRole: u?.role || 'dasturchi',
    action, entity: 'smm_post', entityId, description, newValue, req,
  }).catch(() => undefined);
}

async function reload(taskId: string, index: number): Promise<R> {
  const t: any = await AgentTask.findById(taskId).lean();
  return { ok: true, item: itemDto(t.items[index]) };
}

export async function editItem(taskId: string, index: number, b: Record<string, any>, by: string, req?: any): Promise<R> {
  const l = await load(taskId, index);
  if ('error' in l) return { ok: false, status: l.status, error: l.error };
  const set: Record<string, unknown> = {};
  const title = clean(b.title, 200);
  if (title !== undefined) set[`items.${index}.title`] = title;
  const text = clean(b.text, 4000);
  if (text !== undefined) {
    if (!text) return { ok: false, status: 400, error: 'invalid' };
    set[`items.${index}.text`] = text;
  }
  if (b.hashtags !== undefined) {
    const raw = Array.isArray(b.hashtags) ? b.hashtags : typeof b.hashtags === 'string' ? b.hashtags.split(/[\s,]+/) : null;
    if (!raw) return { ok: false, status: 400, error: 'invalid' };
    set[`items.${index}.hashtags`] = raw.filter((h: unknown) => typeof h === 'string' && h.trim())
      .map((h: string) => h.trim().replace(/^([^#])/, '#$1').slice(0, 60)).slice(0, 30);
  }
  if (b.format !== undefined) {
    if (!['post', 'carousel', 'reel', 'story'].includes(b.format)) return { ok: false, status: 400, error: 'invalid' };
    set[`items.${index}.format`] = b.format;
  }
  if (b.scenes !== undefined) {
    if (!Array.isArray(b.scenes)) return { ok: false, status: 400, error: 'invalid' };
    set[`items.${index}.scenes`] = b.scenes.slice(0, 8).map((s: any) => ({ title: clean(s?.title, 120) || '', text: clean(s?.text, 400) || '' }))
      .filter((s: { title: string; text: string }) => s.title || s.text);
  }
  if (!Object.keys(set).length) return { ok: false, status: 400, error: 'invalid' };
  await AgentTask.updateOne({ _id: taskId }, { $set: set, $push: { log: logLine('Post tahrirlandi') } });
  await audit(by, 'update', `${taskId}:${index}`, `SMM: post tahrirlandi — "${String(title ?? l.it.title).slice(0, 80)}"`, req, Object.keys(set));
  return reload(taskId, index);
}

/** Qurilmadagi (IndexedDB) fayllar metama'lumoti — faylning o'zi serverga kelmaydi. */
export async function setItemMedia(taskId: string, index: number, media: unknown): Promise<R> {
  const l = await load(taskId, index);
  if ('error' in l) return { ok: false, status: l.status, error: l.error };
  if (!Array.isArray(media) || media.length > 10) return { ok: false, status: 400, error: 'invalid' };
  const list = [];
  for (const m of media as any[]) {
    if (!m || !MEDIA_ID_RE.test(String(m.id)) || !['image', 'video'].includes(m.kind)) return { ok: false, status: 400, error: 'invalid' };
    list.push({
      id: String(m.id), kind: m.kind, ...(MEDIA_MIMES.includes(m.mime) ? { mime: m.mime } : {}),
      ...(Number.isInteger(m.w) && Number.isInteger(m.h) && m.w > 0 && m.w <= 8000 && m.h > 0 && m.h <= 8000 ? { w: m.w, h: m.h } : {}),
      ...(Number.isInteger(m.size) && m.size > 0 && m.size < 2e9 ? { size: m.size } : {}),
      ...(SOURCES.includes(m.source) ? { source: m.source } : {}), at: new Date(),
    });
  }
  await AgentTask.updateOne({ _id: taskId }, { $set: { [`items.${index}.media`]: list } });
  return reload(taskId, index);
}

export async function setApproval(taskId: string, index: number, decision: unknown, by: string, req?: any): Promise<R> {
  const l = await load(taskId, index);
  if ('error' in l) return { ok: false, status: l.status, error: l.error };
  if (decision !== 'approved' && decision !== 'rejected') return { ok: false, status: 400, error: 'invalid' };
  if (l.it.approval !== 'pending') return { ok: false, status: 409, error: 'not_pending' };
  await AgentTask.updateOne({ _id: taskId, [`items.${index}.approval`]: 'pending' }, {
    $set: { [`items.${index}.approval`]: decision },
    $push: { log: logLine(decision === 'approved' ? 'Egasi tasdiqladi' : 'Egasi rad etdi') },
  });
  await audit(by, decision === 'approved' ? 'approve' : 'reject', `${taskId}:${index}`, `SMM: post ${decision === 'approved' ? 'tasdiqlandi' : 'rad etildi'} — "${String(l.it.title || '').slice(0, 80)}"`, req);
  return reload(taskId, index);
}
