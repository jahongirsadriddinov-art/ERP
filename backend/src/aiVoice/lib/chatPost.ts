import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Message from '../../models/Message';
import User from '../../models/User';
import { getBotInstance } from '../bot/instance';

// AI nomidan (foydalanuvchi aytgani bo'yicha) yuborilgan xabar — ODDIY CHAT XABARI sifatida (owner 2026-10-19:
// "yuboryapti, lekin ilovada chatda hech qayerda ko'rinmayapti, faqat botga kelyapti"). routes/messages.ts
// POST bilan bir xil natija: Message (DM) + socket 'message:new' (ikkala tomonga) + Telegram (bot) + bildirishnoma.
// Rasm/video — /uploads (yoki Cloudinary) URL bilan, chatda ochiladi. bot.ts/socket.ts modul darajasida
// import QILINMAYDI (aiVoice qoidasi) — socket/notifications/cloudinary kechiktirib yuklanadi.

export interface ChatMedia { data: Buffer; kind: 'photo' | 'video' }
export interface PostResult { ok: boolean; messageId?: string; telegram: boolean; mediaUrl?: string }

export async function storeMedia(m: ChatMedia): Promise<string | undefined> {
  const ext = m.kind === 'photo' ? '.jpg' : '.mp4';
  const dir = path.join(process.cwd(), 'uploads');
  const name = `ai-${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`;
  const file = path.join(dir, name);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(file, m.data);
    try {
      const { uploadFileToCloud, cloudinaryEnabled } = await import('../../config/cloudinary');
      if (cloudinaryEnabled) {
        const { url } = await uploadFileToCloud(file, 'qurilish-chat', name);
        fs.promises.unlink(file).catch(() => undefined);
        return url;
      }
    } catch { /* Cloudinary bo'lmasa — mahalliy */ }
    const { persistUploadedFile } = await import('../../services/durableFiles');
    await persistUploadedFile(file).catch(() => undefined);
    const { getBackendUrl } = await import('../../utils/backendUrl');
    return `${getBackendUrl()}/uploads/${name}`;
  } catch (e) {
    console.warn('[aiVoice/chatPost] media saqlanmadi:', (e as Error).message?.slice(0, 80));
    return undefined;
  }
}

/** fromUserId → toUserId shaxsiy chat xabari (ilova + Telegram). Hech qachon throw qilmaydi. */
export async function postChatDm(p: {
  companyId: string; fromUserId: string; toUserId: string; text?: string; media?: ChatMedia; mediaUrl?: string;
}): Promise<PostResult> {
  try {
    const [from, to]: any[] = await Promise.all([
      User.findOne({ _id: p.fromUserId, companyId: p.companyId }).select('firstName lastName').lean(),
      User.findOne({ _id: p.toUserId, companyId: p.companyId, isBlocked: { $ne: true } }).select('telegramChatId').lean(),
    ]);
    if (!from || !to) return { ok: false, telegram: false };
    const text = String(p.text || '').trim().slice(0, 2000);
    const mediaUrl = p.mediaUrl || (p.media ? await storeMedia(p.media) : undefined);
    const type = p.media ? (p.media.kind === 'photo' ? 'image' : 'video') : undefined;
    const msg: any = await Message.create({
      fromUserId: String(p.fromUserId), toUserId: String(p.toUserId), text, timestamp: new Date().toISOString(), read: false,
      ...(type && mediaUrl ? { type, mediaUrl } : {}), companyId: p.companyId,
    });
    const payload = { ...msg.toObject(), id: msg._id };
    try {
      const { emitToUser } = await import('../../services/socket');
      emitToUser(String(p.toUserId), 'message:new', payload);
      emitToUser(String(p.fromUserId), 'message:new', payload);
    } catch { /* socket yo'q (test) */ }

    const senderName = [from.firstName, from.lastName].filter(Boolean).join(' ').trim() || 'Foydalanuvchi';
    let telegram = false;
    const bot = getBotInstance();
    if (bot && to.telegramChatId) {
      const caption = `💬 ${senderName}${text ? `\n\n${text}` : ''}`.slice(0, 1000);
      try {
        if (p.media?.kind === 'photo' && bot.sendPhoto) await bot.sendPhoto(to.telegramChatId, p.media.data, { caption }, { filename: 'rasm.jpg', contentType: 'image/jpeg' });
        else if (p.media?.kind === 'video' && bot.sendVideo) await bot.sendVideo(to.telegramChatId, p.media.data, { caption }, { filename: 'video.mp4', contentType: 'video/mp4' });
        else await bot.sendMessage(to.telegramChatId, caption, { disable_web_page_preview: true });
        telegram = true;
      } catch (e) {
        console.warn('[aiVoice/chatPost] Telegram:', (e as Error).message?.slice(0, 80));
      }
    }
    try {
      const { createNotification } = await import('../../services/notifications');
      await createNotification({
        recipientId: String(p.toUserId), companyId: p.companyId, type: 'message', title: senderName,
        body: text || (p.media ? (p.media.kind === 'photo' ? '📷 Rasm' : '🎥 Video') : 'Yangi xabar'),
        entity: 'message', entityId: String(msg._id), url: '/chat',
      });
    } catch { /* bildirishnoma ixtiyoriy */ }
    return { ok: true, messageId: String(msg._id), telegram, mediaUrl };
  } catch (e) {
    console.warn('[aiVoice/chatPost] xabar yozilmadi:', (e as Error).message?.slice(0, 80));
    return { ok: false, telegram: false };
  }
}
