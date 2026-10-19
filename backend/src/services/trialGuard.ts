// Bepul sinov (7 kun) — bitta QURILMA uchun faqat BIR MARTA. Qurilma bir nechta belgidan taniladi:
//  • device — ilova/brauzerda saqlanadigan doimiy ID (X-Device-Id),
//  • fp     — qurilma "barmoq izi" (ekran, tizim, brauzer xususiyatlari — X-Device-Fp; xotira tozalansa ham o'zgarmaydi),
//  • tg     — Telegram hisobi (ro'yxatdan o'tish bot orqali tasdiqlanadi),
//  • phone  — telefon raqami.
// Sinov olinganda barcha belgilar yoziladi. Bundan tashqari HAR QANDAY hisob bilan kirilgan qurilma ham yoziladi —
// shuning uchun eski hisob ulangan qurilmadan yangi hisob ochib sinov olib bo'lmaydi.
import mongoose, { Schema } from 'mongoose';

const TrialMarkSchema = new Schema({
  kind: { type: String, enum: ['device', 'fp', 'tg', 'phone'], required: true },
  value: { type: String, required: true },
  reason: { type: String, enum: ['trial', 'login'], required: true },
  companyId: String,
  userId: String,
}, { timestamps: true });
TrialMarkSchema.index({ kind: 1, value: 1 });
const TrialMark = mongoose.models.TrialMark || mongoose.model('TrialMark', TrialMarkSchema);

const clean = (v: unknown, max = 128) => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{8,}$/.test(v) ? v.slice(0, max) : '');

export function deviceSignals(req: { headers: any }): { device: string; fp: string } {
  return { device: clean(req.headers?.['x-device-id']), fp: clean(req.headers?.['x-device-fp']) };
}

/** Sinov olish mumkinmi? Mumkin bo'lmasa — sababi (foydalanuvchiga ko'rsatiladigan matn). */
export async function trialBlockedReason(req: { headers: any }, extra: { tg?: string; phone?: string }): Promise<string | null> {
  const { device, fp } = deviceSignals(req);
  // Ilova/brauzer qurilma belgisini yubormasa (eski versiya yoki atayin o'chirilgan) — sinov berilmaydi
  if (!device && !fp) return "Bepul sinovni faqat ilovaning yangi versiyasidan yoki saytdan olish mumkin — sahifani yangilang.";
  const or: any[] = [];
  if (device) or.push({ kind: 'device', value: device });
  if (fp) or.push({ kind: 'fp', value: fp });
  if (extra.tg) or.push({ kind: 'tg', value: String(extra.tg), reason: 'trial' });
  if (extra.phone) or.push({ kind: 'phone', value: String(extra.phone), reason: 'trial' });
  const hit: any = await TrialMark.findOne({ $or: or }).lean();
  if (!hit) return null;
  return hit.reason === 'login'
    ? "Bu qurilmada avval tizimdan foydalanilgan — bepul sinov faqat yangi qurilmada bir marta beriladi. Pullik tarifni tanlang."
    : "Bepul sinov bu qurilma (yoki Telegram hisobi/raqam) uchun allaqachon ishlatilgan. Pullik tarifni tanlang.";
}

export async function markTrial(req: { headers: any }, extra: { tg?: string; phone?: string; companyId?: string; userId?: string }) {
  const { device, fp } = deviceSignals(req);
  const docs: any[] = [];
  if (device) docs.push({ kind: 'device', value: device });
  if (fp) docs.push({ kind: 'fp', value: fp });
  if (extra.tg) docs.push({ kind: 'tg', value: String(extra.tg) });
  if (extra.phone) docs.push({ kind: 'phone', value: String(extra.phone) });
  if (docs.length) await TrialMark.insertMany(docs.map(d => ({ ...d, reason: 'trial', companyId: extra.companyId, userId: extra.userId }))).catch(() => {});
}

/** Har bir muvaffaqiyatli kirishda — shu qurilma "ishlatilgan" deb belgilanadi (takrorlanmaydi). */
export async function markLoginDevice(req: { headers: any }, userId: string) {
  const { device, fp } = deviceSignals(req);
  for (const [kind, value] of [['device', device], ['fp', fp]] as const) {
    if (!value) continue;
    await TrialMark.updateOne({ kind, value }, { $setOnInsert: { kind, value, reason: 'login', userId } }, { upsert: true }).catch(() => {});
  }
}

/** Dasturchi firmani o'chirganda (owner 2026-10-19): o'sha firma/xodimlarga bog'liq sinov belgilari olinadi — qayta firma ocha olsin. */
export async function clearTrialMarks(companyId: string, userIds: string[]) {
  await TrialMark.deleteMany({ $or: [{ companyId }, ...(userIds.length ? [{ userId: { $in: userIds } }] : [])] }).catch(() => {});
}
