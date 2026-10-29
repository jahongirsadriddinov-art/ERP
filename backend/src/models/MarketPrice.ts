import mongoose, { Schema, Document } from 'mongoose';

// Bozor narxi nuqtasi — "narx razvedkasi" uchun (owner 2026-10-29: "prorab qimmatga olsa
// ogohlantirsin; qimmatligini O'ZBEKISTON BO'YICHA o'rtacha narxdan biladi").
//
// Har bir nuqta — bitta kuzatuv: "shu material, shu birlikda, shuncha turdi".
// Manbalar (source):
//   receipt  — firmalarning o'z xaridlari (Transaction.price). BEPUL, DARHOL, eng ishonchli:
//              bu haqiqiy to'langan narx, e'lon emas.
//   telegram — narx e'lon qiladigan ochiq kanallar (keyinroq ulanadi)
//   olx      — ochiq e'lonlar (keyinroq)
//   manual   — dasturchi qo'lda kiritgani
//
// MAXFIYLIK: companyId faqat ichki hisob uchun (bir firma narxni sun'iy ko'tarmasin va
// takrorlar hisoblanmasin). Tashqariga HECH QACHON berilmaydi — faqat yig'ma ko'rsatkich
// va u ham kamida bir nechta TURLI firma bo'lgandagina (marketPrice.ts: MIN_COMPANIES).
export interface IMarketPrice extends Document {
  /** Qidirish uchun soddalashtirilgan nom (translit + fonetik) — "sement m400" */
  key: string;
  /** Ko'rsatish uchun asl nom */
  name: string;
  /** Birlik: qop, kg, tonna, dona, m2, m3, litr... Birligi boshqa narx SOLISHTIRILMAYDI. */
  unit: string;
  /** Birlik narxi, so'mda (valyutali xarid kursda so'mga o'giriladi) */
  price: number;
  region?: string;
  source: 'receipt' | 'telegram' | 'olx' | 'manual';
  /** receipt uchun — qaysi firma (faqat ichki: takror va manipulyatsiyaga qarshi) */
  companyId?: string;
  /** receipt uchun — qaysi yozuvdan (qayta indekslashda takrorlanmasin) */
  refId?: string;
  at: Date;
}

const MarketPriceSchema = new Schema<IMarketPrice>({
  key: { type: String, required: true },
  name: { type: String, required: true },
  unit: { type: String, required: true },
  price: { type: Number, required: true },
  region: { type: String },
  source: { type: String, enum: ['receipt', 'telegram', 'olx', 'manual'], required: true },
  companyId: { type: String },
  refId: { type: String },
  at: { type: Date, required: true },
}, { timestamps: true });

// Qidiruv: nom + birlik + sana bo'yicha (so'rov DOIM shu uchtasi bilan keladi)
MarketPriceSchema.index({ key: 1, unit: 1, at: -1 });
// Bitta xarid ikki marta indekslanmasin
MarketPriceSchema.index({ source: 1, refId: 1 }, { unique: true, sparse: true });
// Eskisi o'zi o'chadi — bozor narxi 180 kundan keyin ma'nosiz
MarketPriceSchema.index({ at: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

export default mongoose.model<IMarketPrice>('MarketPrice', MarketPriceSchema);
