import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import User from '../models/User';
import AppRelease from '../models/AppRelease';
import { bot } from '../services/bot';
import { getBackendUrl } from '../utils/backendUrl';

const router = Router();

// GET /api/deploy/latest — HAMMAGA OCHIQ (auth/secret talab qilmaydi — login
// qilmagan mehmon ham landing page'dan yuklab olishi kerak). Faqat versiya
// matni + havolalarni qaytaradi, boshqa hech qanday maxfiy ma'lumot yo'q.
router.get('/latest', async (_req, res) => {
  try {
    const rel = await AppRelease.findOne({ key: 'latest' }).lean();
    if (!rel) return res.json({ available: false });
    // MUHIM: APK/EXE endi O'ZGARMAS nom bilan '/uploads'da saqlanadi
    // (Cloudinary emas — yuqoridagi izohga qarang), o'sha static route esa
    // 365 kunlik "immutable" keshlash sarlavhasi bilan xizmat qiladi (bu
    // chat-media fayllar uchun TO'G'RI, ular haqiqatan ham o'zgarmas — lekin
    // release fayli HAR YANGI VERSIYADA bir xil URL'da ALMASHTIRILADI).
    // Shu sabab mijozning (brauzer) o'zi eski nusxani abadiy keshlab
    // qolmasligi uchun URL'ga versiyaga bog'liq so'rov parametri qo'shamiz —
    // versiya o'zgarsa, URL "yangi" bo'lib ko'rinadi, brauzer qayta yuklaydi.
    const v = encodeURIComponent(rel.version || '');
    const withVersion = (u?: string | null) => (u ? `${u}${u.includes('?') ? '&' : '?'}v=${v}` : null);
    res.json({
      available: true,
      version: rel.version,
      notes: rel.notes || '',
      apkUrl: withVersion(rel.apkUrl),
      exeUrl: withVersion(rel.exeUrl),
      updatedAt: rel.updatedAt,
    });
  } catch (err) {
    console.error('[deploy/latest]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

const upload = multer({ dest: 'uploads/', limits: { fileSize: 200 * 1024 * 1024 } });

// POST /api/deploy/upload-artifact — CI qurgan APK/exe faylini saqlab, ochiq
// (login talab qilmaydigan) URL qaytaradi — GitHub Actions "artifact"lari
// login talab qilgani uchun Telegram orqali oddiy foydalanuvchiga
// to'g'ridan-to'g'ri yuborib bo'lmaydi, shuning uchun shu oraliq qadam kerak.
//
// XAVFSIZLIK/TARIX: avval bu yo'l Cloudinary'ga yuklardi — lekin Cloudinary'ning
// o'z xavfsizlik siyosati .apk/.exe kengaytmalarini UMUMAN rad etadi
// ("resources with extension apk/exe are not allowed"), ".bin" deb
// niqoblash bilan vaqtincha aylanib o'tilgan edi — Cloudinary keyinchalik
// buni ham berkitib qo'ydi ("resources with extension bin are not allowed").
// Aniq, takroran bildirilgan foydalanuvchi talabi: "claudinary ni apk bn
// exe... ochirip qoy". Endi bu yo'l Cloudinary'ga UMUMAN TEGMAYDI — botning
// qo'lda-tashlab-broadcast qilish yo'li (services/bot.ts, broadcastVersionFile)
// bilan BIR XIL naqsh: fayl to'g'ridan-to'g'ri shu serverning o'z
// '/uploads' papkasiga, O'ZGARMAS nom bilan yoziladi (Render diskidan
// ephemeral — qayta ishga tushirilganda o'chadi, lekin bu allaqachon
// qo'lda-broadcast yo'lida qabul qilingan cheklov, yangilik emas).
router.post('/upload-artifact', upload.single('file'), async (req, res) => {
  try {
    const secret = req.headers['x-deploy-secret'];
    const expected = process.env.DEPLOY_BROADCAST_SECRET;
    if (!expected || secret !== expected) {
      return res.status(401).json({ error: 'Ruxsat yo\'q' });
    }
    if (!req.file) return res.status(400).json({ error: 'file talab etiladi (multipart/form-data)' });

    const kind = typeof req.body?.kind === 'string' ? req.body.kind : undefined;
    const ext = (kind === 'apk' || kind === 'exe') ? `.${kind}` : (path.extname(req.file.originalname || '') || '.bin');
    const destDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    // kind berilsa — O'ZGARMAS (stable) nom bilan yoziladi (har safar bir xil
    // URL, eskisi almashtiriladi). Landing page/Profildagi "yuklab olish"
    // tugmalari shu doim-bir-xil URL'ga ishonadi, DB'da alohida "eng oxirgi
    // versiya" yozuvi saqlash shart emas. `kind` berilmasa — vaqt tamg'asi
    // bilan noyob nom.
    const stableName = (kind === 'apk' || kind === 'exe') ? `QurilishERP-latest${ext}` : `artifact-${Date.now()}${ext}`;
    const destPath = path.join(destDir, stableName);
    fs.copyFileSync(req.file.path, destPath);
    fs.unlinkSync(req.file.path);
    const url = `${getBackendUrl()}/uploads/${stableName}`;
    res.json({ ok: true, url });
  } catch (err) {
    console.error('[upload-artifact]', err);
    // MUHIM: bu yo'l maxfiy kalit bilan himoyalangan (faqat ishonchli CI
    // chaqiradi, oddiy foydalanuvchi emas) — shu sabab HAQIQIY xato
    // matnini qaytarish xavfsiz va o'ta foydali: Render loglariga
    // kirish imkoni yo'q, aks holda "Server xatoligi" degan umumiy
    // xabardan tashqari hech narsa ko'rinmas edi (aynan shu sodir
    // bo'lgan — CI logida sabab butunlay yashiringan edi).
    const anyErr = err as any;
    const detail = anyErr?.error?.message || anyErr?.message || String(err);
    res.status(500).json({ error: 'Server xatoligi', detail });
  }
});

// POST /api/deploy/broadcast-update — yangi APK/exe versiyasi chiqqanda CI
// (yoki qo'lda) chaqiradigan yo'l. Oddiy JWT auth ISHLATILMAYDI — bu CI
// muhitidan (foydalanuvchi seansisiz) chaqiriladi, shuning uchun umumiy
// maxfiy kalit (DEPLOY_BROADCAST_SECRET env) bilan himoyalangan.
//
// XATTI-HARAKAT O'ZGARDI (aniq, qat'iy talab): avval BARCHA rollarga
// (direktor/orinbosar/prorab/brigadir/ishchi) — dasturchidan TASHQARI —
// avtomatik yuborilardi. Endi CI HECH KIMGA avtomatik yubormaydi — FAQAT
// dasturchiga ("bu tayyor, ko'rib chiqing" xabari sifatida). Hammaga
// tarqatish qarori endi TO'LIQ dasturchining o'zi qo'lida: botdagi
// "📢 Xabar yuborish" tugmasi yoki APK/EXE'ni to'g'ridan-to'g'ri botga
// tashlash orqali, o'zi xohlagan payt. ("keyn yangi versiya chiqasa
// yuborma botga ozim yuboraman automatik yuborma faqat admin yani
// dasturchiga yubor boshqa hichkimga yuborma".)
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
      role: 'dasturchi',
      telegramChatId: { $exists: true, $ne: '' },
    }).select('telegramChatId').lean();

    // Landing page/Profildagi "yuklab olish" bo'limi shu yozuvdan o'qiydi —
    // botga yuborishdan OLDIN saqlaymiz, shunda broadcast biror sababdan
    // sekinlashsa/qisman muvaffaqiyatsiz bo'lsa ham sayt allaqachon yangi
    // versiyani ko'rsatadi (foydalanuvchi kutib o'tirmaydi).
    await AppRelease.findOneAndUpdate(
      { key: 'latest' },
      { $set: { key: 'latest', version, notes: notes || '', apkUrl: apkUrl || undefined, exeUrl: exeUrl || undefined, updatedAt: new Date() } },
      { upsert: true }
    ).then(() => console.log(`[broadcast-update] AppRelease saqlandi: v${version}`))
      .catch(err => console.error('[broadcast-update] AppRelease saqlash xatosi:', err));

    const introLines = [`🆕 *Yangi versiya tayyor (${version})*`, `CI qurdi — hammaga hali YUBORILMADI. Ko'rib chiqing, xohlasangiz "📢 Xabar yuborish" orqali (yoki fayllarni to'g'ridan-to'g'ri shu botga tashlab) o'zingiz tarqating.`];
    if (notes) introLines.push(String(notes));
    const introText = introLines.join('\n\n');

    // MUHIM: avval APK/exe uchun tashqi URL'ga ochiladigan TUGMA yuborilardi —
    // bosilganda brauzerga chiqib ketardi va (kengaytma bug'i tuzalgunga
    // qadar) ba'zan notanish/kengaytmasiz fayl bo'lib ochilardi. Keyin
    // sendDocument'ga to'g'ridan-to'g'ri tashqi URL berildi — lekin bu
    // holda Telegram SERVERI o'zi URL'ni yuklab olishga harakat qiladi, va
    // bu yo'lda nom/kengaytma/Content-Type qanday aniqlanishi bizning
    // nazoratimizdan tashqarida (fileOptions faqat baytlarni O'ZIMIZ
    // yuklaganda ishlaydi, URL berilganda e'tiborga olinmasligi mumkin).
    // Endi backend'ning O'ZI (endi o'z '/uploads'idan, Cloudinary'dan EMAS —
    // yuqoridagi upload-artifact izohiga qarang) baytlarni oldindan yuklab,
    // Telegram'ga TO'G'RIDAN-TO'G'RI multipart sifatida yuboradi — nom va
    // MIME tur ANIQ biz aytgandek bo'ladi, hech qanday noaniqlik qolmaydi.
    // Birinchi muvaffaqiyatli yuborishdan qaytgan file_id keyingi HAMMA
    // qabul qiluvchi uchun qayta ishlatiladi (baytlarni qayta-qayta
    // yubormaydi — tezroq). Agar fayl juda katta bo'lib Telegram rad etsa
    // (Bot API limiti ~50MB) — o'sha va keyingi userlarga oddiy havola
    // bilan zaxira qilinadi (hech kim faylsiz qolmasin).
    // apkUrl/exeUrl endi Cloudinary'ga umuman bog'liq emas — to'g'ridan-to'g'ri
    // shu serverning o'z '/uploads' manzili (upload-artifact yozadi). Bu
    // unwrap eski (Cloudinary davridan qolgan, /api/files/proxy orqali
    // "o'ralgan") havolalar hali qandaydir joyda saqlanib qolgan bo'lsa ham
    // ishlashda davom etishi uchun zararsiz zaxira — endigi normal holatda
    // hech narsani o'zgartirmaydi (pathname /api/files/proxy emas).
    const unwrapProxyUrl = (url: string): string => {
      try {
        const u = new URL(url);
        if (u.pathname === '/api/files/proxy') {
          const inner = u.searchParams.get('url');
          if (inner) return inner;
        }
      } catch {}
      return url;
    };
    const fetchBuffer = async (rawUrl: string): Promise<Buffer> => {
      const url = unwrapProxyUrl(rawUrl);
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
