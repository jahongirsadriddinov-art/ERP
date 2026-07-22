import { Router } from 'express';
import Transaction from '../models/Transaction';
import Material from '../models/Material';
import { bot, notifyUser, notifyAdmins } from '../services/bot';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { emitToUser } from '../services/socket';

const router = Router();

// Get all transactions
router.get('/', async (req, res) => {
  try {
    const transactions = await Transaction.find(scoped()).sort({ createdAt: -1 });
    res.json(transactions.map(t => ({ ...t.toObject(), id: t._id })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Create transaction (expense or transfer)
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    
    // Validate required fields
    if (!data.type) {
      return res.status(400).json({ error: 'Tur kiritilishi shart' });
    }

    const txData: any = {
      type: data.type,
      status: data.status || 'pending',
      date: data.date || data.sentDate || new Date().toISOString().split('T')[0],
    };

    // Transfer specific fields
    if (data.type === 'transfer') {
      txData.materialName = data.materialName;
      txData.quantity = data.quantity;
      txData.unit = data.unit;
      txData.projectId = data.projectId ? String(data.projectId) : undefined;
      txData.fromUserId = data.fromUserId ? String(data.fromUserId) : undefined;
      txData.fromUserName = data.fromUserName;
      txData.toUserId = data.toUserId ? String(data.toUserId) : undefined;
      txData.toUserName = data.toUserName;
      txData.note = data.note;
    } else {
      // Expense types: oylik, material, jihozlar, transport, boshqa, expense, income
      txData.amount = Number(data.amount) || 0;
      txData.description = data.description;
      txData.projectId = data.projectId ? String(data.projectId) : undefined;
      txData.toUserId = data.toUserId ? String(data.toUserId) : undefined;
      txData.createdById = data.createdById ? String(data.createdById) : undefined;
      txData.status = data.toUserId ? 'pending' : (data.status || 'confirmed');
    }

    const tx = new Transaction(stamped(txData));
    await tx.save();

    // Send telegram notification
    if (tx.status === 'pending') {
      try {
        const inlineKeyboard = [[
          { text: '✅ Tasdiqlash', callback_data: `confirm_${tx._id}` },
          { text: '❌ Rad etish', callback_data: `reject_${tx._id}` },
        ]];

        if (tx.type === 'transfer' && tx.toUserId) {
          // Notify recipient with inline buttons
          const msg = `📦 *Yangi yukxat keldi!*\n\n📌 Material: *${tx.materialName}*\nMiqdor: *${tx.quantity} ${tx.unit}*\nYuboruvchi: ${tx.fromUserName || '—'}\nSana: ${tx.date || '—'}`;
          await notifyUser(tx.toUserId, msg + '\n\nQabul qilasizmi?').catch(console.error);
          // Also send inline buttons separately
          const toUser = await User.findById(tx.toUserId).catch(() => null);
          if (toUser && toUser.telegramChatId) {
            await bot.sendMessage(toUser.telegramChatId, 'Tasdiqlash yoki rad etish:', {
              reply_markup: { inline_keyboard: inlineKeyboard }
            }).catch(console.error);
          }
        } else if (tx.type !== 'transfer' && tx.toUserId) {
          // Payment to specific user — notify them
          const msg = `💰 *Sizga to'lov yuborildi*\n\nSumma: *${(tx.amount || 0).toLocaleString()} so'm*\nSabab: ${tx.description || '—'}\nSana: ${tx.date || '—'}`;
          await notifyUser(tx.toUserId, msg).catch(console.error);
          const toUser = await User.findById(tx.toUserId).catch(() => null);
          if (toUser && toUser.telegramChatId) {
            await bot.sendMessage(toUser.telegramChatId, 'Qabul qildingizmi?', {
              reply_markup: { inline_keyboard: inlineKeyboard }
            }).catch(console.error);
          }
        }

        // Always notify admins about new pending transactions (informational only —
        // faqat qabul qiluvchi tasdiqlashi/rad etishi kerak, shuning uchun tugmalarsiz).
        const adminMsg = tx.type === 'transfer'
          ? `📦 *Yangi yukxat*\n${tx.materialName} — ${tx.quantity} ${tx.unit}\nYuboruvchi: ${tx.fromUserName || '—'}\nQabul qiluvchi: ${tx.toUserName || '—'}`
          : `💰 *Yangi to'lov so'rovi*\n${tx.description || '—'} — ${(tx.amount || 0).toLocaleString()} so'm`;
        await notifyAdmins(adminMsg).catch(console.error);

      } catch(notifErr) {
        console.error('Telegram notification error:', notifErr);
      }
    }

    const result = tx.toObject();
    res.status(201).json({ ...result, id: tx._id });
  } catch (err) {
    console.error('Transaction POST error:', err);
    res.status(500).json({ error: 'Server xatoligi: ' + (err as Error).message });
  }
});

// Confirm transaction — FAQAT qabul qiluvchi (tx.toUserId) tasdiqlashi mumkin.
// confirmedById HECH QACHON so'rov tanasidan olinmaydi — faqat tekshirilgan
// JWT (getTenant().userId) dan, aks holda boshqa odam ("sender") ham
// o'zi yuborgan tranzaksiyani tasdiqlab qo'ya olar edi.
router.patch('/:id/confirm', async (req, res) => {
  try {
    const { defect } = req.body;
    const tx = await Transaction.findOne(scoped({ _id: req.params.id }));
    if (!tx) return res.status(404).json({ error: 'Topilmadi' });
    if (tx.status !== 'pending') return res.status(409).json({ error: 'Bu allaqachon qayta ishlangan' });

    const actingUserId = getTenant()?.userId;
    if (!actingUserId || String(tx.toUserId) !== String(actingUserId)) {
      return res.status(403).json({ error: 'Faqat qabul qiluvchi tasdiqlashi mumkin' });
    }

    tx.status = 'confirmed';
    if (defect) tx.defect = defect;
    tx.confirmedById = actingUserId;
    tx.confirmedDate = new Date().toISOString().split('T')[0];
    await tx.save();

    // Update material sent/remaining counts + create a linked expense record
    // when a material transfer is confirmed, so it shows up in Moliya.
    let expenseTx: any = null;
    if (tx.type === 'transfer' && tx.projectId && tx.materialName && tx.quantity) {
      try {
        await Material.findOneAndUpdate(
          { objectId: tx.projectId, name: tx.materialName },
          { $inc: { sent: tx.quantity, remaining: -tx.quantity } }
        );
        const mat = await Material.findOne({ objectId: tx.projectId, name: tx.materialName });
        if (mat?.price) {
          expenseTx = await Transaction.create(stamped({
            type: 'material',
            status: 'confirmed',
            date: tx.date,
            amount: mat.price * tx.quantity,
            description: `Material: ${tx.materialName} (${tx.quantity} ${tx.unit})`,
            projectId: tx.projectId,
            createdById: tx.fromUserId,
            confirmedById: actingUserId,
            confirmedDate: tx.confirmedDate,
            sourceTransferId: String(tx._id),
          }));
        }
      } catch (matErr) {
        console.error('Material update error:', matErr);
      }
    }

    // Realtime — ochiq veb-sessiyalar darhol yangilansin (Telegram orqali ham shu yo'l ishlaydi)
    const payload = { ...tx.toObject(), id: tx._id };
    if (tx.toUserId) emitToUser(String(tx.toUserId), 'transaction:update', payload);
    if (tx.fromUserId) emitToUser(String(tx.fromUserId), 'transaction:update', payload);
    if (expenseTx) {
      const expPayload = { ...expenseTx.toObject(), id: expenseTx._id };
      if (tx.fromUserId) emitToUser(String(tx.fromUserId), 'transaction:new', expPayload);
      if (tx.toUserId) emitToUser(String(tx.toUserId), 'transaction:new', expPayload);
    }

    // Notify sender
    try {
      const fromUserId = tx.fromUserId || tx.createdById;
      if (fromUserId) {
        const fromUser = await User.findById(fromUserId).catch(() => null) ||
                         await User.findOne({ _id: fromUserId }).catch(() => null);
        if (fromUser && fromUser.telegramChatId) {
          const label = tx.type === 'transfer' ? tx.materialName : tx.description;
          await bot.sendMessage(fromUser.telegramChatId, `✅ Tasdiqlandi: ${label}`).catch(console.error);
        }
      }
    } catch(notifErr) {
      console.error('Telegram notification error:', notifErr);
    }

    const result = tx.toObject();
    res.json({ ...result, id: tx._id });
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Reject transaction — xuddi shu tarzda faqat qabul qiluvchi rad eta oladi.
router.patch('/:id/reject', async (req, res) => {
  try {
    const tx = await Transaction.findOne(scoped({ _id: req.params.id }));
    if (!tx) return res.status(404).json({ error: 'Topilmadi' });
    if (tx.status !== 'pending') return res.status(409).json({ error: 'Bu allaqachon qayta ishlangan' });

    const actingUserId = getTenant()?.userId;
    if (!actingUserId || String(tx.toUserId) !== String(actingUserId)) {
      return res.status(403).json({ error: 'Faqat qabul qiluvchi rad etishi mumkin' });
    }

    tx.status = 'rejected';
    await tx.save();

    const payload = { ...tx.toObject(), id: tx._id };
    if (tx.toUserId) emitToUser(String(tx.toUserId), 'transaction:update', payload);
    if (tx.fromUserId) emitToUser(String(tx.fromUserId), 'transaction:update', payload);

    // Notify sender
    try {
      const fromUserId = tx.fromUserId || tx.createdById;
      if (fromUserId) {
        const fromUser = await User.findById(fromUserId).catch(() => null) ||
                         await User.findOne({ _id: fromUserId }).catch(() => null);
        if (fromUser && fromUser.telegramChatId) {
          const label = tx.type === 'transfer' ? tx.materialName : tx.description;
          await bot.sendMessage(fromUser.telegramChatId, `❌ Rad etildi: ${label}`).catch(console.error);
        }
      }
    } catch(notifErr) {
      console.error('Telegram notification error:', notifErr);
    }

    const result = tx.toObject();
    res.json({ ...result, id: tx._id });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Delete transaction
router.delete('/:id', async (req, res) => {
  try {
    const tx = await Transaction.findOneAndDelete(scoped({ _id: req.params.id }));
    if (!tx) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ message: "O'chirildi" });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
