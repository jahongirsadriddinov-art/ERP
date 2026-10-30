import Brigade from '../models/Brigade';
import BrigadeReview from '../models/BrigadeReview';

// Brigada reytingi — hisob-kitob qoidalari bitta joyda (yo'llar faqat chaqiradi,
// shuning uchun qoidani testlash oson va ikki joyda farq qilib ketmaydi).

/** Telefonni yagona kalitga keltiradi: faqat raqamlar, boshidagi 998 bilan. */
export function phoneKeyOf(phone: unknown): string {
  const d = String(phone || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  // 901234567 → 998901234567; 8901234567 → 998901234567
  if (d.length === 9) return `998${d}`;
  if (d.length === 10 && d.startsWith('8')) return `998${d.slice(1)}`;
  return d.slice(0, 15);
}

/**
 * Kelishuv hisobi (owner qarori 2): birlik narxi × hajm = kelishilgan summa,
 * shtraf ayiriladi. Hisob SERVERDA — klient yuborgan jamiga ishonilmaydi.
 * To'lanadigan summa manfiy bo'lmaydi (shtraf summadan katta bo'lsa — 0).
 */
export function dealTotals(p: { volume?: number; ratePerUnit?: number; penalty?: number }):
  { agreedTotal?: number; payable?: number; penalty: number } {
  const penalty = Math.max(0, Math.round(Number(p.penalty) || 0));
  const vol = Number(p.volume);
  const rate = Number(p.ratePerUnit);
  if (!(vol > 0) || !(rate > 0)) return { penalty };
  const agreedTotal = Math.round(vol * rate);
  return { agreedTotal, payable: Math.max(0, agreedTotal - penalty), penalty };
}

/** Manba havolasi — http(s) va haqiqiy domen bo'lishi shart (qarorning 1-sharti). */
export function validSourceUrl(url: unknown): boolean {
  const s = String(url || '').trim();
  if (s.length < 8 || s.length > 500) return false;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // Nuqtasiz host ("localhost", "intranet") — tekshirib bo'lmaydigan havola
    return u.hostname.includes('.') && !/\s/.test(s);
  } catch {
    return false;
  }
}

/**
 * Yig'ma bahoni qayta hisoblaydi. FAQAT tasdiqlangan sharhlar hisobga olinadi —
 * tasdiqlanmagan baho reytingga ta'sir qilmasligi kerak, aks holda tasdiqlash
 * qoidasining ma'nosi qolmaydi.
 */
export async function recomputeBrigade(brigadeId: string): Promise<{ avgScore: number; reviewCount: number; firmCount: number }> {
  const rows: any[] = await BrigadeReview.find({ brigadeId, status: 'approved' }).select('score companyId').lean();
  const reviewCount = rows.length;
  const firmCount = new Set(rows.map((r) => String(r.companyId))).size;
  const avgScore = reviewCount
    ? Math.round((rows.reduce((s, r) => s + (Number(r.score) || 0), 0) / reviewCount) * 10) / 10
    : 0;
  await Brigade.updateOne({ _id: brigadeId }, { $set: { avgScore, reviewCount, firmCount } });
  return { avgScore, reviewCount, firmCount };
}

/** Boshqa firmaga ko'rsatiladigan ko'rinish — kim baholaganini oshkor qilmaydi. */
export function publicReview(r: any): Record<string, unknown> {
  return {
    id: String(r._id),
    score: r.score,
    comment: r.comment || '',
    workType: r.workType || '',
    unit: r.unit || '',
    volume: r.volume ?? null,
    ratePerUnit: r.ratePerUnit ?? null,
    agreedTotal: r.agreedTotal ?? null,
    penalty: r.penalty || 0,
    penaltyReason: r.penaltyReason || '',
    payable: r.payable ?? null,
    sourceUrl: r.sourceUrl,
    sourceVerified: !!r.sourceVerified,
    at: r.reviewedAt || r.createdAt,
  };
}
