import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import Message from '../models/Message';
import Group from '../models/Group';
import User from '../models/User';
import { emitToUser, emitToGroup } from '../services/socket';
import { scoped, stamped } from '../middleware/scope';
import { bot } from '../services/bot';

const router = Router();

// Chat media uchun multer (asl kengaytmani saqlaydi)
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '';
    cb(null, `chat_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 60 * 1024 * 1024 } });

const shape = (m: any) => ({ ...m.toObject(), id: m._id });

// Media yuklash — server URL qaytaradi (blob emas, hamma ko'radi)
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fayl yuklanmadi' });
  res.json({
    url: `/uploads/${req.file.filename}`,
    fileName: req.file.originalname,
    fileSize: req.file.size,
  });
});

// Foydalanuvchi xabarlari: DM + a'zo bo'lgan guruhlar
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId kerak' });
    const uid = String(userId);
    const groups = await Group.find(scoped({ memberIds: uid })).select('_id');
    const groupIds = groups.map(g => String(g._id));
    const messages = await Message.find(scoped({
      $or: [
        { fromUserId: uid },
        { toUserId: uid },
        ...(groupIds.length ? [{ groupId: { $in: groupIds } }] : []),
      ],
    })).sort({ createdAt: 1 });
    res.json(messages.map(shape));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Xabar yuborish (DM yoki guruh) + real-time broadcast
router.post('/', async (req, res) => {
  try {
    const { fromUserId, toUserId, groupId, text, type, mediaUrl, fileName, fileSize, location, replyToId } = req.body;
    if (!fromUserId || (!toUserId && !groupId) || (!text?.trim() && !mediaUrl && !location)) {
      return res.status(400).json({ error: 'fromUserId, (toUserId yoki groupId) va text/media kerak' });
    }
    const msg = await Message.create(stamped({
      fromUserId: String(fromUserId),
      toUserId: toUserId ? String(toUserId) : '',
      ...(groupId && { groupId: String(groupId) }),
      text: (text || '').trim(),
      timestamp: new Date().toISOString(),
      read: false,
      ...(type && { type }),
      ...(mediaUrl && { mediaUrl }),
      ...(fileName && { fileName }),
      ...(fileSize != null && { fileSize }),
      ...(location && { location }),
      ...(replyToId && { replyToId }),
    }));
    const payload = shape(msg);
    if (groupId) emitToGroup(String(groupId), 'message:new', payload);
    else {
      emitToUser(String(toUserId), 'message:new', payload);
      emitToUser(String(fromUserId), 'message:new', payload);
      // Telegram notification (async, non-blocking)
      User.findById(String(toUserId)).then(async (recipient: any) => {
        if (!recipient?.telegramChatId) return;
        const sender = await User.findById(String(fromUserId)).catch(() => null);
        const senderName = sender ? `${sender.firstName} ${sender.lastName || ''}`.trim() : 'Foydalanuvchi';
        const preview = (text || '').trim() ? (text.trim().substring(0, 80) + (text.trim().length > 80 ? '…' : '')) : '📎 Fayl';
        await bot.sendMessage(recipient.telegramChatId,
          `💬 <b>${senderName}</b> xabar yubordi:\n\n${preview}\n\n<a href="${process.env.SITE_URL || 'http://localhost:5173'}">Saytda ko'rish</a>`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }).catch(() => {});
    }
    res.status(201).json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// O'qildi (MUHIM: '/:id' dan oldin bo'lishi shart)
router.patch('/read', async (req, res) => {
  try {
    const { fromUserId, toUserId } = req.body;
    await Message.updateMany(
      scoped({ fromUserId: String(fromUserId), toUserId: String(toUserId), read: false }),
      { $set: { read: true } }
    );
    emitToUser(String(fromUserId), 'message:read', { fromUserId: String(fromUserId), toUserId: String(toUserId) });
    res.json({ message: 'O\'qildi' });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Tahrirlash / pin — faqat direktor/o'rinbosar/dasturchi
router.patch('/:id', async (req, res) => {
  try {
    const u = req.user;
    if (u && !u.isDeveloper && u.role !== 'direktor' && u.role !== 'orinbosar') {
      return res.status(403).json({ error: 'Xabarni tahrirlash ruxsati yo\'q' });
    }
    const { text, pinned } = req.body;
    const msg = await Message.findOne(scoped({ _id: req.params.id }));
    if (!msg) return res.status(404).json({ error: 'Xabar topilmadi' });
    if (text !== undefined) { msg.text = String(text); msg.edited = true; }
    if (pinned !== undefined) msg.pinned = !!pinned;
    await msg.save();
    const payload = shape(msg);
    if (msg.groupId) emitToGroup(msg.groupId, 'message:edit', payload);
    else { emitToUser(msg.toUserId, 'message:edit', payload); emitToUser(msg.fromUserId, 'message:edit', payload); }
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// O'chirish (soft delete) — faqat direktor/o'rinbosar/dasturchi
router.delete('/:id', async (req, res) => {
  try {
    const u = req.user;
    if (u && !u.isDeveloper && u.role !== 'direktor' && u.role !== 'orinbosar') {
      return res.status(403).json({ error: 'Xabarni o\'chirish ruxsati yo\'q' });
    }
    const msg = await Message.findOne(scoped({ _id: req.params.id }));
    if (!msg) return res.status(404).json({ error: 'Xabar topilmadi' });
    msg.deleted = true;
    await msg.save();
    const payload = { id: String(msg._id), deleted: true };
    if (msg.groupId) emitToGroup(msg.groupId, 'message:delete', payload);
    else { emitToUser(msg.toUserId, 'message:delete', payload); emitToUser(msg.fromUserId, 'message:delete', payload); }
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
