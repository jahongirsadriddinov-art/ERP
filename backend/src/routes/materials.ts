import { Router } from 'express';
import Material from '../models/Material';
import ObjectModel from '../models/Object';
import Transaction from '../models/Transaction';
import { bot } from '../services/bot';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { tb, BotLang } from '../i18n/bot';
import { logAudit } from '../services/audit';
import { checkRate } from '../utils/rateLimit';
import { requireOwnerOrAdmin } from '../middleware/auth';

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

// Material qatorini tahrirlash (nom/birlik/kerakli miqdor/narx) — avval
// smetani QAYTA yuklashdan boshqa yo'l yo'q edi (bu esa BUTUN ro'yxatni
// almashtirardi — bitta qatorni tuzatish uchun yo'qotish xavfi katta).
//
// MUHIM: frontend'dagi "kerakli materiallar" ro'yxati ikki manbadan
// kelishi mumkin — obyektda saqlangan smeta natijasidan (bunda har bir
// qator sun'iy indeks bilan, HAQIQIY Material._id EMAS) yoki to'g'ridan-
// to'g'ri Material kolleksiyasidan (haqiqiy _id bilan). Shu sabab bu yo'l
// _id EMAS, objectId+nom bo'yicha izlaydi — ikkala holatda ham ishonchli
// ishlaydi (Material.findOneAndUpdate({objectId,name}) naqshi
// transactions.ts'dagi confirm bilan bir xil).
router.patch('/object/:objectId/by-name', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { currentName, name, unit, needed, price } = req.body || {};
    if (!currentName) return res.status(400).json({ error: 'currentName kerak' });
    const mat = await Material.findOne(scoped({ objectId: req.params.objectId, name: currentName }));
    if (!mat) return res.status(404).json({ error: 'Material topilmadi' });

    const before = { name: mat.name, unit: mat.unit, needed: mat.needed, price: mat.price };
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ error: 'Nomi bo\'sh bo\'lmasligi kerak' });
      mat.name = trimmed;
    }
    if (unit !== undefined) mat.unit = String(unit).trim() || mat.unit;
    if (needed !== undefined) {
      const n = Number(needed);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: "Kerakli miqdor noto'g'ri" });
      mat.needed = n;
      mat.remaining = Math.max(0, n - (mat.sent || 0));
    }
    if (price !== undefined) {
      const p = price === null || price === '' ? undefined : Number(price);
      if (p !== undefined && (isNaN(p) || p < 0)) return res.status(400).json({ error: "Narx noto'g'ri" });
      mat.price = p;
    }
    await mat.save();

    // SINXRONLASH: obyektning o'zida saqlangan xom smeta natijasi
    // (Object.smeta.resources) frontend tomonidan Material kolleksiyasidan
    // USTUVOR o'qiladi (App.tsx'dagi mapping'ga qarang) — shu sabab FAQAT
    // Material hujjatini yangilash yetarli emas, aks holda tahrirlash
    // sahifa qayta yuklanganda "yo'qolib qolgandek" ko'rinardi (eski smeta
    // qiymati qaytadan ko'rsatilardi).
    const obj = await ObjectModel.findOne(scoped({ _id: req.params.objectId }));
    if (obj?.smeta?.resources?.length) {
      const idx = obj.smeta.resources.findIndex((r: any) => r.group === 'material' && r.rawName === before.name);
      if (idx !== -1) {
        obj.smeta.resources[idx].rawName = mat.name;
        obj.smeta.resources[idx].unit = mat.unit;
        obj.smeta.resources[idx].qty = mat.needed;
        obj.smeta.resources[idx].price = mat.price;
        obj.markModified('smeta');
        await obj.save();
      }
    }

    const t = getTenant();
    if (t?.userId) {
      const actor = await User.findById(t.userId).lean().catch(() => null);
      if (actor) {
        logAudit({
          userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
          action: 'update', entity: 'material', entityId: String(mat._id),
          description: `Material tahrirlandi: "${before.name}" → "${mat.name}"`,
          oldValue: before, newValue: { name: mat.name, unit: mat.unit, needed: mat.needed, price: mat.price },
          companyId: t.companyId, req,
        }).catch(() => {});
      }
    }

    res.json(mat);
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
    const rl = checkRate(`matsend:${senderId}`, 20, 60 * 1000);
    if (!rl.allowed) return res.status(429).json({ error: `Juda ko'p urinish. ${rl.retryAfterSec} soniyadan keyin urining.` });

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

    const sender = await User.findById(senderId).lean().catch(() => null);
    if (sender) {
      logAudit({
        userId: senderId, userName: `${sender.firstName} ${sender.lastName || ''}`.trim(), userRole: sender.role,
        action: 'update', entity: 'material', entityId: String(material._id),
        description: `Material yuborildi: ${material.name} — ${amount} ${material.unit}${receiver ? ` → ${receiver.firstName} ${receiver.lastName || ''}`.trim() : ''}`,
        newValue: { sent: material.sent, remaining: material.remaining }, companyId: sender.companyId, req,
      }).catch(() => {});
    }

    res.json({ material, transaction });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
