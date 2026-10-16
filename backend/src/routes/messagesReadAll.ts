import { Router } from 'express';
import Message from '../models/Message';
import Group from '../models/Group';
import { emitToUser } from '../services/socket';
import { scoped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';

// "Hammasini o'qildi qilish" — chaqiruvchiga kelgan barcha DM va u a'zo bo'lgan
// guruhlardagi (o'zinikidan boshqa) xabarlarni o'qildi qiladi. Faqat o'z firmasi
// doirasida (scoped) va faqat o'ziga tegishli xabarlar — boshqa birovniki emas.
const router = Router();

router.post('/', async (_req, res) => {
  try {
    const me = getTenant()?.userId;
    if (!me) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });

    // DM: qaysi suhbatdoshlardan o'qilmagan xabar bor — ularga read-receipt yuboramiz
    const dmFilter = scoped({ toUserId: String(me), read: false, deleted: { $ne: true } });
    const senders: string[] = (await Message.distinct('fromUserId', dmFilter)).map(String);
    const dm = await Message.updateMany(dmFilter, { $set: { read: true } });

    // Guruhlar: faqat a'zo bo'lgan guruhlar, o'z xabarlari emas
    const myGroups = await Group.find(scoped({ memberIds: String(me) })).select('_id').lean();
    const groupIds = myGroups.map((g: any) => String(g._id));
    let groupCount = 0;
    if (groupIds.length) {
      const r = await Message.updateMany(
        scoped({ groupId: { $in: groupIds }, fromUserId: { $ne: String(me) }, read: false }),
        { $set: { read: true } },
      );
      groupCount = r.modifiedCount || 0;
    }

    // Read-receipt: yuboruvchiga (ikki belgi) va o'zimning boshqa qurilmalarimga
    for (const from of senders) {
      const payload = { fromUserId: from, toUserId: String(me) };
      emitToUser(from, 'message:read', payload);
      emitToUser(String(me), 'message:read', payload);
    }

    res.json({ ok: true, dm: dm.modifiedCount || 0, groups: groupCount, senders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
