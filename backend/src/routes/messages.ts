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

// Saytdan yuborilgan xabarni Telegramga TO'LIQ ko'rinishda (matn EMAS, haqiqiy
// rasm/video/ovoz/fayl/lokatsiya sifatida) qayta jo'natadi — mediaUrl allaqachon
// ochiq /uploads orqali xizmat qilinayotgani uchun qayta yuklab olish shart emas,
// Telegram Bot API to'g'ridan-to'g'ri URL qabul qiladi.
async function relayMessageToTelegram(chatId: string, senderName: string, m: {
  text?: string; type?: string; mediaUrl?: string; location?: { lat: number; lng: number };
}) {
  try {
    const caption = `💬 ${senderName}` + (m.text?.trim() ? `\n\n${m.text.trim()}` : '');
    switch (m.type) {
      case 'image':
        await bot.sendPhoto(chatId, m.mediaUrl, { caption });
        break;
      case 'video':
        await bot.sendVideo(chatId, m.mediaUrl, { caption });
        break;
      case 'audio':
        // Telegram sendVoice FAQAT haqiqiy OGG/Opus faylni "ovozli xabar" pufakchasi
        // sifatida ochadi — brauzerlarning aksariyati (Chrome) MediaRecorder orqali
        // audio/webm chiqaradi, buni sendVoice bilan yuborish "telefon ocholmaydi"
        // xatosiga olib keladi. .ogg bo'lmasa sendDocument bilan yuboramiz — bu
        // istalgan formatni qabul qiladi va foydalanuvchi qurilmasida ochiladi.
        if (/\.ogg(\?|$)/i.test(m.mediaUrl || '')) {
          await bot.sendVoice(chatId, m.mediaUrl, { caption: senderName });
        } else {
          await bot.sendDocument(chatId, m.mediaUrl, { caption: `🎤 ${caption}` });
        }
        break;
      case 'file':
        await bot.sendDocument(chatId, m.mediaUrl, { caption });
        break;
      case 'location':
        if (m.location) {
          await bot.sendMessage(chatId, `💬 <b>${senderName}</b> lokatsiya yubordi:`, { parse_mode: 'HTML' });
          await bot.sendLocation(chatId, m.location.lat, m.location.lng);
        }
        break;
      default:
        await bot.sendMessage(chatId, `💬 <b>${senderName}</b>:\n\n${m.text?.trim() || ''}`, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('[telegram relay]', err);
  }
}

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
    let msgData: any = stamped({
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
    });
    if (groupId) {
      // Guruh xabari uchun companyId GURUHning o'zidan olinishi kerak — masalan
      // dasturchi (o'z companyId'i yo'q) biror firmaning dev-support guruhiga
      // yozganda, stamped() hech narsa qo'shmaydi va xabar keyin scoped() bilan
      // topilmay qoladi. Guruhning companyId'i har doim to'g'ri tenant.
      const group = await Group.findById(String(groupId)).select('companyId').lean();
      if (group?.companyId) msgData = { ...msgData, companyId: group.companyId };
    }
    const msg = await Message.create(msgData);
    const payload = shape(msg);
    if (groupId) {
      emitToGroup(String(groupId), 'message:new', payload);
      // Telegram relay — guruhning HAR BIR a'zosiga (yuboruvchidan tashqari)
      Group.findById(String(groupId)).then(async (group: any) => {
        if (!group) return;
        const sender = await User.findById(String(fromUserId)).catch(() => null);
        const senderName = sender ? `${sender.firstName} ${sender.lastName || ''}`.trim() : 'Foydalanuvchi';
        const memberIds = (group.memberIds || []).filter((id: string) => id !== String(fromUserId));
        const members = await User.find({ _id: { $in: memberIds } }).select('telegramChatId').lean();
        for (const m of members) {
          if (m.telegramChatId) await relayMessageToTelegram(m.telegramChatId, `${senderName} (${group.name})`, { text, type, mediaUrl, location });
        }
      }).catch(console.error);
    } else {
      emitToUser(String(toUserId), 'message:new', payload);
      emitToUser(String(fromUserId), 'message:new', payload);
      // Telegram relay (async, non-blocking) — haqiqiy media sifatida
      User.findById(String(toUserId)).then(async (recipient: any) => {
        if (!recipient?.telegramChatId) return;
        const sender = await User.findById(String(fromUserId)).catch(() => null);
        const senderName = sender ? `${sender.firstName} ${sender.lastName || ''}`.trim() : 'Foydalanuvchi';
        await relayMessageToTelegram(recipient.telegramChatId, senderName, { text, type, mediaUrl, location });
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
