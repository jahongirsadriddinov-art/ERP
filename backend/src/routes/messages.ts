import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import Message from '../models/Message';
import Group from '../models/Group';
import User from '../models/User';
import { emitToUser, emitToGroup } from '../services/socket';
import { scoped, stamped } from '../middleware/scope';
import { requireAuth } from '../middleware/auth';
import { getTenant } from '../middleware/tenantContext';
import { bot } from '../services/bot';
import { uploadFileToCloud } from '../config/cloudinary';
import { getBackendUrl } from '../utils/backendUrl';
import { createNotification } from '../services/notifications';
import { checkRate } from '../utils/rateLimit';
import { persistUploadedFile } from '../services/durableFiles';
import { logAudit } from '../services/audit';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

// Berilgan /uploads media URL'ini shu serverdagi haqiqiy fayl yo'liga aylantiradi
// (faqat shu backend o'zi yozgan fayllar uchun ishlaydi — masalan CDN'dan kelgan
// tashqi URL emas). ffmpeg fayl bilan to'g'ridan-to'g'ri ishlashi uchun kerak.
function mediaUrlToLocalPath(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/\/uploads\//.test(u.pathname)) return null;
    const full = path.join(process.cwd(), 'uploads', path.basename(u.pathname));
    return fs.existsSync(full) ? full : null;
  } catch {
    return null;
  }
}

// XAVFSIZLIK TUZATILDI (security-review topilmasi — SSRF): pastki
// `resolveMediaFile` avval `mediaUrl` (POST /api/messages'da ISTALGAN
// autentifikatsiyalangan xodim — hatto oddiy ishchi ham — o'zi kiritadigan
// qiymat) qanday host bo'lishidan qat'i nazar to'g'ridan-to'g'ri
// `fetch(url)` qilardi. Bu backend'ning O'ZINI ichki tarmoq/bulut metama'lumot
// manzillariga (masalan 169.254.169.254) so'rov yuborishga majburlash uchun
// ishlatilishi mumkin edi (SSRF). Endi FAQAT bizning O'ZIMIZ backend'imizga
// tegishli URL'lar yuklab olinadi (objects.ts'dagi isOwnMediaUrl bilan bir
// xil naqsh) — bizning /api/files/proxy yo'limiz o'zi Cloudinary'ga
// cheklangan (SSRF-himoyalangan), shu sabab bu yetarli.
function isOwnBackendUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const own = new URL(getBackendUrl());
    return u.hostname === own.hostname;
  } catch {
    return false;
  }
}

