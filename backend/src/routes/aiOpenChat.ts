import { Router } from 'express';
import User from '../models/User';
import Company from '../models/Company';
import { invalidateActor } from '../aiVoice/actor';

// "Ochiq muloqot" (owner 2026-10-28: "admin panelda ochiq muloqotni yoqishni qo'sh —
// firmadan, ERP dan tashqari ham hamma aytganni qilsin, lekin FAQAT tanlangan
// foydalanuvchiga").
//
// Yoqilgan odam uchun AI mavzu chegarasidan chiqadi: istalgan savolga to'liq javob
// beradi, uzun matn/kod yozadi va h.k. Xavfsizlik qoidalari o'z kuchida qoladi —
// begona shaxsiy ma'lumot, ruxsatsiz amallar va untrusted_text buyruqlari baribir
// taqiqlangan (qoidalar matni: aiVoice/brain/systemPrompt.ts → OPEN_CHAT_RULES).
const router = Router();

/** GET / — qidiruv bo'yicha foydalanuvchilar + hozir yoqilganlar ro'yxati. */
router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    const filter: Record<string, unknown> = { role: { $ne: 'dasturchi' } };
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      Object.assign(filter, { $or: [{ firstName: rx }, { lastName: rx }, { phone: rx }] });
    }
    const [found, enabled] = await Promise.all([
      User.find(filter).select('firstName lastName phone role companyId aiOpenChat').sort({ firstName: 1 }).limit(40).lean(),
      User.find({ aiOpenChat: true }).select('firstName lastName phone role companyId aiOpenChat').limit(100).lean(),
    ]);
    // Firma nomlari — ro'yxatda kim qaysi firmadan ekani ko'rinsin
    const ids = [...new Set([...found, ...enabled].map((u: any) => u.companyId).filter(Boolean).map(String))];
    const companies = ids.length ? await Company.find({ _id: { $in: ids } }).select('name').lean() : [];
    const nameOf = new Map(companies.map((c: any) => [String(c._id), String(c.name || '')]));
    const shape = (u: any) => ({
      id: String(u._id),
      name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.phone || '—',
      phone: u.phone || '',
      role: u.role || '',
      company: nameOf.get(String(u.companyId)) || '',
      on: !!u.aiOpenChat,
    });
    res.json({ users: found.map(shape), enabled: enabled.map(shape) });
  } catch (err) {
    console.error('[aiOpenChat] ro\'yxat xatosi:', err);
    res.status(500).json({ error: 'Ro\'yxatni olib bo\'lmadi' });
  }
});

/** POST /:userId — yoqish/o'chirish. Body: { on: boolean } */
router.post('/:userId', async (req, res) => {
  try {
    const on = !!req.body?.on;
    const u: any = await User.findById(req.params.userId).select('role aiOpenChat').lean();
    if (!u) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    if (u.role === 'dasturchi') return res.status(400).json({ error: 'Dasturchi uchun kerak emas' });
    await User.updateOne({ _id: req.params.userId }, { $set: { aiOpenChat: on } });
    // Aktyor keshi ≤10 s — o'zgarish DARHOL kuchga kirsin
    invalidateActor(String(req.params.userId));
    res.json({ ok: true, on });
  } catch (err) {
    console.error('[aiOpenChat] o\'zgartirish xatosi:', err);
    res.status(500).json({ error: 'O\'zgartirib bo\'lmadi' });
  }
});

export default router;
