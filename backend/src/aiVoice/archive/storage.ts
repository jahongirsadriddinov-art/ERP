import mongoose from 'mongoose';
import '../../services/durableFiles';   // StoredFile modelini ro'yxatga oladi (mavjud doimiy fayl ombori)

// Arxiv fayllari ombori. Standart — loyihaning mavjud doimiy ombori (MongoDB StoredFile, services/durableFiles).
// Nom ATAYLAB ':' bilan — durableFiles SAFE_NAME'ga mos emas, shuning uchun ommaviy /uploads/:name orqali
// HECH QACHON berilmaydi; faqat autentifikatsiyali arxiv yo'llari (direktor — o'z firmasi, dasturchi — hammasi).

export const ARCHIVE_PREFIX = 'aiarch:';
/** StoredFile hujjati 16 MB bilan cheklangan (durableFiles MAX_BYTES 15 MB). */
export const ARCHIVE_MAX_BYTES = 15 * 1024 * 1024;

export interface ArchiveStorage {
  /** Faylni yozadi va o'qib tekshiradi; muvaffaqiyatsiz bo'lsa — xato tashlaydi. */
  put(name: string, data: Buffer): Promise<{ ref: string; size: number }>;
  get(ref: string): Promise<Buffer | null>;
  remove(ref: string): Promise<void>;
}

const storedFile = (): any => mongoose.model('StoredFile');

/** lean() natijasi: Buffer yoki BSON Binary ({buffer, position}). Node Buffer'ning .buffer'i (umumiy pool) ISHLATILMAYDI. */
function toBuffer(d: any): Buffer | null {
  if (!d) return null;
  if (Buffer.isBuffer(d)) return d;
  if (d.buffer instanceof Uint8Array) {
    const len = typeof d.position === 'number' ? d.position : d.buffer.length;
    return Buffer.from(d.buffer.subarray(0, len));
  }
  if (d instanceof Uint8Array) return Buffer.from(d);
  return null;
}

export const mongoArchiveStorage: ArchiveStorage = {
  async put(name, data) {
    if (!name.startsWith(ARCHIVE_PREFIX)) throw new Error('arxiv nomi noto\'g\'ri');
    if (data.length > ARCHIVE_MAX_BYTES) throw new Error('arxiv qismi juda katta');
    const M = storedFile();
    await M.updateOne({ name }, { $set: { name, contentType: 'application/gzip', size: data.length, data } }, { upsert: true });
    // Yozuv haqiqatan saqlanganini tekshiramiz — shundan keyingina bazadagi qatorlar o'chiriladi
    // (size maydoni emas — haqiqiy baytlar solishtiriladi)
    const back: any = await M.findOne({ name }).select('data').lean();
    const raw = toBuffer(back?.data);
    if (!raw || !raw.equals(data)) throw new Error('arxiv fayli saqlanmadi');
    return { ref: `mongo:${name}`, size: data.length };
  },
  async get(ref) {
    if (!ref.startsWith(`mongo:${ARCHIVE_PREFIX}`)) return null;
    const doc: any = await storedFile().findOne({ name: ref.slice('mongo:'.length) }).lean();
    return toBuffer(doc?.data);
  },
  async remove(ref) {
    if (!ref.startsWith(`mongo:${ARCHIVE_PREFIX}`)) return;
    await storedFile().deleteOne({ name: ref.slice('mongo:'.length) });
  },
};

let current: ArchiveStorage = mongoArchiveStorage;
export function archiveStorage(): ArchiveStorage { return current; }
/** Faqat testlar uchun (saqlash xatosini taqlid qilish). null — standart. */
export function __setArchiveStorageForTests(s: ArchiveStorage | null): void { current = s || mongoArchiveStorage; }
