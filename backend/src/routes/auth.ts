import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Company from '../models/Company';
import { bot } from '../services/bot';
import { scoped, stamped } from '../middleware/scope';
import { normalizePhone } from '../utils/tokens';

const router = Router();

// ─── Dasturchi (super-admin) sozlamalari ─────────────────────────────────────
// Xavfsizlik uchun .env dan o'qiladi; agar berilmasa quyidagi standart ishlatiladi.
// TAVSIYA: backend/.env ga DEVELOPER_PHONE va kuchli DEVELOPER_PASSWORD qo'shing.
const DEVELOPER_PHONE = normalizePhone(process.env.DEVELOPER_PHONE || '+998770160054');
const DEVELOPER_PASSWORD = process.env.DEVELOPER_PASSWORD || 'Dasturchi_2026';

// Send verification code
router.post('/send-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Telefon raqam kiritilishi shart' });
  }

  let formattedPhone = phone.replace(/\s+/g, '');
  if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+' + formattedPhone;
  }

  try {
    const user = await User.findOne({ phone: formattedPhone });
    if (!user) {
      return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    }

    if (!user.telegramChatId) {
      return res.status(400).json({ error: 'Telegram botga ulanmagan. Iltimos botga kirib /start bosing va raqamingizni yuboring.' });
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    user.telegramVerificationCode = code;
    user.telegramVerificationCodeExpires = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes expiry
    await user.save();

    await bot.sendMessage(user.telegramChatId, `Sizning tizimga kirish kodingiz: <code>${code}</code>\nKod 2 daqiqa davomida amal qiladi.`, { parse_mode: 'HTML' });

    return res.json({ message: 'Kod yuborildi' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Login: verify the code
router.post('/login', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'Telefon va kod kiritilishi shart' });
  }

  let formattedPhone = phone.replace(/\s+/g, '');
  if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+' + formattedPhone;
  }

  try {
    const user = await User.findOne({ phone: formattedPhone });
    if (!user) {
      return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    }

    if (user.telegramVerificationCode !== code) {
      return res.status(400).json({ error: 'Kod noto\'g\'ri' });
    }

    if (user.telegramVerificationCodeExpires && user.telegramVerificationCodeExpires < new Date()) {
      return res.status(400).json({ error: 'Kodning muddati tugagan' });
    }

    // Clear the code so it cannot be reused
    user.telegramVerificationCode = undefined;
    user.telegramVerificationCodeExpires = undefined;
    await user.save();

    // Firma ma'lumotini olib kelamiz (agar bog'langan bo'lsa) — JWT va javob uchun.
    const company = user.companyId ? await Company.findById(user.companyId) : null;

    const token = jwt.sign(
      {
        userId: user._id,
        role: user.role,
        companyId: user.companyId,
        branchId: company?.branchId,
        isOwner: user.isOwner || false
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        projectIds: user.projectIds || [],
        companyId: user.companyId,
        isOwner: user.isOwner || false
      },
      // Firma brendi — hamma a'zo shu qiymatni ko'radi (o'zgartira olmaydi)
      company: company ? {
        id: company._id,
        branchId: company.branchId,
        name: company.name,
        logoUrl: company.logoUrl || '',
        currency: company.currency
      } : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ─── Dasturchi login: raqam + parol (Telegram kod EMAS) ──────────────────────
// Faqat dasturchi raqami tekshiriladi, parol doimiy (o'zgarmas). Muvaffaqiyatli
// bo'lsa super-admin JWT beriladi (isDeveloper=true, companyId yo'q — hamma firmani ko'radi).
router.post('/dev-login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: 'Telefon va parol kiritilishi shart' });
    }
    const normalized = normalizePhone(phone);
    if (normalized !== DEVELOPER_PHONE || password !== DEVELOPER_PASSWORD) {
      return res.status(401).json({ error: 'Telefon yoki parol noto\'g\'ri' });
    }

    // Dasturchi User yozuvini topamiz yoki yaratamiz (companyId'siz)
    let dev = await User.findOne({ phone: DEVELOPER_PHONE });
    if (!dev) {
      dev = await User.create({
        phone: DEVELOPER_PHONE,
        firstName: 'Dasturchi',
        role: 'dasturchi',
      });
    } else if (dev.role !== 'dasturchi') {
      dev.role = 'dasturchi';
      await dev.save();
    }

    const token = jwt.sign(
      { userId: dev._id, role: 'dasturchi', isDeveloper: true },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: dev._id,
        firstName: dev.firstName,
        lastName: dev.lastName || '',
        phone: dev.phone,
        role: 'dasturchi',
        projectIds: [],
        isDeveloper: true,
      },
      company: null,
    });
  } catch (err) {
    console.error('dev-login error:', err);
    return res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Admin: Add new user
router.post('/users', async (req, res) => {
  const { firstName, lastName, phone, role, brigade, projectIds } = req.body;

  if (!firstName || !phone || !role) {
    return res.status(400).json({ error: 'firstName, phone va role kiritilishi shart' });
  }

  // Note: we'd ideally check if the caller is a director/deputy here using auth middleware
  let formattedPhone = phone.replace(/\s+/g, '');
  if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+' + formattedPhone;
  }

  try {
    const existing = await User.findOne({ phone: formattedPhone });
    if (existing) {
      return res.status(400).json({ error: 'Bu raqam band' });
    }

    const newUser = new User(stamped({
      firstName,
      lastName: lastName || '',
      phone: formattedPhone,
      role,
      ...(brigade && brigade.trim() ? { brigade } : {}),
      projectIds: Array.isArray(projectIds) ? projectIds : []
    }));

    await newUser.save();
    return res.status(201).json({
      _id: newUser._id,
      id: newUser._id,
      name: newUser.firstName + (newUser.lastName ? ' ' + newUser.lastName : ''),
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      phone: newUser.phone,
      role: newUser.role,
      projectIds: newUser.projectIds || []
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Admin: Update user
router.put('/users/:id', async (req, res) => {
  const { firstName, lastName, phone, role, brigade, projectIds } = req.body;
  try {
    const user = await User.findOne(scoped({ _id: req.params.id }));
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    if (firstName) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (role) user.role = role;
    if (brigade !== undefined) user.brigade = brigade;
    if (Array.isArray(projectIds)) user.projectIds = projectIds;
    if (phone) {
      let formattedPhone = phone.replace(/\s+/g, '');
      if (!formattedPhone.startsWith('+')) formattedPhone = '+' + formattedPhone;
      user.phone = formattedPhone;
    }
    await user.save();
    return res.json({
      id: user._id,
      name: user.firstName + (user.lastName ? ' ' + user.lastName : ''),
      phone: user.phone,
      role: user.role,
      brigade: user.brigade,
      projectIds: user.projectIds || []
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Admin: Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findOneAndDelete(scoped({ _id: req.params.id }));
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    res.json({ message: "O'chirildi" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
