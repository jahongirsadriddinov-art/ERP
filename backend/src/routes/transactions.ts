import { Router } from 'express';
import Transaction from '../models/Transaction';
import Material from '../models/Material';
import { bot, notifyUser, notifyAdmins } from '../services/bot';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';

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

        // Always notify admins about new pending transactions
        const adminMsg = tx.type === 'transfer'
          ? `📦 *Yangi yukxat*\n${tx.materialName} — ${tx.quantity} ${tx.unit}\nYuboruvchi: ${tx.fromUserName || '—'}`
          : `💰 *Yangi to'lov so'rovi*\n${tx.description || '—'} — ${(tx.amount || 0).toLocaleString()} so'm`;
        await notifyAdmins(adminMsg, inlineKeyboard).catch(console.error);

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

// Confirm transaction
router.patch('/:id/confirm', async (req, res) => {
  try {
    const { defect, confirmedById } = req.body;
    const tx = await Transaction.findOne(scoped({ _id: req.params.id }));
    if (!tx) return res.status(404).json({ error: 'Topilmadi' });

    tx.status = 'confirmed';
    if (defect) tx.defect = defect;
    if (confirmedById) tx.confirmedById = confirmedById;
    tx.confirmedDate = new Date().toISOString().split('T')[0];
    await tx.save();

    // Update material sent/remaining counts when a transfer is confirmed
    if (tx.type === 'transfer' && tx.projectId && tx.materialName && tx.quantity) {
      try {
        await Material.findOneAndUpdate(
          { objectId: tx.projectId, name: tx.materialName },
          { $inc: { sent: tx.quantity, remaining: -tx.quantity } }
        );
      } catch (matErr) {
        console.error('Material update error:', matErr);
      }
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

// Reject transaction
router.patch('/:id/reject', async (req, res) => {
  try {
    const tx = await Transaction.findOne(scoped({ _id: req.params.id }));
    if (!tx) return res.status(404).json({ error: 'Topilmadi' });

    tx.status = 'rejected';
    await tx.save();

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
