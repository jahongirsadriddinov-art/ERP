import { Router } from 'express';
import Material from '../models/Material';
import Transaction from '../models/Transaction';
import { bot } from '../services/bot';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { tb, BotLang } from '../i18n/bot';

const router = Router();

// Get materials for an object
// XAVFSIZLIK — TOPILMA (audit): bu yerda scoped() UMUMAN ishlatilmagan edi —
// istalgan autentifikatsiyalangan foydalanuvchi (o'z firmasidan qat'i nazar)
// BOSHQA FIRMANING obyekti uchun materiallar ro'yxatini shu objectId'ni
// bilsa/taxmin qilsa ko'rishi mumkin edi — aynan shu turdagi (firmalararo
// ma'lumot sizib chiqishi) muammo, bu sessiyaning boshida topilgan va
// index.ts'da tuzatilgan muammoning bir ko'rinishi, lekin shu bitta route
// o'sha safar chetda qolib ketgan edi.
router.get('/object/:objectId', async (req, res) => {
  try {
    const materials = await Material.find(scoped({ objectId: req.params.objectId }));
    res.json(materials);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Send material
router.post('/send', async (req, res) => {
  try {
    const { materialId, amount, receiverId } = req.body;
    // XAVFSIZLIK — TOPILMA (audit): senderId avval to'g'ridan-to'g'ri
    // so'rov tanasidan olinardi — messages.ts'dagi fromUserId muammosi bilan
    // bir xil turdagi soxta-jo'natuvchi (impersonatsiya) zaifligi: istalgan
    // foydalanuvchi materialni O'ZI EMAS, boshqa xodim nomidan yuborgandek
    // ko'rsatishi mumkin edi. Endi faqat tekshirilgan tenant kontekstidan.
    const senderId = getTenant()?.userId;
    if (!senderId) return res.status(401).json({ error: 'Avtorizatsiya talab etiladi' });

    const material = await Material.findOne(scoped({ _id: materialId }));
    if (!material) {
      return res.status(404).json({ error: 'Material topilmadi' });
    }

    if (material.remaining < amount) {
      return res.status(400).json({ error: 'Bunday miqdorda qoldiq yo\'q' });
    }

    // Qabul qiluvchi HAM bir xil firmadan bo'lishi shart — aks holda
    // boshqa firma xodimiga soxta "sizga material kelmoqda" bildirishnomasi
    // yuborilishi (va tranzaksiya noto'g'ri firmalararo yozuvga aylanishi)
    // mumkin edi.
    const receiver = receiverId ? await User.findOne(scoped({ _id: receiverId })) : null;
    if (receiverId && !receiver) {
      return res.status(400).json({ error: 'Qabul qiluvchi topilmadi' });
    }

    // Update material quantities
    material.sent += amount;
    material.remaining -= amount;
    await material.save();

    // Create transaction
    const transaction = new Transaction(stamped({
      type: 'transfer',
      materialName: material.name,
      quantity: amount,
      unit: material.unit,
      projectId: material.objectId.toString(),
      fromUserId: senderId,
      toUserId: receiverId,
      status: 'pending',
      date: new Date().toISOString()
    }));
    await transaction.save();

    // Send telegram notification to receiver to approve
    if (receiver) {
      if (receiver.telegramChatId) {
        bot.sendMessage(
          receiver.telegramChatId,
          tb(receiver.language as BotLang | undefined, 'transferIncoming', { amount: String(amount), unit: material.unit, name: material.name }),
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: tb(receiver.language as BotLang | undefined, 'acceptBtn'), callback_data: `confirm_${transaction._id}` },
                  { text: tb(receiver.language as BotLang | undefined, 'rejectBtn'), callback_data: `reject_${transaction._id}` }
                ]
              ]
            }
          }
        ).catch(console.error);
      }
    }

    res.json({ material, transaction });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