// XATO TUZATILDI ("ovozli xabarlar/video xom webm bo'lib Telegram'ga
// ketyapti"): pastdagi convertToOggOpus/convertToMp4 FAQAT mahalliy fayl
// yo'li bilan ishlaydi, lekin production'da media DEYARLI HAR DOIM
// Cloudinary'ga yuklanadi (yuqoridagi `uploadFileToCloud`, mahalliy
// /uploads/ FAQAT Cloudinary ishlamay qolganda zaxira) — shu sabab
// `mediaUrlToLocalPath` deyarli har doim `null` qaytarib, konvertatsiya
// HECH QACHON ishga tushmas, xabar xom formatda (`sendDocument`/xom
// `sendVideo`) ketaverar edi. Endi mahalliy fayl topilmasa, URL vaqtincha
// yuklab olinadi — ffmpeg URL bilan emas, FAYL bilan ishlaydi.
async function resolveMediaFile(url?: string): Promise<{ path: string; temp: boolean } | null> {
  if (!url) return null;
  const local = mediaUrlToLocalPath(url);
  if (local) return { path: local, temp: false };
  if (!isOwnBackendUrl(url)) return null; // tashqi/ishonchsiz host — yuklab olinmaydi (SSRF himoyasi)
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ext = path.extname(new URL(url).pathname) || '';
    const tmpPath = path.join(os.tmpdir(), `dl_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
    fs.writeFileSync(tmpPath, Buffer.from(await r.arrayBuffer()));
    return { path: tmpPath, temp: true };
  } catch (err) {
    console.error('[media download]', err);
    return null;
  }
}

// Brauzerda yozilgan audio/webm'ni haqiqiy OGG/Opus'ga aylantiradi — Telegram
// sendVoice buni "ovozli xabar" pufakchasi sifatida to'g'ri ochadi (webm'ni
// sendDocument bilan yuborish faylni ochadi, lekin native ovozli xabar ko'rinishida
// EMAS — foydalanuvchi buni "xunuk"/"yaroqsiz" deb topdi).
function convertToOggOpus(localPath: string): Promise<string> {
  const outPath = path.join(os.tmpdir(), `voice_${Date.now()}_${Math.round(Math.random() * 1e6)}.ogg`);
  return new Promise((resolve, reject) => {
    ffmpeg(localPath)
      .audioCodec('libopus')
      .audioBitrate('48k')
      .audioChannels(1)
      .format('ogg')
      .on('error', reject)
      .on('end', () => resolve(outPath))
      .save(outPath);
  });
}

// Saytdan kelgan video ixtiyoriy formatda bo'lishi mumkin (brauzer/kamera/galereya —
// webm, mov/HEVC, mkv va h.k.). Telegram bunday fayllar uchun ko'pincha preview
// thumbnail generatsiya qila olmay, video o'rniga yagona rangli (ko'k/binafsha)
// to'rtburchak ko'rsatadi ("mov bo'lib qolyapti" muammosi). Voice xabar uchun
// qilingan OGG/Opus konvertatsiyasi bilan bir xil mantiq — har doim H.264/AAC
// MP4'ga aylantirib yuboramiz, shunda Telegram har doim to'g'ri thumbnail va
// pleer bilan ochadi.
function convertToMp4(localPath: string): Promise<string> {
  const outPath = path.join(os.tmpdir(), `vid_${Date.now()}_${Math.round(Math.random() * 1e6)}.mp4`);
  return new Promise((resolve, reject) => {
    ffmpeg(localPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart', '-preset veryfast'])
      .format('mp4')
      .on('error', reject)
      .on('end', () => resolve(outPath))
      .save(outPath);
  });
}

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

/** Chat xabaridagi media havolasi: o'z backend domenimiz yoki o'z Cloudinary hisobimiz, faqat http(s). */
export function isAllowedMediaUrl(v: unknown): boolean {
  if (typeof v !== 'string' || v.length > 2000) return false;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return false;
    if (u.hostname === new URL(getBackendUrl()).hostname) return true;
    if (u.hostname === 'res.cloudinary.com') {
      const cloud = process.env.CLOUDINARY_CLOUD_NAME;
      return !cloud || u.pathname.startsWith(`/${cloud}/`);
    }
    return false;
  } catch { return false; }
}

const shape = (m: any) => ({ ...m.toObject(), id: m._id });

// XAVFSIZLIK (audit 2026-10-22): HTML rejimidagi bot xabarida foydalanuvchi matni/ismi escape qilinadi —
// aks holda xodim rasmiy bot nomidan soxta havola (<a href>) yoki buzuq teg (xabar umuman yetmaydi) yubora olardi.
const escHtml = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Saytdan yuborilgan xabarni Telegramga TO'LIQ ko'rinishda (matn EMAS, haqiqiy
// rasm/video/ovoz/fayl/lokatsiya sifatida) qayta jo'natadi — mediaUrl allaqachon
// ochiq /uploads orqali xizmat qilinayotgani uchun qayta yuklab olish shart emas,
// Telegram Bot API to'g'ridan-to'g'ri URL qabul qiladi.
export async function relayMessageToTelegram(chatId: string, senderName: string, m: {
  text?: string; type?: string; mediaUrl?: string; location?: { lat: number; lng: number };
}) {
  try {
    const caption = `💬 ${senderName}` + (m.text?.trim() ? `\n\n${m.text.trim()}` : '');
    switch (m.type) {
      case 'image':
        await bot.sendPhoto(chatId, m.mediaUrl, { caption });
        break;
      case 'video': {
        const isMp4 = /\.mp4(\?|$)/i.test(m.mediaUrl || '');
        if (isMp4) {
          await bot.sendVideo(chatId, m.mediaUrl, { caption });
        } else {
          const src = await resolveMediaFile(m.mediaUrl);
          if (src) {
            let convertedVid: string | null = null;
            try {
              convertedVid = await convertToMp4(src.path);
              // fileOptions.contentType aniq ko'rsatilmasa, node-telegram-bot-api
              // kelajakda "application/octet-stream"ga default qiladi (deprecation
              // warning Render log'ida ko'rinib turgan edi) — convertToMp4 doim
              // haqiqiy .mp4 chiqaradi, shuning uchun aniq belgilaymiz.
              await bot.sendVideo(chatId, fs.createReadStream(convertedVid), { caption }, { contentType: 'video/mp4' });
            } catch (err) {
              console.error('[video transcode]', err);
              await bot.sendVideo(chatId, m.mediaUrl, { caption }).catch(() => bot.sendDocument(chatId, m.mediaUrl!, { caption }));
            } finally {
              if (convertedVid) fs.unlink(convertedVid, () => {});
              if (src.temp) fs.unlink(src.path, () => {});
            }
          } else {
            await bot.sendVideo(chatId, m.mediaUrl, { caption });
          }
        }
        break;
      }
      case 'audio': {
        // Telegram sendVoice FAQAT haqiqiy OGG/Opus faylni "ovozli xabar" pufakchasi
        // sifatida ochadi — brauzerlarning aksariyati (Chrome) MediaRecorder orqali
        // audio/webm chiqaradi. Buni to'g'ridan-to'g'ri sendDocument bilan yuborish
        // "ishlaydi" lekin native ovozli xabar EMAS, oddiy yuklab olinadigan fayl —
        // shuning uchun haqiqiy OGG/Opus'ga aylantirib, haqiqiy voice bubble sifatida
        // yuboramiz. Faqat ffmpeg muvaffaqiyatsiz bo'lsa (masalan mahalliy fayl
        // topilmasa) hujjat sifatida zaxira yo'l bilan yuboriladi.
        const isOgg = /\.ogg(\?|$)/i.test(m.mediaUrl || '');
        if (isOgg) {
          await bot.sendVoice(chatId, m.mediaUrl, { caption: senderName });
        } else {
          const src = await resolveMediaFile(m.mediaUrl);
          if (src) {
            let converted: string | null = null;
            try {
              converted = await convertToOggOpus(src.path);
              // Xuddi shu sabab bilan — convertToOggOpus doim haqiqiy OGG/Opus chiqaradi.
              await bot.sendVoice(chatId, fs.createReadStream(converted), { caption: senderName }, { contentType: 'audio/ogg' });
            } catch (err) {
              console.error('[voice transcode]', err);
              await bot.sendDocument(chatId, m.mediaUrl, { caption: `🎤 ${caption}` });
            } finally {
              if (converted) fs.unlink(converted, () => {});
              if (src.temp) fs.unlink(src.path, () => {});
            }
          } else {
            await bot.sendDocument(chatId, m.mediaUrl, { caption: `🎤 ${caption}` });
          }
        }
        break;
      }
      case 'file':
        await bot.sendDocument(chatId, m.mediaUrl, { caption });
        break;
      case 'location':
        if (m.location) {
          await bot.sendMessage(chatId, `💬 <b>${escHtml(senderName)}</b> lokatsiya yubordi:`, { parse_mode: 'HTML' });
          await bot.sendLocation(chatId, m.location.lat, m.location.lng);
        }
        break;
      default:
        await bot.sendMessage(chatId, `💬 <b>${escHtml(senderName)}</b>:\n\n${escHtml(m.text?.trim() || '')}`, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('[telegram relay]', err);
  }
}

// Media yuklash — Cloudinary mavjud bo'lsa shunga, yo'q bo'lsa localga.
// XAVFSIZLIK: avval bu yo'lda HECH QANDAY autentifikatsiya tekshiruvi yo'q
// edi — istalgan kishi (login qilmasdan ham) fayl yuklab, bizning
// Cloudinary hisobimizni cheksiz (shu jumladan zararli maqsadda fayl
// xostlash uchun) suiiste'mol qila olardi. requireAuth avval multer'dan —
// autentifikatsiyasiz so'rov katta faylni qayta ishlashga vaqt sarflamasdan
// darhol rad etiladi.
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fayl yuklanmadi' });
  // Suiiste'mol qarshi: bitta foydalanuvchi daqiqasiga ko'p bo'lsa 30 ta fayl
  // yuklashi mumkin (Cloudinary/serverga haddan tashqari yuk, Telegram relay
  // orqali spam ehtimoli — messages.ts POST '/' bilan bir xil chegara).
  const uid = getTenant()?.userId;
  if (uid) {
    const rl = checkRate(`msgupload:${uid}`, 30, 60 * 1000);
    if (!rl.allowed) return res.status(429).json({ error: `Juda ko'p fayl yuklandi. ${rl.retryAfterSec} soniyadan keyin urining.` });
  }
  try {
    const { url } = await uploadFileToCloud(req.file.path, 'qurilish-chat', req.file.originalname);
    res.json({ url, fileName: req.file.originalname, fileSize: req.file.size });
  } catch {
    // Cloudinary muvaffaqiyatsiz bo'lsa local URL qaytaradi — MUHIM: mutlaq
    // (backend domeni bilan) bo'lishi shart, nisbiy "/uploads/xxx" EMAS.
    // Nisbiy bo'lsa, u saqlanib qolgan xabarni HAR BIR platforma o'z origin'i
    // asosida hal qiladi (web: erp-firma.uz, Windows: tauri.localhost,
    // Android: localhost) — hech biri backend'nikiga to'g'ri kelmaydi, rasm/
    // fayl hech qayerda ochilmaydi.
    await persistUploadedFile(req.file.path);
    res.json({ url: `${getBackendUrl()}/uploads/${req.file.filename}`, fileName: req.file.originalname, fileSize: req.file.size });
  }
});

