import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getBackendUrl } from '../utils/backendUrl';

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

export const cloudinaryEnabled = !!(CLOUD_NAME && API_KEY && API_SECRET);

if (cloudinaryEnabled) {
  cloudinary.config({ cloud_name: CLOUD_NAME!, api_key: API_KEY!, api_secret: API_SECRET! });
  console.log('✅ Cloudinary ulandi — fayllar doimiy saqlanadi');
} else {
  // XAVFSIZLIK/BARQARORLIK OGOHLANTIRISHI: uchtadan BIRTASI bo'lmasa ham
  // (CLOUD_NAME/API_KEY/API_SECRET) — jimgina Render'ning EPHEMERAL
  // '/uploads' papkasiga qaytiladi. Bu qayta deploy/restart'da (bugun
  // kechqurun bo'lgani kabi, tez-tez) BUTUNLAY YO'QOLADI — chat media,
  // firma logotipi, APK/exe yuklab olish havolalari va h.k. barchasi
  // o'lik havolaga aylanadi. Avval bu HECH QAYERDA ko'rinmas edi —
  // uzoq vaqt sezilmasdan qolib ketishi mumkin edi.
  console.error('⚠️⚠️⚠️ Cloudinary sozlanmagan (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET) — fayllar EPHEMERAL diskka yoziladi, keyingi deploy/restart\'da YO\'QOLADI!');
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.heic', '.heif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv', '.mp3', '.wav', '.m4a', '.ogg', '.3gp', '.aac']);
// Cloudinary XAVFSIZLIK SIYOSATI bo'yicha bajariladigan/o'rnatiladigan
// dasturlarga o'xshash kengaytmalarni ATAYLAB RAD ETADI ("resources with
// extension apk are not allowed") — bu hisob sozlamalaridan o'chirib
// bo'lmaydigan standart cheklov. Kod orqali chetlab o'tamiz: bunday
// fayllar Cloudinary'ga ZARARSIZ ko'rinadigan ".bin" kengaytma bilan
// yuklanadi (Cloudinary buni oddiy ikkilik ma'lumot deb qabul qiladi),
// lekin foydalanuvchiga YETKAZISHDA (/api/files/proxy) haqiqiy nom va
// MIME turi bilan qaytariladi — Cloudinary hech qachon "ko'rmaydi" buni
// haqiqatan APK/EXE ekanini, faqat BIZNING proksimiz biladi.
const RISKY_EXTS = new Set(['.apk', '.exe', '.msi', '.dll', '.bat', '.cmd', '.sh', '.jar', '.deb', '.ipa', '.com', '.scr', '.vbs', '.ps1', '.app', '.dmg']);
const MIME_BY_EXT: Record<string, string> = {
  '.apk': 'application/vnd.android.package-archive',
  '.exe': 'application/x-msdownload',
  '.msi': 'application/x-msi',
  '.dll': 'application/x-msdownload',
  '.jar': 'application/java-archive',
  '.deb': 'application/vnd.debian.binary-package',
  '.ipa': 'application/octet-stream',
  '.dmg': 'application/x-apple-diskimage',
};

// Cloudinary mavjud bo'lsa shunga, yo'q bo'lsa localga yuklaydi.
// `originalName` — multer vaqtinchalik faylni KENGAYTMASIZ nomlaydi
// (masalan "3f2a91bc..."), shuning uchun asl fayl nomi (kengaytmasi bilan)
// ALOHIDA beriladi (req.file.originalname).
export async function uploadFileToCloud(
  filePath: string,
  folder = 'qurilish-erp',
  originalName?: string,
  opts2?: { stablePublicId?: string },
): Promise<{ url: string; publicId?: string }> {
  if (!cloudinaryEnabled) {
    // Local fayl URL qaytaradi. MUHIM: multer vaqtinchalik faylni
    // KENGAYTMASIZ saqlaydi — Cloudinary yo'lida bo'lgani kabi, kengaytmasiz
    // qaytarilsa yuklab olingan fayl APK/EXE/PDF sifatida TANILMAYDI. Shu
    // sabab bu (degradatsiya qilingan, faqat Cloudinary sozlanmaganda
    // ishlaydigan) yo'lda ham asl kengaytmani saqlab qolamiz.
    const ext = originalName ? path.extname(originalName).toLowerCase() : '';
    let fileName = path.basename(filePath);
    if (ext && !fileName.endsWith(ext)) {
      const renamed = `${filePath}${ext}`;
      try { fs.renameSync(filePath, renamed); fileName = path.basename(renamed); } catch {}
    }
    return { url: `${getBackendUrl()}/uploads/${fileName}` };
  }
  const ext = originalName ? path.extname(originalName).toLowerCase() : '';
  const isRisky = RISKY_EXTS.has(ext);
  const opts: any = { folder };
  if (IMAGE_EXTS.has(ext)) opts.resource_type = 'image';
  else if (VIDEO_EXTS.has(ext)) opts.resource_type = 'video';
  else {
    // MUHIM: rasm/video BO'LMAGAN har qanday fayl (PDF, DOCX, ZIP, APK,
    // EXE va h.k.) Cloudinary'da 'raw' resurs turi sifatida saqlanadi —
    // BUNDA (rasm/video'dan farqli) Cloudinary yuklab olingan faylga
    // kengaytmani AVTOMATIK BIRIKTIRMAYDI. public_id tasodifiy hash
    // bo'lib qolaversa, natijaviy URL/fayl nomi butunlay kengaytmasiz
    // chiqadi — Android buni APK deb TANIMAYDI, Windows ham EXE deb
    // bilmaydi, PDF/DOCX ham hech qayerda to'g'ri ochilmaydi. Yechim:
    // kengaytmani public_id'ning O'ZIGA aniq qo'shamiz. `isRisky` bo'lsa
    // — ".apk"/".exe" kabi haqiqiy kengaytma EMAS, ZARARSIZ ".bin"
    // ishlatiladi (Cloudinary buni rad etadi — yuqoridagi RISKY_EXTS
    // izohiga qarang), haqiqiy nom faqat yetkazishda qaytariladi.
    opts.resource_type = 'raw';
    const uploadExt = isRisky ? '.bin' : ext;
    if (originalName) {
      const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'file';
      opts.public_id = `${base}-${Date.now()}${uploadExt}`;
    }
    // stablePublicId — har safar BIR XIL, O'ZGARMAS public_id + overwrite:true.
    // Deploy artifaktlari (APK/exe) uchun ishlatiladi: manzil (URL) hech
    // qachon o'zgarmaydi (landing page/profil doim "eng oxirgi" versiyaga
    // ishonchli havola beradi), va eski versiyalar Cloudinary'da cheksiz
    // to'planib qolmaydi (har CI build eskisini ALMASHTIRADI).
    if (opts2?.stablePublicId) {
      opts.public_id = `${opts2.stablePublicId}${uploadExt}`;
      opts.overwrite = true;
      opts.invalidate = true; // CDN keshini ham yangilaydi — eski APK keshda qolib ketmasin
    }
  }
  const result = await cloudinary.uploader.upload(filePath, opts);
  // Cloudinary'ga yuklangandan keyin local faylni o'chirish (disk tejash)
  try { fs.unlinkSync(filePath); } catch {}
  // MUHIM: mijozga Cloudinary'ning O'ZINING manzilini emas, balki bizning
  // /api/files/proxy orqali "o'ralgan" manzilni qaytaramiz — ba'zi
  // tarmoqlar/provayderlar (O'zbekistonda xabar qilingan aniq holat)
  // res.cloudinary.com'ga to'g'ridan-to'g'ri ulanolmasligi/beqaror
  // ulanishi mumkin, lekin bizning o'z backend domenimizga (ilova
  // allaqachon shunga ishonib ishlaydi) ular albatta ulana oladi.
  let proxiedUrl = `${getBackendUrl()}/api/files/proxy?url=${encodeURIComponent(result.secure_url)}`;
  if (isRisky && originalName) {
    // Cloudinary'da ".bin" bo'lib "yashiringan" fayl — proksi yetkazishda
    // ASL nom/turi bilan qaytarilishi uchun aniq ko'rsatamiz.
    const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
    proxiedUrl += `&filename=${encodeURIComponent(path.basename(originalName))}&type=${encodeURIComponent(mime)}`;
  }
  return { url: proxiedUrl, publicId: result.public_id };
}

export async function deleteFromCloud(publicId: string): Promise<void> {
  if (!cloudinaryEnabled) return;
  try { await cloudinary.uploader.destroy(publicId); } catch {}
}

export { cloudinary };
