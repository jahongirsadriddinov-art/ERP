import { Router } from 'express';
import Announcement from '../models/Announcement';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { requireOwnerOrAdmin } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { sendPushToUser } from '../services/push';
import { emitToCompany, broadcast } from '../services/socket';
import { bot } from '../services/bot';
import { getBackendUrl } from '../utils/backendUrl';

const router = Router();

// Telegram HTML rejimida foydalanuvchi matni `<`/`&` bilan buzmasligi uchun.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Biriktirilgan media FAQAT bizning o'z backend'imiz orqali yuklangan bo'lishi
// shart (chat yuklash yo'li /api/messages/upload) — aks holda ixtiyoriy
// tashqi (zararli) havolani e'longa qo'yib, hammaga ko'rsatish mumkin edi.
function isOwnMediaUrl(url: string): boolean {
  try {
    return new URL(url).hostname === new URL(getBackendUrl()).hostname;
  } catch {
    return false;
  }
}

// Kelgan maydonlarni tekshirib, saqlashga tayyor obyekt qaytaradi (yoki xato matni).
function parseAnnouncementBody(body: any): { data?: any; error?: string } {
  const { title, body: text, mediaUrl, mediaType, location, minViewSeconds } = body || {};
  if (!title || !String(title).trim()) return { error: 'Sarlavha kerak' };
  if (!text || !String(text).trim()) return { error: 'Matn kerak' };
  const data: any = {
    title: String(title).trim().slice(0, 200),
    body: String(text).trim().slice(0, 4000),
    minViewSeconds: Math.min(60, Math.max(2, Math.round(Number(minViewSeconds) || 2))),
  };
  if (mediaUrl) {
    if (typeof mediaUrl !== 'string' || !isOwnMediaUrl(mediaUrl)) return { error: "Media manzili noto'g'ri" };
    if (!['image', 'video'].includes(mediaType)) return { error: "Media turi noto'g'ri" };
    data.mediaUrl = mediaUrl;
    data.mediaType = mediaType;
  }
  if (location) {
    const lat = Number(location.lat), lng = Number(location.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "Lokatsiya noto'g'ri" };
    const label = typeof location.label === 'string' ? location.label.trim().slice(0, 200) : '';
    data.location = label ? { lat, lng, label } : { lat, lng };
  }
  return { data };
}

const shapeFor = (uid: string) => (a: any) => {
  const { seenBy, ...rest } = a;
  return { ...rest, id: a._id, seen: (seenBy || []).includes(uid) };
};

// Ko'rish — BARCHA xodim (e'lon hammaga mo'ljallangan): o'z firmasining e'lonlari
// + dasturchi yuborgan global e'lonlar. Yozish/o'chirish — faqat direktor/o'rinbosar.
router.get('/', async (req, res) => {
  try {
    const uid = String(getTenant()?.userId || '');
    const list = await Announcement.find({ $or: [scoped(), { isGlobal: true }] }).sort({ createdAt: -1 }).limit(200).lean();
    res.json(list.map(shapeFor(uid)));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Joriy foydalanuvchi e'lonni ko'rdi — keyingi safar avtomatik ochilmaydi.
router.post('/:id/seen', async (req, res) => {
  try {
    const uid = String(getTenant()?.userId || '');
    if (!uid) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    await Announcement.updateOne({ _id: req.params.id, $or: [scoped(), { isGlobal: true }] }, { $addToSet: { seenBy: uid } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.post('/', requireOwnerOrAdmin, async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const parsed = parseAnnouncementBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const actor = await User.findById(t.userId).lean().catch(() => null);
    if (!actor) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    const ann = await Announcement.create(stamped({
      ...parsed.data,
      seenBy: [String(t.userId)], // muallifning o'ziga qayta ko'rsatilmaydi
      postedBy: { userId: t.userId, name: `${actor.firstName} ${actor.lastName || ''}`.trim(), role: actor.role },
    }));

    // Hammaga (o'zidan tashqari) push + Telegram bot — e'lon "javob kerak
    // emas" bo'lsa ham, xodim buni DARHOL bilishi kerak.
    const teammates = await User.find(scoped({ _id: { $ne: t.userId } })).select('_id telegramChatId').lean();
    for (const u of teammates) {
      sendPushToUser(String(u._id), { title: `📢 ${ann.title}`, body: ann.body.slice(0, 120), tag: 'announcement' }).catch(() => {});
      if (u.telegramChatId) {
        bot.sendMessage(u.telegramChatId, `📢 <b>${esc(ann.title)}</b>\n\n${esc(ann.body)}`, { parse_mode: 'HTML' }).catch(() => {});
      }
    }
    // Ochiq sessiyalarda darhol popup chiqishi uchun.
    emitToCompany(t.companyId, 'announcement:new', { id: String(ann._id) });

    await logAudit({
      userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
      action: 'create', entity: 'announcement', entityId: String(ann._id),
      description: `E'lon joylandi: "${ann.title}"`, companyId: t.companyId, req,
    });

    res.status(201).json({ ...ann.toObject(), seenBy: undefined, id: ann._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.delete('/:id', requireOwnerOrAdmin, async (req, res) => {
  try {
    // Global e'lonlar (isGlobal) firma admini tomonidan O'CHIRILMAYDI — scoped()
    // faqat o'z firmasining yozuvlariga mos keladi, global'ga emas.
    const ann = await Announcement.findOneAndDelete(scoped({ _id: req.params.id }));
    if (!ann) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ── Dasturchi (super-admin) — BARCHA firmalarga global e'lon ────────────────
// /api/dev-announcements sifatida ulanadi (index.ts) — requireAuth +
// requireDeveloper bilan. Firma-ichki /api/announcements yo'li esa
// blockDeveloper ostida qoladi (dasturchi firma ma'lumotiga kirmaydi).
export const devRouter = Router();

devRouter.get('/', async (_req, res) => {
  try {
    const list = await Announcement.find({ isGlobal: true }).sort({ createdAt: -1 }).limit(100).select('-seenBy').lean();
    res.json(list.map(a => ({ ...a, id: a._id })));
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

devRouter.post('/', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const parsed = parseAnnouncementBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const actor = await User.findById(t.userId).lean().catch(() => null);

    const ann = await Announcement.create({
      ...parsed.data,
      isGlobal: true,
      seenBy: [],
      postedBy: { userId: t.userId, name: actor ? `${actor.firstName} ${actor.lastName || ''}`.trim() : 'Dasturchi', role: 'dasturchi' },
    });

    const everyone = await User.find({ role: { $ne: 'dasturchi' } }).select('_id telegramChatId').lean();
    for (const u of everyone) {
      sendPushToUser(String(u._id), { title: `📢 ${ann.title}`, body: ann.body.slice(0, 120), tag: 'announcement' }).catch(() => {});
      if (u.telegramChatId) {
        bot.sendMessage(u.telegramChatId, `📢 <b>${esc(ann.title)}</b>\n\n${esc(ann.body)}`, { parse_mode: 'HTML' }).catch(() => {});
      }
    }
    broadcast('announcement:new', { id: String(ann._id) });
    res.status(201).json({ ...ann.toObject(), seenBy: undefined, id: ann._id });
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

devRouter.delete('/:id', async (req, res) => {
  try {
    const ann = await Announcement.findOneAndDelete({ _id: req.params.id, isGlobal: true });
    if (!ann) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