// Foydalanuvchi xabarlari: DM + a'zo bo'lgan guruhlar
// XAVFSIZLIK — TOPILMA (audit): avval `userId` to'g'ridan-to'g'ri
// so'rov query'sidan olinardi, hech qanday tekshiruvsiz — istalgan
// autentifikatsiyalangan xodim boshqa birortasining ID'sini yozib,
// o'sha kishining BARCHA shaxsiy yozishmalari (DM) va guruh xabarlarini
// o'qiy olardi (IDOR). Endi doim FAQAT joriy sessiya egasining o'zi
// (getTenant()?.userId) ishlatiladi — bu marshrut hech qachon "boshqa
// birovning xabarlarini ko'rish" uchun mo'ljallanmagan edi.
router.get('/', async (req, res) => {
  try {
    const uid = getTenant()?.userId;
    if (!uid) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const groups = await Group.find(scoped({ memberIds: uid })).select('_id');
    const groupIds = groups.map(g => String(g._id));
    // MIQYOSLILIK: cheklovsiz bo'lsa faol firma oylar/yillar davomida to'plagan
    // BARCHA xabarlarni har safar to'liq qaytarardi — vaqt o'tishi bilan sekin-
    // lashadi. Eng so'nggi 3000 tasini olib (kamdan-kam holatda yetarli emas),
        // eski tartibga (eskidan-yangiga) qaytaramiz — frontend'ning kutgan tartibi
    // o'zgarmaydi, faqat juda uzoq tarix qisqartiriladi.
    const messages = await Message.find(scoped({
      $or: [
        { fromUserId: uid },
        { toUserId: uid },
        ...(groupIds.length ? [{ groupId: { $in: groupIds } }] : []),
      ],
    })).sort({ createdAt: -1 }).limit(3000);
    res.json(messages.reverse().map(shape));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Xabar yuborish (DM yoki guruh) + real-time broadcast
router.post('/', async (req, res) => {
  try {
    const { toUserId, groupId, text, type, mediaUrl, fileName, fileSize, location, replyToId, videoChatGroupId } = req.body;
    // XAVFSIZLIK: fromUserId AVVAL to'g'ridan-to'g'ri so'rov tanasidan
    // olinardi — istalgan autentifikatsiyalangan foydalanuvchi o'zini
    // BOSHQA birov (hatto boshqa firma xodimi) sifatida ko'rsatib xabar
    // yubora olardi (soxta jo'natuvchi — impersonatsiya). Endi faqat
    // tekshirilgan JWT kontekstidan — body'dagi qiymat butunlay e'tiborga
    // olinmaydi.
    const fromUserId = getTenant()?.userId;
    if (!fromUserId || (!toUserId && !groupId) || (!text?.trim() && !mediaUrl && !location)) {
      return res.status(400).json({ error: 'Avtorizatsiya va (toUserId yoki groupId) va text/media kerak' });
    }
    // XAVFSIZLIK (audit 2026-10-19): mediaUrl — faqat o'z serverimiz yoki o'z Cloudinary hisobimiz (https).
    // Aks holda "javascript:..." yoki begona havola chatda/dasturchi panelida bosilganda XSS bo'lardi.
    if (mediaUrl !== undefined && mediaUrl !== null && mediaUrl !== '' && !isAllowedMediaUrl(mediaUrl)) {
      return res.status(400).json({ error: "Media manzili noto'g'ri" });
    }
    // 'video_event' — faqat server (socket.ts) yaratadi; mijoz soxta tizim xabari yubora olmasin.
    if (type === 'video_event') return res.status(400).json({ error: "Noto'g'ri xabar turi" });
    // "Video chatga taklif" xabari — yuboruvchi HAQIQATAN ham o'sha guruh
    // a'zosi ekanini tekshiramiz, aks holda istalgan kishi istalgan
    // guruhning video chatiga "taklif" soxtalashtira olardi.
    if (type === 'video_invite' && videoChatGroupId) {
      const inviteGroup = await Group.findById(String(videoChatGroupId)).select('memberIds').lean();
      if (!inviteGroup || !(inviteGroup.memberIds || []).includes(String(fromUserId))) {
        return res.status(403).json({ error: "Siz bu guruh a'zosi emassiz" });
      }
    }
    // Suiiste'mol qarshi: har bir xabar Telegram bot orqali relay qilinadi
    // (guruh bo'lsa HAR BIR a'zoga) — cheklovsiz bo'lsa bitta xodim boshqa
    // xodim(lar)ning Telegramini yoki botning o'zini spam bilan to'ldirishi
    // mumkin edi. 40 xabar/daqiqa oddiy chat uchun yetarlicha keng.
    const rl = checkRate(`msgsend:${fromUserId}`, 40, 60 * 1000);
    if (!rl.allowed) {
      return res.status(429).json({ error: `Juda ko'p xabar. ${rl.retryAfterSec} soniyadan keyin urining.` });
    }
    // XAVFSIZLIK (P0): avval groupId bo'yicha a'zolik ham, firma ham tekshirilmasdi — istalgan
    // xodim id'sini bilgan istalgan guruhga (hatto boshqa firmanikiga) yoza olar, xabar o'sha
    // firma companyId'si bilan muhrlanib, barcha a'zolarning Telegramiga ketardi. Endi: yuboruvchi
    // guruh a'zosi (dasturchi — dev-support guruhida a'zo bo'lmasa ham) va o'sha firmadan bo'lishi shart.
    const tenant = getTenant();
    let targetGroup: { companyId?: string; devSupport?: boolean } | null = null;
    if (groupId) {
      targetGroup = await Group.findById(String(groupId)).select('memberIds companyId devSupport').lean().catch(() => null);
      const isMember = !!targetGroup && (targetGroup as any).memberIds?.map(String).includes(String(fromUserId));
      const devSupportAccess = !!targetGroup?.devSupport && !!tenant?.isDeveloper;
      // Firmasiz (dasturchi yaratgan/eski) guruh — a'zo yozadi, companyId muhri yuboruvchinikicha qoladi
      const sameTenant = !!tenant?.isDeveloper || !targetGroup?.companyId || String(targetGroup.companyId) === String(tenant?.companyId || '');
      if (!targetGroup || !(isMember || devSupportAccess) || !sameTenant) {
        return res.status(403).json({ error: "Siz bu guruh a'zosi emassiz" });
      }
    } else if (!tenant?.isDeveloper) {
      // DM: qabul qiluvchi shu firmadan (yoki dasturchi — support) bo'lishi shart
      const recipient = await User.findById(String(toUserId)).select('companyId role').lean().catch(() => null);
      if (!recipient || (recipient.role !== 'dasturchi' && String(recipient.companyId || '') !== String(tenant?.companyId || ''))) {
        return res.status(404).json({ error: 'Qabul qiluvchi topilmadi' });
      }
    }
    let msgData: any = stamped({
      fromUserId: String(fromUserId),
      toUserId: toUserId ? String(toUserId) : '',
      ...(groupId && { groupId: String(groupId) }),
      text: (text || '').trim(),
      timestamp: new Date().toISOString(),
      read: false,
      ...(type && { type }),
      ...(videoChatGroupId && { videoChatGroupId: String(videoChatGroupId) }),
      ...(mediaUrl && { mediaUrl }),
      ...(fileName && { fileName }),
      ...(fileSize != null && { fileSize }),
      ...(location && { location }),
      ...(replyToId && { replyToId }),
    });
    if (targetGroup?.companyId) {
      // Guruh xabari uchun companyId GURUHning o'zidan olinishi kerak — masalan
      // dasturchi (o'z companyId'i yo'q) biror firmaning dev-support guruhiga
      // yozganda, stamped() hech narsa qo'shmaydi va xabar keyin scoped() bilan
      // topilmay qoladi. Yuqorida firma mosligi tekshirilgan — begona firma muhrlanmaydi.
      msgData = { ...msgData, companyId: targetGroup.companyId };
    }
    const msg = await Message.create(msgData);
    const payload = shape(msg);
    // Xabar matni push/bildirishnoma tanasi uchun qisqartirilgan ko'rinishi
    // — fayl/joylashuv bo'lsa matn bo'sh bo'ladi, o'rniga tur nomi ko'rsatiladi.
    const notifBody = (text || '').trim() || (mediaUrl ? '📎 Fayl' : location ? '📍 Joylashuv' : 'Yangi xabar');
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
        // Har bir a'zoga (rasm/qurilma darajasidagi haqiqiy OS bildirishnomasi
        // — aniq xabar qilingan xato: "ilova/web'ning o'zidagi bildirishnoma
        // kelmayapti" — root sabab: createNotification() ilgari HECH QAYERDAN
        // chaqirilmagan edi, butun push/bildirishnoma zanjiri o'lik kod edi).
        for (const uid of memberIds) {
          createNotification({
            recipientId: String(uid),
            companyId: msgData.companyId,
            type: 'message',
            title: `${senderName} (${group.name})`,
            body: notifBody,
            entity: 'group',
            entityId: String(groupId),
            url: '/chat',
          }).catch(() => {});
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
      // Qurilmaning o'z (OS) bildirishnomasi + ilova ichidagi qo'ng'iroq
      // belgisi — pastdagi izohga qarang.
      User.findById(String(fromUserId)).select('firstName lastName').lean().then(sender => {
        const senderName = sender ? `${sender.firstName} ${sender.lastName || ''}`.trim() : 'Foydalanuvchi';
        createNotification({
          recipientId: String(toUserId),
          companyId: msgData.companyId,
          type: 'message',
          title: senderName,
          body: notifBody,
          entity: 'message',
          entityId: String(msg._id),
          url: '/chat',
        }).catch(() => {});
      }).catch(() => {});
    }
    res.status(201).json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// O'qildi (MUHIM: '/:id' dan oldin bo'lishi shart)
// XAVFSIZLIK: avval toUserId ham req.body'dan ("kimning pochtasi o'qilgan
// deb belgilanadi") olinardi — istalgan autentifikatsiyalangan foydalanuvchi
// BOSHQA birovning xabarlarini o'zi o'qimasdan turib "o'qildi" deb
// belgilashi (soxta read-receipt) mumkin edi. Endi toUserId FAQAT
// so'rov yuborayotgan (autentifikatsiyalangan) foydalanuvchining o'zi —
// faqat o'ziga kelgan xabarlarni o'qildi qila oladi. fromUserId (qaysi
// suhbatdosh) tanlash mijozga qoladi — bu shunchaki qaysi suhbat oynasi
// ekanini bildiradi, boshqa birovning nomidan hech narsa qilmaydi.
router.patch('/read', async (req, res) => {
  try {
    const toUserId = getTenant()?.userId;
    const { fromUserId } = req.body;
    if (!toUserId || !fromUserId) {
      return res.status(400).json({ error: 'fromUserId talab qilinadi' });
    }
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
// Tahrirlash / qadash. Telegram'dagidek (owner 2026-10-19): matnni FAQAT yozgan odam o'zgartiradi
// (rahbar boshqaning so'zini o'zgartira olmaydi); qadashni suhbat ishtirokchisi yoki rahbar qiladi.
// Moderator: direktor/o'rinbosar — faqat o'z firmasida (scoped() buni kafolatlaydi). Dasturchi uchun scoped()
// firma filtrini olib tashlaydi — shu sabab u faqat "Dasturchi bilan aloqa" guruhidagi xabarlarni boshqaradi,
// boshqa firmalarning ichki yozishmalarini emas (owner 2026-10-22: hech kim boshqa firma ma'lumotini o'zgartirmaydi).
const isBossRole = (u: any) => !!u && (u.role === 'direktor' || u.role === 'orinbosar');
async function isModerator(u: any, msg: any): Promise<boolean> {
  if (isBossRole(u)) return true;
  if (!u?.isDeveloper || !msg.groupId) return false;
  const g: any = await Group.findById(String(msg.groupId)).select('devSupport').lean().catch(() => null);
  return !!g?.devSupport;
}
// Audit: kim, kimning xabarini tahrirladi/o'chirdi (rahbar boshqaning xabarini o'chirsa ham iz qoladi)
async function auditMessage(req: any, action: 'update' | 'delete', msg: any, description: string, oldValue?: any, newValue?: any) {
  const u = req.user;
  const actor: any = await User.findById(String(u?.userId || '')).select('firstName lastName role').lean().catch(() => null);
  await logAudit({
    userId: String(u?.userId || ''),
    userName: actor ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim() : '',
    userRole: String(u?.role || actor?.role || ''),
    action, entity: 'message', entityId: String(msg._id),
    description, oldValue, newValue,
    companyId: msg.companyId ? String(msg.companyId) : (u?.companyId ? String(u.companyId) : undefined),
    req,
  });
}
async function isParticipant(msg: any, uid: string): Promise<boolean> {
  if (String(msg.fromUserId) === uid || String(msg.toUserId) === uid) return true;
  if (!msg.groupId) return false;
  const g: any = await Group.findById(String(msg.groupId)).select('memberIds').lean().catch(() => null);
  return !!g && (g.memberIds || []).map(String).includes(uid);
}

router.patch('/:id', async (req, res) => {
  try {
    const u = req.user;
    const uid = String(u?.userId || '');
    const { text, pinned } = req.body || {};
    const msg = await Message.findOne(scoped({ _id: req.params.id }));
    if (!msg) return res.status(404).json({ error: 'Xabar topilmadi' });
    let editedFrom: string | undefined;
    if (text !== undefined) {
      if (String(msg.fromUserId) !== uid) return res.status(403).json({ error: "Faqat o'z xabaringizni tahrirlay olasiz" });
      if (msg.deleted) return res.status(400).json({ error: "O'chirilgan xabarni tahrirlab bo'lmaydi" });
      const t = String(text).trim();
      if (!t || t.length > 4000) return res.status(400).json({ error: "Xabar matni bo'sh yoki juda uzun" });
      if (t !== msg.text) editedFrom = msg.text;
      msg.text = t; msg.edited = true;
    }
    if (pinned !== undefined) {
      if (!(await isModerator(u, msg)) && !(await isParticipant(msg, uid))) return res.status(403).json({ error: "Bu xabarni qadash ruxsati yo'q" });
      msg.pinned = !!pinned;
    }
    await msg.save();
    if (editedFrom !== undefined) await auditMessage(req, 'update', msg, 'Xabar tahrirlandi', { text: editedFrom }, { text: msg.text });
    const payload = shape(msg);
    if (msg.groupId) emitToGroup(msg.groupId, 'message:edit', payload);
    else { emitToUser(msg.toUserId, 'message:edit', payload); emitToUser(msg.fromUserId, 'message:edit', payload); }
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// O'chirish (soft delete) — o'z xabarini yozgan odam, boshqanikini direktor/o'rinbosar/dasturchi
router.delete('/:id', async (req, res) => {
  try {
    const u = req.user;
    const msg = await Message.findOne(scoped({ _id: req.params.id }));
    if (!msg) return res.status(404).json({ error: 'Xabar topilmadi' });
    if (String(msg.fromUserId) !== String(u?.userId || '') && !(await isModerator(u, msg))) {
      return res.status(403).json({ error: "Xabarni o'chirish ruxsati yo'q" });
    }
    const byOther = String(msg.fromUserId) !== String(u?.userId || '');
    msg.deleted = true;
    await msg.save();
    await auditMessage(req, 'delete', msg, byOther ? "Boshqa xodimning xabari o'chirildi" : "Xabar o'chirildi",
      { text: msg.text, fromUserId: String(msg.fromUserId), toUserId: msg.toUserId ? String(msg.toUserId) : undefined, groupId: msg.groupId ? String(msg.groupId) : undefined });
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
