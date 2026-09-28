import { Router } from 'express';
import crypto from 'crypto';
import SignedDoc from '../models/SignedDoc';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { nextSequence } from '../models/Counter';
import { checkRate } from '../utils/rateLimit';

// Elektron hujjatlar va imzo. Yaratish/imzolash — rahbar va prorab; mijoz — ochiq havola orqali.
const router = Router();
export const publicSignRouter = Router();

const TYPES = ['shartnoma', 'akt', 'nakladnoy'] as const;
const TITLES: Record<string, string> = { shartnoma: 'Pudrat shartnomasi', akt: 'Bajarilgan ishlar dalolatnomasi', nakladnoy: 'Yuk xati (nakladnoy)' };
const PREFIX: Record<string, string> = { shartnoma: 'SH', akt: 'AKT', nakladnoy: 'YX' };
const MAX_SIG_BYTES = 400_000; // chizilgan yoki yuklangan (kichraytirilgan) imzo/pechat rasmi
const MAX_DATA_BYTES = 200_000;

async function canManage(): Promise<{ ok: boolean; user?: any }> {
  const t = getTenant();
  if (!t?.userId || t.isDeveloper) return { ok: false };
  const u: any = await User.findById(t.userId).select('role firstName lastName isOwner').lean();
  return { ok: !!u && (u.isOwner || ['direktor', 'orinbosar', 'prorab'].includes(u.role)), user: u };
}
const validSignature = (image: unknown) =>
  typeof image === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image) && image.length <= MAX_SIG_BYTES;
// Pechat ixtiyoriy: berilmagan bo'lsa undefined, berilgan-u noto'g'ri bo'lsa false
const parseStamp = (stamp: unknown): string | undefined | false =>
  stamp === undefined || stamp === null || stamp === '' ? undefined : validSignature(stamp) ? String(stamp) : false;
// Faqat oddiy JSON (satr/son/massiv/obyekt) — hajmi cheklangan
const cleanData = (d: unknown) => {
  if (!d || typeof d !== 'object') return {};
  const json = JSON.stringify(d);
  if (json.length > MAX_DATA_BYTES) throw new Error('TOO_BIG');
  return JSON.parse(json);
};
const recomputeStatus = (sigs: any[]) => {
  const sides = new Set(sigs.map(s => s.side));
  return sides.has('executor') && sides.has('customer') ? 'signed' : sides.size ? 'partially_signed' : 'draft';
};
const shareUrl = (token: string) => `${(process.env.SITE_URL || 'http://localhost:5173').replace(/\/$/, '')}/sign/${token}`;

router.get('/', async (_req, res) => {
  const docs = await SignedDoc.find(scoped()).sort({ createdAt: -1 }).limit(300)
    .select('type number title status projectId createdByName createdAt signatures.side signatures.name signatures.signedAt').lean();
  res.json(docs.map((d: any) => ({ ...d, id: d._id })));
});

router.get('/:id', async (req, res) => {
  const d: any = await SignedDoc.findOne(scoped({ _id: req.params.id })).lean().catch(() => null);
  if (!d) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ ...d, id: d._id, shareUrl: d.shareToken ? shareUrl(d.shareToken) : undefined });
});

