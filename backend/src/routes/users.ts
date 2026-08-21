import { Router } from 'express';
import User from '../models/User';
import { scoped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { emitToUser } from '../services/socket';
import { blockDeveloper } from '../middleware/auth';

const router = Router();

// Get all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find(scoped()).select('-telegramVerificationCode -telegramVerificationCodeExpires');
    // map _id to id
    const formatted = users.map(u => ({
      id: u._id,
      name: u.firstName + (u.lastName ? ' ' + u.lastName : ''),
      phone: u.phone,
      role: u.role,
      brigade: u.brigade,
      projectIds: u.projectIds || [],
      companyId: u.companyId || null, // dasturchi qaysi firma ekanini ko'rishi uchun
      isOwner: u.isOwner || false
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Update user — dasturchi faqat companyId ni o'zgartira oladi (tenant bug fix uchun)
// XAVFSIZLIK: avval bu yerda hech qanday egalik/rol tekshiruvi yo'q edi —
// istalgan autentifikatsiyalangan xodim (masalan oddiy ishchi) o'zi bilan
// bir firmadagi BOSHQA istalgan foydalanuvchining (hatto direktorning)
// ismini/tilini o'zgartira olardi. Pastdagi /courses yo'lida bir xil
// tekshiruv allaqachon bor edi — shu yerga ham qo'llanildi: faqat o'zini
// yoki (direktor/orinbosar bo'lsa) boshqani tahrirlashi mumkin.
router.put('/:id', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.isDeveloper && String(req.params.id) !== String(tenant?.userId) &&
        tenant?.role !== 'direktor' && tenant?.role !== 'orinbosar') {
      return res.status(403).json({ error: 'Ruxsat yo\'q' });
    }
    const { firstName, lastName, companyId, language } = req.body;
    const user = await User.findOne(scoped({ _id: req.params.id }));
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    if (firstName) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    // companyId faqat dasturchi (super-admin) orqali qayta biriktirilishi mumkin —
    // eski tenant-bug qurbonlarini (companyId yo'q/noto'g'ri xodimlar) tuzatish uchun.
    // Oddiy tenant o'zini boshqa firmaga "ko'chira olmaydi" (privilege escalation yo'q).
    if (companyId !== undefined && getTenant()?.isDeveloper) {
      user.companyId = companyId || undefined;
    }
    let languageChanged = false;
    if (language && ['uz', 'uz-cyrl', 'ru'].includes(language) && language !== user.language) {
      user.language = language;
      languageChanged = true;
    }

    await user.save();
    // Real vaqtda sinxronlash — profildan o'zgartirilsa botdagi (yoki boshqa ochiq
    // qurilmadagi) sessiya ham darhol yangi tilga o'tsin.
    if (languageChanged) emitToUser(String(user._id), 'user:language', { language: user.language });
    res.json({
      id: user._id,
      name: user.firstName + (user.lastName ? ' ' + user.lastName : ''),
      phone: user.phone,
      role: user.role,
      brigade: user.brigade,
      companyId: user.companyId || null,
      language: user.language || 'uz'
    });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// PATCH /api/users/:id/courses — kurslar ro'yxatini yangilash
router.patch('/:id/courses', async (req, res) => {
  try {
    const tenant = getTenant();
    const { courses } = req.body;
    if (!Array.isArray(courses)) return res.status(400).json({ error: 'courses massiv bo\'lishi kerak' });
    // O'z profilini yoki admin boshqasini yangilay oladi
    const filter = (tenant?.role === 'direktor' || tenant?.role === 'orinbosar')
      ? scoped({ _id: req.params.id })
      : scoped({ _id: req.params.id, _id2: tenant?.userId });
    const user = await User.findOne({ _id: req.params.id, ...(tenant?.companyId ? { companyId: tenant.companyId } : {}) });
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    if (String(user._id) !== tenant?.userId && tenant?.role !== 'direktor' && tenant?.role !== 'orinbosar') {
      return res.status(403).json({ error: 'Ruxsat yo\'q' });
    }
    user.courses = courses.map((c: any) => ({
      title: String(c.title || '').slice(0, 200),
      provider: c.provider ? String(c.provider).slice(0, 100) : undefined,
      year: c.year ? Number(c.year) : undefined,
      cert: c.cert ? String(c.cert).slice(0, 200) : undefined,
    })).filter((c: any) => c.title);
    await user.save();
    res.json({ ok: true, courses: user.courses });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// GET /api/users/:id/profile — profil + kurslar
router.get('/:id/profile', async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, ...scoped() }).select('-telegramVerificationCode -telegramVerificationCodeExpires -passwordHash');
    if (!user) return res.status(404).json({ error: 'Topilmadi' });
    res.json({
      id: user._id,
      name: user.firstName + (user.lastName ? ' ' + user.lastName : ''),
      phone: user.phone,
      role: user.role,
      courses: user.courses || [],
      position: user.position,
      email: user.email,
    });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// Delete user — dasturchi o'chira olmaydi (firma ichki boshqaruvi).
// XAVFSIZLIK: bu yerda ILGARI rol tekshiruvi UMUMAN yo'q edi — frontend
// "O'chirish" tugmasini faqat direktor/orinbosarga ko'rsatsa ham, bu
// FAQAT interfeys cheklovi edi; istalgan autentifikatsiyalangan xodim
// (masalan oddiy ishchi) to'g'ridan-to'g'ri so'rov yuborib, hatto
// direktorning o'zini o'chirib yubora olardi. Endi faqat direktor/
// orinbosar o'chira oladi (companies.ts'dagi deleteCompany kabi
// pattern — o'zini o'chirmaslik tekshiruvi frontendda mavjud, bu yerda
// ham qo'shildi, chunki backend hech qachon frontendga ishonmasligi kerak).
router.delete('/:id', blockDeveloper, async (req, res) => {
  try {
    const tenant = getTenant();
    if (tenant?.role !== 'direktor' && tenant?.role !== 'orinbosar') {
      return res.status(403).json({ error: 'Faqat direktor yoki o\'rinbosar xodimni o\'chira oladi' });
    }
    if (String(req.params.id) === String(tenant?.userId)) {
      return res.status(400).json({ error: 'O\'z hisobingizni o\'chira olmaysiz' });
    }
    const user = await User.findOneAndDelete(scoped({ _id: req.params.id }));
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    res.json({ message: 'O\'chirildi' });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
