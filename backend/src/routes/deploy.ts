import { Router } from 'express';
import multer from 'multer';
import User from '../models/User';
import AppRelease from '../models/AppRelease';
import { bot } from '../services/bot';
import { uploadFileToCloud } from '../config/cloudinary';

const router = Router();

// GET /api/deploy/latest — HAMMAGA OCHIQ (auth/secret talab qilmaydi — login
// qilmagan mehmon ham landing page'dan yuklab olishi kerak). Faqat versiya
// matni + Cloudinary havolalarini qaytaradi, boshqa hech qanday maxfiy
// ma'lumot yo'q.
router.get('/latest', async (_req, res) => {
  try {
    const rel = await AppRelease.findOne({ key: 'latest' }).lean();
    if (!rel) return res.json({ available: false });
    res.json({
      available: true,
      version: rel.version,
      notes: rel.notes || '',
      apkUrl: rel.apkUrl || null,
      exeUrl: rel.exeUrl || null,
      updatedAt: rel.updatedAt,
    });
  } catch (err) {
    console.error('[deploy/latest]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

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

    // kind: 'apk' | 'exe' — berilsa, O'ZGARMAS (stable) public_id bilan
    // yuklanadi (har safar bir xil URL, eskisi almashtiriladi). Landing
    // page/Profildagi "yuklab olish" tugmalari shu doim-bir-xil URL'ga
    // ishonib, DB'da alohida "eng oxirgi versiya" yozuvi saqlash shart
    // emas. `kind` berilmasa — eski (timestamp-unique) xatti-harakat.
    const kind = typeof req.body?.kind === 'string' ? req.body.kind : undefined;
    const ext = kind === 'apk' ? '.apk' : kind === 'exe' ? '.exe' : undefined;
    const stablePublicId = ext ? `QurilishERP-latest${ext}` : undefined;

    const { url } = await uploadFileToCloud(req.file.path, 'qurilish-releases', req.file.originalname, { stablePublicId });
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

    // Landing page/Profildagi "yuklab olish" bo'limi shu yozuvdan o'qiydi —
    // botga yuborishdan OLDIN saqlaymiz, shunda broadcast biror sababdan
    // sekinlashsa/qisman muvaffaqiyatsiz bo'lsa ham sayt allaqachon yangi
    // versiyani ko'rsatadi (foydalanuvchi kutib o'tirmaydi).
    await AppRelease.findOneAndUpdate(
      { key: 'latest' },
      { key: 'latest', version, notes: notes || '', apkUrl: apkUrl || undefined, exeUrl: exeUrl || undefined, updatedAt: new Date() },
      { upsert: true }
    ).then(() => console.log(`[broadcast-update] AppRelease saqlandi: v${version}`))
      .catch(err => console.error('[broadcast-update] AppRelease saqlash xatosi:', err));

    const introLines = [`🆕 *QurilishERP — yangi versiya (${version})*`];
    if (notes) introLines.push(String(notes));
    const introText = introLines.join('\n\n');

    // MUHIM: avval APK/exe uchun tashqi URL'ga ochiladigan TUGMA yuborilardi —
    // bosilganda brauzerga chiqib ketardi va (kengaytma bug'i tuzalgunga
    // qadar) ba'zan notanish/kengaytmasiz fayl bo'lib ochilardi. Keyin
    // sendDocument'ga to'g'ridan-to'g'ri Cloudinary URL berildi — lekin bu
    // holda Telegram SERVERI o'zi URL'ni yuklab olishga harakat qiladi, va
    // bu yo'lda nom/kengaytma/Content-Type qanday aniqlanishi bizning
    // nazoratimizdan tashqarida (fileOptions faqat baytlarni O'ZIMIZ
    // yuklaganda ishlaydi, URL berilganda e'tiborga olinmasligi mumkin).
    // Endi backend'ning O'ZI Cloudinary'dan baytlarni oldindan yuklab,
    // Telegram'ga TO'G'RIDAN-TO'G'RI multipart sifatida yuboradi — nom va
    // MIME tur ANIQ biz aytgandek bo'ladi, hech qanday noaniqlik qolmaydi.
    // Birinchi muvaffaqiyatli yuborishdan qaytgan file_id keyingi HAMMA
    // qabul qiluvchi uchun qayta ishlatiladi (baytlarni qayta-qayta
    // yubormaydi — tezroq). Agar fayl juda katta bo'lib Telegram rad etsa
    // (Bot API limiti ~50MB) — o'sha va keyingi userlarga oddiy havola
    // bilan zaxira qilinadi (hech kim faylsiz qolmasin).
    const fetchBuffer = async (url: string): Promise<Buffer> => {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Fayl yuklab olinmadi: HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    };
    let apkBuffer: Buffer | null = null; let apkFileId: string | undefined; let apkTooLarge = false;
    let exeBuffer: Buffer | null = null; let exeFileId: string | undefined; let exeTooLarge = false;
    if (apkUrl) {
      try { apkBuffer = await fetchBuffer(apkUrl); }
      catch (err) { console.error('[broadcast-update] APK fetchBuffer xatosi:', (err as Error).message); apkTooLarge = true; }
    }
    if (exeUrl) {
      try { exeBuffer = await fetchBuffer(exeUrl); }
      catch (err) { console.error('[broadcast-update] EXE fetchBuffer xatosi:', (err as Error).message); exeTooLarge = true; }
    }

    let sent = 0, failed = 0;
    for (const u of users) {
      try {
        const buttons: any[][] = [];
        if (apkTooLarge) buttons.push([{ text: '📱 Android (APK) — havola', url: apkUrl }]);
        if (exeTooLarge) buttons.push([{ text: '💻 Windows dasturi — havola', url: exeUrl }]);
        await bot.sendMessage(u.telegramChatId, introText, {
          parse_mode: 'Markdown',
          reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
        });

        if (apkUrl && !apkTooLarge && apkBuffer) {
          try {
            const msg = await bot.sendDocument(u.telegramChatId, apkFileId || apkBuffer, {},
              apkFileId ? undefined : { filename: 'QurilishERP.apk', contentType: 'application/vnd.android.package-archive' });
            if (!apkFileId) apkFileId = msg.document?.file_id;
          } catch (docErr) {
            console.error('[broadcast-update] APK sendDocument xatosi (havolaga o\'tiladi):', (docErr as Error).message);
            apkTooLarge = true;
            await bot.sendMessage(u.telegramChatId, `📱 Android (APK): ${apkUrl}`).catch(() => {});
          }
        } else if (apkUrl && apkTooLarge) {
          await bot.sendMessage(u.telegramChatId, `📱 Android (APK): ${apkUrl}`).catch(() => {});
        }
        if (exeUrl && !exeTooLarge && exeBuffer) {
          try {
            const msg = await bot.sendDocument(u.telegramChatId, exeFileId || exeBuffer, {},
              exeFileId ? undefined : { filename: 'QurilishERP-setup.exe', contentType: 'application/x-msdownload' });
            if (!exeFileId) exeFileId = msg.document?.file_id;
          } catch (docErr) {
            console.error('[broadcast-update] EXE sendDocument xatosi (havolaga o\'tiladi):', (docErr as Error).message);
            exeTooLarge = true;
            await bot.sendMessage(u.telegramChatId, `💻 Windows dasturi: ${exeUrl}`).catch(() => {});
          }
        } else if (exeUrl && exeTooLarge) {
          await bot.sendMessage(u.telegramChatId, `💻 Windows dasturi: ${exeUrl}`).catch(() => {});
        }
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
