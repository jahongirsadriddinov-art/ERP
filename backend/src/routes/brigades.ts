import { Router } from 'express';
import Brigade from '../models/Brigade';
import BrigadeReview from '../models/BrigadeReview';
import { requireOwnerOrAdmin } from '../middleware/auth';
import { currentCompanyId } from '../middleware/tenantContext';
import { logAudit } from '../services/audit';
import { checkRate } from '../utils/rateLimit';
import User from '../models/User';
import { dealTotals, phoneKeyOf, publicReview, recomputeBrigade, validSourceUrl } from '../services/brigades';

// Brigada reytingi (owner 2026-10-29: "brigader reytingini qo'sh").
//
//  GET    /api/brigades?q=&region=&spec=       — ma'lumotnoma (barcha firmalar uchun umumiy)
//  POST   /api/brigades                        — yangi brigada qo'shish
//  GET    /api/brigades/:id                    — brigada + TASDIQLANGAN sharhlar
//  POST   /api/brigades/:id/reviews            — baho qoldirish (pending bo'lib tushadi)
//  GET    /api/brigades/reviews/pending        — o'z firmamdagi tasdiq kutayotganlar (rahbar)
//  POST   /api/brigades/reviews/:id/approve    — tasdiqlash (direktor/o'rinbosar)
//  POST   /api/brigades/reviews/:id/reject     — rad etish, sabab bilan
//
// MUHIM — SCOPED() ATAYIN ISHLATILMAYDI brigada o'qishlarida: reytingning butun
// foydasi boshqa firmalar tajribasini ko'rishda. Lekin sharh YOZISH va TASDIQLASH
// qat'iy firma doirasida: har firma faqat O'Z sharhini ko'radi va tasdiqlaydi.

const router = Router();

const SPECS_MAX = 6;
const PAGE = 30;

function cid(): string {
  return String(currentCompanyId() || '');
}

/** Audit jurnali uchun ism — boshqa yo'llardagi bilan bir xil ko'rinishda. */
async function actorName(userId: string): Promise<string> {
  if (!userId) return '';
  const u: any = await User.findById(userId).select('firstName lastName').lean().catch(() => null);
  return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '';
}

