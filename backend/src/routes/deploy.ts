import { Router } from 'express';
import multer from 'multer';
import User from '../models/User';
import { bot } from '../services/bot';
import { uploadFileToCloud } from '../config/cloudinary';

const router = Router();

// Xuddi messages.ts'dagi chat-media yuklash bilan bir xil vaqtinchalik
// disk-storage naqshi — fayl darhol Cloudinary'ga yuklanib, keyin diskdan
// o'chiriladi (deploy-artifact.ts o'zi buni bajaradi).
const upload = multer({ dest: 'uploads/', limits: { fileSize: 200 * 1024 * 1024 } });

// POST /api/deploy/upload-artifact — CI qurgan APK/exe faylini Cloudinary'ga
// yuklab, ochiq (login talab qilmaydigan) URL qaytaradi — GitHub Actions
// "artifact"lari login talab qilgani uchun Telegram orqali oddiy foydalanuvchiga
// to'g'ridan-to'g'ri yuborib bo'lmaydi, shuning uchun shu oraliq qadam kerak.
router.post('/upload-artifact', upload.single('file'), async (req, res) => {
  try {
    const secret = req.headers['x-deploy-secret'];
    const expected = process.env.DEPLOY_BROADCAST_SECRET;
    if (!expected || secret !== expected) {
      return res.status(401).json({ error: 'Ruxsat yo\'q' });
    }
    if (!req.file) return res.status(400).json({ error: 'file talab etiladi (multipart/form-data)' });

    const { url } = await uploadFileToCloud(req.file.path, 'qurilish-releases');
    res.json({ ok: true, url });
  } catch (err) {
    console.error('[upload-artifact]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST /api/deploy/broadcast-update — yangi APK/exe versiyasi chiqqanda CI
// (yoki qo'lda) chaqiradigan yo'l. Oddiy JWT auth ISHLATILMAYDI — bu CI
// muhitidan (foydalanuvchi seansisiz) chaqiriladi, shuning uchun umumiy
// maxfiy kalit (DEPLOY_BROADCAST_SECRET env) bilan himoyalangan.
//
// Barcha rollarga (direktor/orinbosar/prorab/brigadir/ishchi) — FAQAT
// "dasturchi" (platforma egasi/super-admin) ga YUBORILMAYDI, aniq talab
// bo'yicha. Kompaniyalar bo'yicha cheklanmagan — bu ilova darajasidagi
// yangilanish, bitta firmaga tegishli emas.
router.post('/broadcast-update', async (req, res) => {
  try {
    const secret = req.headers['x-deploy-secret'];
    const expected = process.env.DEPLOY_BROADCAST_SECRET;
    if (!expected || secret !== expected) {
      return res.status(401).json({ error: 'Ruxsat yo\'q' });
    }

    const { version, apkUrl, exeUrl, notes } = req.body || {};
    if (!version || (!apkUrl && !exeUrl)) {
      return res.status(400).json({ error: 'version va kamida bitta havola (apkUrl/exeUrl) talab etiladi' });
    }

    const users = await User.find({
      role: { $ne: 'dasturchi' },
      telegramChatId: { $exists: true, $ne: '' },
    }).select('telegramChatId').lean();

    const lines = [`🆕 *QurilishERP — yangi versiya (${version})*`];
    if (notes) lines.push(String(notes));
    lines.push('Ilovangizni eng so\'nggi versiyaga yangilang:');

    const buttons: any[][] = [];
    if (apkUrl) buttons.push([{ text: '📱 Android (APK)', url: apkUrl }]);
    if (exeUrl) buttons.push([{ text: '💻 Windows dasturi', url: exeUrl }]);

    let sent = 0, failed = 0;
    for (const u of users) {
      try {
        await bot.sendMessage(u.telegramChatId, lines.join('\n\n'), {
          parse_mode: 'Markdown',
          reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
        });
        sent++;
      } catch (err) {
        failed++;
        console.error('[broadcast-update] send error:', (err as Error).message);
      }
      // Telegram global rate-limit (~30 xabar/soniya) ustidan xavfsiz zaxira.
      await new Promise(r => setTimeout(r, 50));
    }

    res.json({ ok: true, total: users.length, sent, failed });
  } catch (err) {
    console.error('[broadcast-update]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
