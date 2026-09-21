import { Router } from 'express';
import Announcement from '../models/Announcement';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { requireOwnerOrAdmin } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { sendPushToUser } from '../services/push';
import { bot } from '../services/bot';

const router = Router();

// Ko'rish — BARCHA xodim (e'lon hammaga mo'ljallangan). Yozish/o'chirish —
// faqat direktor/o'rinbosar.
router.get('/', async (req, res) => {
  try {
    const list = await Announcement.find(scoped()).sort({ createdAt: -1 }).limit(200).lean();
    res.json(list.map(a => ({ ...a, id: a._id })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.post('/', requireOwnerOrAdmin, async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { title, body } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Sarlavha kerak' });
    if (!body || !String(body).trim()) return res.status(400).json({ error: "Matn kerak" });

    const actor = await User.findById(t.userId).lean().catch(() => null);
    if (!actor) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    const ann = await Announcement.create(stamped({
      title: String(title).trim().slice(0, 200),
      body: String(body).trim().slice(0, 4000),
      postedBy: { userId: t.userId, name: `${actor.firstName} ${actor.lastName || ''}`.trim(), role: actor.role },
    }));

    // Hammaga (o'zidan tashqari) push bildirishnoma — e'lon "javob kerak
    // emas" bo'lsa ham, xodim buni DARHOL bilishi kerak (ProjectMedia/
    // SafetyIncident'dagi bir xil naqsh). Ilova ochiq bo'lmagan xodimlar
    // buni ko'rmasligi mumkin edi — shu sabab Telegram botiga ham (agar
    // xodim botni ulagan bo'lsa) bir xil xabar yuboriladi (messages.ts'dagi
    // relay bilan bir xil naqsh).
    const teammates = await User.find(scoped({ _id: { $ne: t.userId } })).select('_id telegramChatId').lean();
    for (const u of teammates) {
      sendPushToUser(String(u._id), { title: `📢 ${ann.title}`, body: ann.body.slice(0, 120), tag: 'announcement' }).catch(() => {});
      if (u.telegramChatId) {
        bot.sendMessage(u.telegramChatId, `📢 <b>${ann.title}</b>\n\n${ann.body}`, { parse_mode: 'HTML' }).catch(() => {});
      }
    }

    await logAudit({
      userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
      action: 'create', entity: 'announcement', entityId: String(ann._id),
      description: `E'lon joylandi: "${ann.title}"`, companyId: t.companyId, req,
    });

    res.status(201).json({ ...ann.toObject(), id: ann._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.delete('/:id', requireOwnerOrAdmin, async (req, res) => {
  try {
    const ann = await Announcement.findOneAndDelete(scoped({ _id: req.params.id }));
    if (!ann) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
