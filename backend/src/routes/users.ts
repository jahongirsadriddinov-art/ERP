import { Router } from 'express';
import User from '../models/User';
import { scoped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { emitToUser } from '../services/socket';
import { logAudit } from '../services/audit';

const router = Router();

// Get all users
router.get('/', async (req, res) => {
  try {
    // (natijaviy `formatted` ro'yxatga faqat aniq xavfsiz maydonlar
    // qo'shiladi pastda — passwordHash baribir javobga chiqmaydi, lekin
    // kerak bo'lmagan maydonni bazadan umuman o'qimaslik yaxshiroq odat.)
    const users = await User.find(scoped()).select('-telegramVerificationCode -telegramVerificationCodeExpires -passwordHash');
    // map _id to id
    const formatted = users.map(u => ({
      id: u._id,
      name: u.firstName + (u.lastName ? ' ' + u.lastName : ''),
      phone: u.phone,
      role: u.role,
      brigade: u.brigade,
      projectIds: u.projectIds || [],
      companyId: u.companyId || null, // dasturchi qaysi firma ekanini ko'rishi uchun
      isOwner: u.isOwner || false,
      isBlocked: u.isBlocked || false,
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

// PATCH /api/users/:id/block va /:id/unblock — foydalanuvchini bloklash.
// Dasturchi — istalgan foydalanuvchini; firma admin/o'rinbosari — FAQAT
// o'z firmasidagi xodimlarni (scoped() shuni kafolatlaydi), firma egasini
// EMAS (xavfsizlik: oddiy admin/o'rinbosar direktorni bloklab qo'yolmasin).
// Bloklangan foydalanuvchi requireAuth'da HAR so'rovda tekshiriladi — shu
// sabab eski (hali muddati tugamagan) tokeni ham darhol ishlamay qoladi.
async function setBlocked(req: any, res: any, blocked: boolean) {
  try {
    const tenant = getTenant();
    if (!tenant?.isDeveloper && tenant?.role !== 'direktor' && tenant?.role !== 'orinbosar') {
      return res.status(403).json({ error: 'Ruxsat yo\'q' });
    }
    if (String(req.params.id) === String(tenant?.userId)) {
      return res.status(400).json({ error: 'O\'zingizni bloklay olmaysiz' });
    }
    const user = await User.findOne(scoped({ _id: req.params.id }));
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    if (!tenant?.isDeveloper && (user.isOwner || user.role === 'dasturchi')) {
      return res.status(403).json({ error: 'Bu foydalanuvchini bloklay olmaysiz' });
    }
    user.isBlocked = blocked;
    user.blockedAt = blocked ? new Date() : undefined;
    user.blockedBy = blocked ? String(tenant?.userId || '') : undefined;
    await user.save();

    if (tenant?.userId) {
      const actor = await User.findById(tenant.userId).lean().catch(() => null);
      if (actor) {
        logAudit({
          userId: tenant.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
          action: 'update', entity: 'user', entityId: String(user._id),
          description: `Foydalanuvchi ${blocked ? 'bloklandi' : 'blokdan chiqarildi'}: ${user.firstName} ${user.lastName || ''}`.trim(),
          newValue: { isBlocked: blocked }, companyId: tenant.companyId, req,
        }).catch(() => {});
      }
    }

    res.json({ ok: true, id: user._id, isBlocked: user.isBlocked });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
}
router.patch('/:id/block', (req, res) => setBlocked(req, res, true));
router.patch('/:id/unblock', (req, res) => setBlocked(req, res, false));

// PATCH /api/users/:id/courses — kurslar ro'yxatini yangilash
router.patch('/:id/courses', async (req, res) => {
  try {
    const tenant = getTenant();
    const { courses } = req.body;
    if (!Array.isArray(courses)) return res.status(400).json({ error: 'courses massiv bo\'lishi kerak' });
    // O'z profilini yoki admin boshqasini yangilay oladi — haqiqiy tekshiruv
    // pastda (user topilgach, egalik/rol bo'yicha) qilinadi.
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
// XATO TUZATILDI ("admin panelda o'chirib bo'lmayapti"): bu yo'l avval
// `blockDeveloper` bilan himoyalangan edi — bu middleware dasturchini FIRMA
// ICHKI ma'lumotlaridan (tranzaksiya, material va h.k.) qaytarish uchun
// mo'ljallangan, lekin foydalanuvchini o'chirish shu faylning GET/PUT
// yo'llarida ALLAQACHON dasturchi uchun ATAYLAB ochiq (companyId'siz "eski
// bug qurboni" yoki test hisoblarni tozalash uchun) — shu sabab DELETE ham
// xuddi o'sha PUT'dagi bilan bir xil qoidaga moslashtirildi.
router.delete('/:id', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.isDeveloper && tenant?.role !== 'direktor' && tenant?.role !== 'orinbosar') {
      return res.status(403).json({ error: 'Faqat direktor yoki o\'rinbosar xodimni o\'chira oladi' });
    }
    if (String(req.params.id) === String(tenant?.userId)) {
      return res.status(400).json({ error: 'O\'z hisobingizni o\'chira olmaysiz' });
    }
    const user = await User.findOneAndDelete(scoped({ _id: req.params.id }));
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    if (tenant?.userId) {
      const actor = await User.findById(tenant.userId).lean().catch(() => null);
      if (actor) {
        logAudit({
          userId: tenant.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
          action: 'delete', entity: 'user', entityId: String(user._id),
          description: `Foydalanuvchi o'chirildi: ${user.firstName} ${user.lastName || ''} (${user.phone})`.trim(),
          oldValue: { firstName: user.firstName, lastName: user.lastName, phone: user.phone, role: user.role },
          companyId: tenant.companyId, req,
        }).catch(() => {});
      }
    }

    res.json({ message: 'O\'chirildi' });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
