import { Router } from 'express';
import User from '../models/User';
import { scoped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { emitToUser } from '../services/socket';

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

// Update user
router.put('/:id', async (req, res) => {
  try {
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

// Delete user
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findOneAndDelete(scoped({ _id: req.params.id }));
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    res.json({ message: 'O\'chirildi' });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
