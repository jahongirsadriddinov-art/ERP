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

// Cloudinary mavjud bo'lsa shunga, yo'q bo'lsa localga yuklaydi
export async function uploadFileToCloud(filePath: string, folder = 'qurilish-erp'): Promise<{ url: string; publicId?: string }> {
  if (!cloudinaryEnabled) {
    // Local fayl URL qaytaradi
    const fileName = path.basename(filePath);
    return { url: `${getBackendUrl()}/uploads/${fileName}` };
  }
  const result = await cloudinary.uploader.upload(filePath, { folder, resource_type: 'auto' });
  // Cloudinary'ga yuklangandan keyin local faylni o'chirish (disk tejash)
  try { fs.unlinkSync(filePath); } catch {}
  return { url: result.secure_url, publicId: result.public_id };
}

export async function deleteFromCloud(publicId: string): Promise<void> {
  if (!cloudinaryEnabled) return;
  try { await cloudinary.uploader.destroy(publicId); } catch {}
}

export { cloudinary };