router.post('/', async (req, res) => {
  try {
    const { ok, user } = await canManage();
    if (!ok) return res.status(403).json({ error: "Ruxsat yo'q" });
    const { type, data, projectId } = req.body || {};
    if (!TYPES.includes(type)) return res.status(400).json({ error: "Noto'g'ri hujjat turi" });
    const t = getTenant()!;
    const seq = await nextSequence(`signdoc-${t.companyId}-${type}-${new Date().getFullYear()}`);
    const number = `${PREFIX[type]}-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`;
    const doc = await SignedDoc.create(stamped({
      type, number, title: TITLES[type], data: cleanData(data),
      projectId: typeof projectId === 'string' ? projectId : undefined,
      createdBy: t.userId, createdByName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    }));
    res.status(201).json({ ...doc.toObject(), id: doc._id });
  } catch (e) {
    if ((e as Error).message === 'TOO_BIG') return res.status(413).json({ error: 'Hujjat juda katta' });
    console.error('[signdoc create]', e);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Imzo qo'yilmagan hujjatnigina tahrirlash mumkin (imzolangan matn o'zgarmasin)
router.put('/:id', async (req, res) => {
  try {
    const { ok } = await canManage();
    if (!ok) return res.status(403).json({ error: "Ruxsat yo'q" });
    const doc: any = await SignedDoc.findOne(scoped({ _id: req.params.id }));
    if (!doc) return res.status(404).json({ error: 'Topilmadi' });
    if (doc.signatures.length) return res.status(409).json({ error: "Imzolangan hujjatni o'zgartirib bo'lmaydi" });
    doc.data = cleanData(req.body?.data);
    if (typeof req.body?.projectId === 'string') doc.projectId = req.body.projectId;
    await doc.save();
    res.json({ ...doc.toObject(), id: doc._id });
  } catch (e) {
    if ((e as Error).message === 'TOO_BIG') return res.status(413).json({ error: 'Hujjat juda katta' });
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Ijrochi (firma) tomoni imzosi
router.post('/:id/sign', async (req, res) => {
  const { ok } = await canManage();
  if (!ok) return res.status(403).json({ error: "Ruxsat yo'q" });
  const { name, image } = req.body || {};
  if (!name || typeof name !== 'string' || !validSignature(image)) return res.status(400).json({ error: "Ism va imzo kerak" });
  const stamp = parseStamp(req.body?.stamp);
  if (stamp === false) return res.status(400).json({ error: "Pechat rasmi noto'g'ri yoki juda katta" });
  const doc: any = await SignedDoc.findOne(scoped({ _id: req.params.id }));
  if (!doc) return res.status(404).json({ error: 'Topilmadi' });
  if (doc.signatures.some((s: any) => s.side === 'executor')) return res.status(409).json({ error: 'Bu tomon allaqachon imzolagan' });
  doc.signatures.push({ side: 'executor', name: name.trim().slice(0, 120), image, stamp, signedAt: new Date(), userId: getTenant()!.userId, ip: req.ip });
  doc.status = recomputeStatus(doc.signatures);
  await doc.save();
  res.json({ ...doc.toObject(), id: doc._id });
});

// Mijoz uchun imzolash havolasi
router.post('/:id/share', async (req, res) => {
  const { ok } = await canManage();
  if (!ok) return res.status(403).json({ error: "Ruxsat yo'q" });
  const doc: any = await SignedDoc.findOne(scoped({ _id: req.params.id }));
  if (!doc) return res.status(404).json({ error: 'Topilmadi' });
  if (!doc.shareToken) { doc.shareToken = crypto.randomBytes(24).toString('hex'); await doc.save(); }
  res.json({ url: shareUrl(doc.shareToken) });
});

router.delete('/:id', async (req, res) => {
  const { ok, user } = await canManage();
  if (!ok || !(user.isOwner || ['direktor', 'orinbosar'].includes(user.role))) return res.status(403).json({ error: "Ruxsat yo'q" });
  const doc: any = await SignedDoc.findOne(scoped({ _id: req.params.id }));
  if (!doc) return res.status(404).json({ error: 'Topilmadi' });
  if (doc.status === 'signed') return res.status(409).json({ error: "Ikki tomon imzolagan hujjatni o'chirib bo'lmaydi" });
  await doc.deleteOne();
  res.json({ ok: true });
});

// ── Ochiq (login'siz) — mijoz havola orqali ko'radi va imzolaydi ────────────
const TOKEN_RE = /^[0-9a-f]{48}$/;
publicSignRouter.get('/sign/:token', async (req, res) => {
  if (!checkRate(`pubsign:${req.ip}`, 60, 10 * 60 * 1000).allowed) return res.status(429).json({ error: "Juda ko'p so'rov" });
  if (!TOKEN_RE.test(req.params.token)) return res.status(404).json({ error: 'Topilmadi' });
  const d: any = await SignedDoc.findOne({ shareToken: req.params.token }).select('type number title data status signatures createdAt').lean();
  if (!d) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ type: d.type, number: d.number, title: d.title, data: d.data, status: d.status, createdAt: d.createdAt,
    signatures: (d.signatures || []).map((s: any) => ({ side: s.side, name: s.name, image: s.image, stamp: s.stamp, signedAt: s.signedAt })) });
});
publicSignRouter.post('/sign/:token', async (req, res) => {
  if (!checkRate(`pubsign-post:${req.ip}`, 10, 10 * 60 * 1000).allowed) return res.status(429).json({ error: "Juda ko'p urinish" });
  if (!TOKEN_RE.test(req.params.token)) return res.status(404).json({ error: 'Topilmadi' });
  const { name, image } = req.body || {};
  if (!name || typeof name !== 'string' || name.trim().length < 2 || !validSignature(image)) return res.status(400).json({ error: "Ism va imzo kerak" });
  const stamp = parseStamp(req.body?.stamp);
  if (stamp === false) return res.status(400).json({ error: "Pechat rasmi noto'g'ri yoki juda katta" });
  const doc: any = await SignedDoc.findOne({ shareToken: req.params.token });
  if (!doc) return res.status(404).json({ error: 'Topilmadi' });
  if (doc.signatures.some((s: any) => s.side === 'customer')) return res.status(409).json({ error: 'Hujjat allaqachon imzolangan' });
  doc.signatures.push({ side: 'customer', name: name.trim().slice(0, 120), image, stamp, signedAt: new Date(), ip: req.ip });
  doc.status = recomputeStatus(doc.signatures);
  await doc.save();
  // Firma rahbarlariga xabar
  import('../services/bot').then(async ({ bot }) => {
    const bosses: any[] = await User.find({ companyId: doc.companyId, role: { $in: ['direktor', 'orinbosar'] }, telegramChatId: { $exists: true, $ne: '' } }).select('telegramChatId').lean();
    for (const b of bosses) bot.sendMessage(b.telegramChatId, `✍️ Mijoz hujjatni imzoladi\n📄 ${doc.title} № ${doc.number}\n👤 ${name.trim()}`).catch(() => {});
  }).catch(() => {});
  res.json({ ok: true, status: doc.status });
});

export default router;
