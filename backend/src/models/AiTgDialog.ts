import mongoose, { Schema, Document } from 'mongoose';

// Xodim QAYSI AI Telegram akkaunti bilan yozishgan (owner 2026-10-30).
//
// NEGA KERAK: Telegram notanish odamga qo'ng'iroq qilishni cheklaydi
// (PeerFloodError). Lekin odam akkauntga BIR MARTA yozgan bo'lsa — u endi
// notanish emas va cheklov unga tegmaydi.
//
// Owner holati aynan shu edi: u @erpfirma akkauntiga yozib turardi, lekin
// qo'ng'iroq boshqa akkauntdan (…515a) urinilib, PeerFlood bilan yiqilardi.
// Akkaunt tanlashda avval QO'NG'IROQ tarixi qaralardi — yozishma esa umuman
// hisobga olinmasdi, holbuki aynan u eng kuchli belgi.
//
// accountId = null — platforma akkaunti (foydalanuvchilar odatda shunga yozadi).

export interface IAiTgDialog extends Document {
  employeeId: string;
  /** Hovuz akkaunti id'si; null — platforma akkaunti. */
  accountId: string | null;
  lastAt: Date;
}

const AiTgDialogSchema: Schema = new Schema({
  employeeId: { type: String, required: true, index: true },
  accountId: { type: String, default: null },
  lastAt: { type: Date, default: () => new Date() },
}, { timestamps: true });

AiTgDialogSchema.index({ employeeId: 1, accountId: 1 }, { unique: true });

export default mongoose.model<IAiTgDialog>('AiTgDialog', AiTgDialogSchema);
