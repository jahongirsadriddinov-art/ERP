import AgentTask from '../../models/AgentTask';
import { SmmInsight } from '../../models/Smm';
import { zonedParts } from '../lib/zonedTime';
import { IgError, igAccountInsights, igConfigured, igMediaInsights } from './instagram';

// SMM statistikasi (owner 2026-10-23): e'lon qilingan Instagram media va akkaunt ko'rsatkichlari har 6 soatda (va so'rov
// bo'yicha) olinadi, tarix sifatida saqlanadi (SmmInsight). Telegram: bot API kanal post ko'rishlarini bermaydi.

const DAY = 86_400_000;
const NUM_KEYS = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'replies', 'total_interactions'] as const;

interface Published { taskId: string; index: number; title: string; kind: string; mediaId: string; url?: string; at: Date; format?: string; category?: string }

async function publishedItems(sinceMs: number): Promise<Published[]> {
  const rows: any[] = await AgentTask.find({ 'items.ig.status': 'published' }).select('items').sort({ createdAt: -1 }).limit(300).lean();
  const out: Published[] = [];
  for (const r of rows) {
    (r.items || []).forEach((it: any, index: number) => {
      const ig = it?.ig;
      if (ig?.status === 'published' && ig.mediaId && ig.at && new Date(ig.at).getTime() >= sinceMs) {
        out.push({ taskId: String(r._id), index, title: it.title || it.topic || '', kind: ig.kind || it.format || 'post', mediaId: ig.mediaId, url: ig.url, at: new Date(ig.at), format: it.format, category: it.category });
      }
    });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Instagram'dan yangi ko'rsatkichlarni olish (90 kun ichidagi ko'pi bilan 60 ta media + akkaunt). */
export async function refreshInsights(now = new Date()): Promise<{ ok: boolean; media: number; error?: string }> {
  if (!igConfigured()) return { ok: false, media: 0, error: 'ig_not_configured' };
  const items = (await publishedItems(now.getTime() - 90 * DAY)).slice(0, 60);
  let n = 0;
  try {
    for (const p of items) {
      // Story statistikasi faqat 24 soat ichida mavjud
      if (p.kind === 'story' && now.getTime() - p.at.getTime() > DAY) continue;
      try {
        const metrics = await igMediaInsights(p.mediaId, p.kind);
        if (Object.keys(metrics).length) {
          await SmmInsight.create({ scope: 'media', mediaId: p.mediaId, taskId: p.taskId, index: p.index, kind: p.kind, at: now, metrics });
          n++;
        }
      } catch (e) {
        if ((e as IgError).code === 'ig_token_invalid' || (e as IgError).code === 'ig_rate_limited') throw e;
      }
    }
    const acc = await igAccountInsights();
    await SmmInsight.create({ scope: 'account', at: now, metrics: acc });
    return { ok: true, media: n };
  } catch (e) {
    return { ok: false, media: n, error: e instanceof IgError ? e.code : 'ig_failed' };
  }
}

const engagementOf = (m: Record<string, number>) =>
  m.total_interactions ?? ((m.likes || 0) + (m.comments || 0) + (m.saved || 0) + (m.shares || 0) + (m.replies || 0));

/** Panel uchun: jami, har post (eng yaxshisi tepada), vaqt bo'yicha akkaunt, format/soat bo'yicha xulosa. */
export async function analyticsSummary(now = new Date()) {
  const items = await publishedItems(now.getTime() - 180 * DAY);
  const ids = items.map((p) => p.mediaId);
  const latest = new Map<string, { at: Date; metrics: Record<string, number> }>();
  if (ids.length) {
    const rows: any[] = await SmmInsight.aggregate([
      { $match: { scope: 'media', mediaId: { $in: ids } } },
      { $sort: { at: -1 } },
      { $group: { _id: '$mediaId', at: { $first: '$at' }, metrics: { $first: '$metrics' } } },
    ]);
    for (const r of rows) latest.set(r._id, { at: r.at, metrics: r.metrics || {} });
  }
  const posts = items.map((p) => {
    const m = latest.get(p.mediaId)?.metrics || {};
    return {
      taskId: p.taskId, index: p.index, title: p.title, kind: p.kind, url: p.url, publishedAt: p.at.toISOString(),
      metrics: m, engagement: engagementOf(m), reach: m.reach || 0, updatedAt: latest.get(p.mediaId)?.at?.toISOString(),
    };
  }).sort((a, b) => (b.engagement - a.engagement) || (b.reach - a.reach));
  const totals: Record<string, number> = { posts: posts.length };
  for (const k of NUM_KEYS) totals[k] = posts.reduce((s, p) => s + (Number(p.metrics[k]) || 0), 0);

  const acc: any[] = await SmmInsight.find({ scope: 'account', at: { $gte: new Date(now.getTime() - 90 * DAY) } }).sort({ at: 1 }).limit(400).lean();
  const byDay = new Map<string, any>();
  for (const a of acc) byDay.set(zonedParts(new Date(a.at)).date, { date: zonedParts(new Date(a.at)).date, ...a.metrics });
  const account = {
    history: [...byDay.values()].map((d) => ({ date: d.date, followers: d.followers ?? null, reach: d.reach ?? null, profileViews: d.profile_views ?? null, views: d.views ?? null })),
    latest: acc.length ? acc[acc.length - 1].metrics : null,
  };

  const group = (key: (p: typeof posts[number]) => string | number) => {
    const g = new Map<string | number, { n: number; eng: number; reach: number }>();
    for (const p of posts) {
      if (!p.updatedAt) continue;
      const k = key(p);
      const v = g.get(k) || { n: 0, eng: 0, reach: 0 };
      v.n++; v.eng += p.engagement; v.reach += p.reach;
      g.set(k, v);
    }
    return [...g.entries()].map(([k, v]) => ({ key: k, n: v.n, avgEngagement: Math.round((v.eng / v.n) * 10) / 10, avgReach: Math.round(v.reach / v.n) }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement);
  };
  const byFormat = group((p) => p.kind);
  const byHour = group((p) => zonedParts(new Date(p.publishedAt)).hour);
  const lastAt = posts.map((p) => p.updatedAt).filter(Boolean).sort().pop() || (acc.length ? new Date(acc[acc.length - 1].at).toISOString() : undefined);

  const tgSent = await AgentTask.countDocuments({ 'items.tg.status': 'published' });
  return {
    configured: igConfigured(), updatedAt: lastAt, totals, posts: posts.slice(0, 100), account, byFormat, byHour,
    best: { format: byFormat[0]?.key ?? null, hour: byHour[0]?.key ?? null },
    telegram: { sent: tgSent, viewsAvailable: false },
  };
}
