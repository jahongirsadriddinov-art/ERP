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
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.heic', '.heif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv', '.mp3', '.wav', '.m4a', '.ogg', '.3gp', '.aac']);

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
    // Local fayl URL qaytaradi
    const fileName = path.basename(filePath);
    return { url: `${getBackendUrl()}/uploads/${fileName}` };
  }
  const ext = originalName ? path.extname(originalName).toLowerCase() : '';
  const opts: any = { folder };
  if (IMAGE_EXTS.has(ext)) opts.resource_type = 'image';
  else if (VIDEO_EXTS.has(ext)) opts.resource_type = 'video';
  else {
    // MUHIM: rasm/video BO'LMAGAN har qanday fayl (APK, EXE, PDF, DOCX,
    // ZIP va h.k.) Cloudinary'da 'raw' resurs turi sifatida saqlanadi —
    // BUNDA (rasm/video'dan farqli) Cloudinary yuklab olingan faylga
    // kengaytmani AVTOMATIK BIRIKTIRMAYDI. public_id tasodifiy hash
    // bo'lib qolaversa, natijaviy URL/fayl nomi butunlay kengaytmasiz
    // chiqadi — Android buni APK deb TANIMAYDI ("ilova o'rniga g'alati
    // fayl ochiladi"), Windows ham EXE deb bilmaydi, PDF/DOCX ham hech
    // qayerda to'g'ri ochilmaydi. Yechim: kengaytmani public_id'ning
    // O'ZIGA aniq qo'shamiz (faqat 'raw' uchun — image/video'ga
    // tegilmaydi, ular Cloudinary'ning o'z format-boshqaruvi bilan
    // ishlayveradi, aks holda .jpg.jpg kabi ikkilangan kengaytma xavfi bor).
    opts.resource_type = 'raw';
    if (originalName) {
      const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'file';
      opts.public_id = `${base}-${Date.now()}${ext}`;
    }
  }
  // stablePublicId — har safar BIR XIL, O'ZGARMAS public_id + overwrite:true.
  // Deploy artifaktlari (APK/exe) uchun ishlatiladi: manzil (URL) hech qachon
  // o'zgarmaydi (landing page/profil doim "eng oxirgi" versiyaga ishonchli
  // havola beradi, DB yozuvi shart emas), va eski versiyalar Cloudinary'da
  // cheksiz to'planib qolmaydi (har CI build eskisini ALMASHTIRADI).
  if (opts2?.stablePublicId) {
    opts.public_id = opts2.stablePublicId;
    opts.overwrite = true;
    opts.invalidate = true; // CDN keshini ham yangilaydi — eski APK keshda qolib ketmasin
  }
  const result = await cloudinary.uploader.upload(filePath, opts);
  // Cloudinary'ga yuklangandan keyin local faylni o'chirish (disk tejash)
  try { fs.unlinkSync(filePath); } catch {}
  return { url: result.secure_url, publicId: result.public_id };
}

export async function deleteFromCloud(publicId: string): Promise<void> {
  if (!cloudinaryEnabled) return;
  try { await cloudinary.uploader.destroy(publicId); } catch {}
}

export { cloudinary };