/** Ma'lumotnoma: nom/brigadir/mutaxassislik bo'yicha qidiruv, reyting bo'yicha tartib. */
router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    const region = String(req.query.region || '').trim().slice(0, 60);
    const spec = String(req.query.spec || '').trim().slice(0, 40);
    const filter: Record<string, unknown> = { hidden: { $ne: true } };
    if (region) filter.region = region;
    if (spec) filter.specializations = spec;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { leaderName: rx }, { phone: rx }];
    }
    const rows: any[] = await Brigade.find(filter)
      .sort({ avgScore: -1, reviewCount: -1, createdAt: -1 })
      .limit(PAGE).lean();
    res.json({
      brigades: rows.map((b) => ({
        id: String(b._id), name: b.name, leaderName: b.leaderName || '',
        phone: b.phone, region: b.region || '', specializations: b.specializations || [],
        avgScore: b.avgScore || 0, reviewCount: b.reviewCount || 0, firmCount: b.firmCount || 0,
        mine: String(b.createdByCompanyId || '') === cid(),
      })),
    });
  } catch (err) {
    console.error('[brigada] royxat xatosi:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

/** Yangi brigada. Telefon yagona kalit — takror kiritilsa borini qaytaradi. */
router.post('/', async (req, res) => {
  try {
    const userId = String(req.user?.userId || '');
    const r = checkRate(`brigade:add:${userId}`, 20, 3600_000);
    if (!r.allowed) return res.status(429).json({ error: "Juda ko'p so'rov", retryAfterSec: r.retryAfterSec });

    const name = String(req.body?.name || '').trim().slice(0, 120);
    const phone = String(req.body?.phone || '').trim().slice(0, 32);
    const phoneKey = phoneKeyOf(phone);
    if (name.length < 2) return res.status(400).json({ error: 'Brigada nomi kerak' });
    if (phoneKey.length < 9) return res.status(400).json({ error: "Telefon raqami to'g'ri emas" });

    const exists: any = await Brigade.findOne({ phoneKey }).lean();
    if (exists) return res.json({ ok: true, existed: true, id: String(exists._id), name: exists.name });

    const specializations = (Array.isArray(req.body?.specializations) ? req.body.specializations : [])
      .map((s: unknown) => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, SPECS_MAX);
    const doc: any = await Brigade.create({
      name, phone, phoneKey, specializations,
      leaderName: String(req.body?.leaderName || '').trim().slice(0, 120) || undefined,
      region: String(req.body?.region || '').trim().slice(0, 60) || undefined,
      note: String(req.body?.note || '').trim().slice(0, 500) || undefined,
      createdByCompanyId: cid() || undefined,
      createdBy: userId || undefined,
    });
    void logAudit({
      userId, userName: await actorName(userId), userRole: String(req.user?.role || ''),
      action: 'create', entity: 'brigade', entityId: String(doc._id),
      description: `Brigada qo'shildi: ${name}`, companyId: cid(), req,
    });
    res.status(201).json({ ok: true, id: String(doc._id) });
  } catch (err: any) {
    if (err?.code === 11000) return res.status(409).json({ error: 'Bu raqam bilan brigada allaqachon bor' });
    console.error('[brigada] qoshish xatosi:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

/** Tasdiq kutayotganlar — FAQAT o'z firmasidagi (rahbar ko'radi). */
router.get('/reviews/pending', requireOwnerOrAdmin, async (req, res) => {
  try {
    const company = cid();
    if (!company) return res.json({ reviews: [] });
    const rows: any[] = await BrigadeReview.find({ companyId: company, status: 'pending' })
      .sort({ createdAt: -1 }).limit(50).lean();
    const brigades: any[] = await Brigade.find({ _id: { $in: rows.map((r) => r.brigadeId) } }).select('name phone').lean();
    const byId = new Map(brigades.map((b) => [String(b._id), b]));
    res.json({
      reviews: rows.map((r) => ({
        ...publicReview(r),
        brigadeId: String(r.brigadeId),
        brigadeName: byId.get(String(r.brigadeId))?.name || '—',
        sourceNote: r.sourceNote || '',
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error('[brigada] kutayotganlar xatosi:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

/** Brigada kartasi: tasdiqlangan sharhlar (kim baholagani ko'rsatilmaydi). */
router.get('/:id', async (req, res) => {
  try {
    const b: any = await Brigade.findById(req.params.id).lean();
    if (!b || b.hidden) return res.status(404).json({ error: 'Brigada topilmadi' });
    const rows: any[] = await BrigadeReview.find({ brigadeId: b._id, status: 'approved' })
      .sort({ reviewedAt: -1 }).limit(50).lean();
    // O'z firmamning sharhi qanday holatda — muallif ko'rishi kerak
    const mine: any = cid() ? await BrigadeReview.findOne({ brigadeId: b._id, companyId: cid() }).lean() : null;
    res.json({
      brigade: {
        id: String(b._id), name: b.name, leaderName: b.leaderName || '', phone: b.phone,
        region: b.region || '', specializations: b.specializations || [], note: b.note || '',
        avgScore: b.avgScore || 0, reviewCount: b.reviewCount || 0, firmCount: b.firmCount || 0,
      },
      reviews: rows.map(publicReview),
      myReview: mine ? { ...publicReview(mine), status: mine.status, rejectReason: mine.rejectReason || '' } : null,
    });
  } catch (err) {
    console.error('[brigada] karta xatosi:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

/**
 * Baho qoldirish. Har doim 'pending' — rahbar tasdiqlamaguncha reytingga qo'shilmaydi.
 * Manba havolasi SHART: owner qarori "qayerdan olganini aytadi, link beradi".
 */
router.post('/:id/reviews', async (req, res) => {
  try {
    const company = cid();
    const userId = String(req.user?.userId || '');
    if (!company) return res.status(400).json({ error: 'Firma aniqlanmadi' });
    const rl = checkRate(`brigade:rev:${userId}`, 30, 3600_000);
    if (!rl.allowed) return res.status(429).json({ error: "Juda ko'p so'rov", retryAfterSec: rl.retryAfterSec });

    const b: any = await Brigade.findById(req.params.id).select('_id name hidden').lean();
    if (!b || b.hidden) return res.status(404).json({ error: 'Brigada topilmadi' });

    const score = Math.round(Number(req.body?.score));
    if (!(score >= 1 && score <= 5)) return res.status(400).json({ error: 'Baho 1 dan 5 gacha' });
    const sourceUrl = String(req.body?.sourceUrl || '').trim();
    if (!validSourceUrl(sourceUrl)) {
      return res.status(400).json({ error: "Manba havolasi kerak (http/https, tekshirib ko'rish uchun)" });
    }

    const totals = dealTotals({
      volume: Number(req.body?.volume), ratePerUnit: Number(req.body?.ratePerUnit), penalty: Number(req.body?.penalty),
    });
    const update = {
      score, sourceUrl,
      comment: String(req.body?.comment || '').trim().slice(0, 1000) || undefined,
      workType: String(req.body?.workType || '').trim().slice(0, 80) || undefined,
      unit: String(req.body?.unit || '').trim().slice(0, 16) || undefined,
      volume: Number(req.body?.volume) > 0 ? Number(req.body.volume) : undefined,
      ratePerUnit: Number(req.body?.ratePerUnit) > 0 ? Number(req.body.ratePerUnit) : undefined,
      agreedTotal: totals.agreedTotal, payable: totals.payable, penalty: totals.penalty,
      penaltyReason: String(req.body?.penaltyReason || '').trim().slice(0, 300) || undefined,
      sourceNote: String(req.body?.sourceNote || '').trim().slice(0, 300) || undefined,
      // Qayta yuborilsa — yangidan tasdiqlanadi (o'zgargan bahoni tasdiqsiz o'tkazib bo'lmaydi)
      status: 'pending' as const, sourceVerified: false,
      reviewedBy: undefined, reviewedAt: undefined, rejectReason: undefined,
      authorId: userId,
    };
    const doc: any = await BrigadeReview.findOneAndUpdate(
      { brigadeId: b._id, companyId: company },
      { $set: update, $setOnInsert: { brigadeId: b._id, companyId: company } },
      { upsert: true, new: true },
    );
    // Eski baho tasdiqlangan bo'lsa — reyting darhol qayta hisoblanadi (endi pending)
    await recomputeBrigade(String(b._id));
    res.status(201).json({ ok: true, id: String(doc._id), status: 'pending' });
  } catch (err) {
    console.error('[brigada] baho xatosi:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

/** Tasdiqlash — faqat O'Z firmasining sharhini (direktor/o'rinbosar/ega). */
router.post('/reviews/:id/approve', requireOwnerOrAdmin, async (req, res) => {
  try {
    const company = cid();
    const r: any = await BrigadeReview.findOne({ _id: req.params.id, companyId: company });
    if (!r) return res.status(404).json({ error: 'Sharh topilmadi' });
    // "Link beradi va tekshiriladi" — tasdiqlovchi havolani ko'rganini belgilaydi
    const verified = req.body?.sourceVerified !== false;
    r.status = 'approved'; r.sourceVerified = verified;
    r.reviewedBy = String(req.user?.userId || ''); r.reviewedAt = new Date(); r.rejectReason = undefined;
    await r.save();
    const agg = await recomputeBrigade(String(r.brigadeId));
    void logAudit({
      userId: String(req.user?.userId || ''), userName: await actorName(String(req.user?.userId || '')), userRole: String(req.user?.role || ''),
      action: 'approve', entity: 'brigade_review', entityId: String(r._id),
      description: `Brigada bahosi tasdiqlandi (${r.score}/5)${verified ? ', manba tekshirildi' : ''}`,
      companyId: company, req,
    });
    res.json({ ok: true, ...agg });
  } catch (err) {
    console.error('[brigada] tasdiqlash xatosi:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

/** Rad etish — sabab yoziladi, yozuv o'chirilmaydi (nizo asosiy tizimda hal bo'ladi). */
router.post('/reviews/:id/reject', requireOwnerOrAdmin, async (req, res) => {
  try {
    const company = cid();
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (reason.length < 3) return res.status(400).json({ error: 'Rad etish sababini yozing' });
    const r: any = await BrigadeReview.findOne({ _id: req.params.id, companyId: company });
    if (!r) return res.status(404).json({ error: 'Sharh topilmadi' });
    r.status = 'rejected'; r.rejectReason = reason;
    r.reviewedBy = String(req.user?.userId || ''); r.reviewedAt = new Date();
    await r.save();
    const agg = await recomputeBrigade(String(r.brigadeId));
    void logAudit({
      userId: String(req.user?.userId || ''), userName: await actorName(String(req.user?.userId || '')), userRole: String(req.user?.role || ''),
      action: 'reject', entity: 'brigade_review', entityId: String(r._id),
      description: `Brigada bahosi rad etildi: ${reason}`, companyId: company, req,
    });
    res.json({ ok: true, ...agg });
  } catch (err) {
    console.error('[brigada] rad etish xatosi:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
