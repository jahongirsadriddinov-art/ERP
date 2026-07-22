import { Router } from 'express';
import Material from '../models/Material';
import Transaction from '../models/Transaction';
import { bot } from '../services/bot';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { tb, BotLang } from '../i18n/bot';

const router = Router();

// Get materials for an object
router.get('/object/:objectId', async (req, res) => {
  try {
    const materials = await Material.find({ objectId: req.params.objectId });
    res.json(materials);
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Send material
router.post('/send', async (req, res) => {
  try {
    const { materialId, amount, senderId, receiverId } = req.body;
    
    const material = await Material.findOne(scoped({ _id: materialId }));
    if (!material) {
      return res.status(404).json({ error: 'Material topilmadi' });
    }

    if (material.remaining < amount) {
      return res.status(400).json({ error: 'Bunday miqdorda qoldiq yo\'q' });
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
    if (receiverId) {
      const receiver = await User.findById(receiverId);
      if (receiver && receiver.telegramChatId) {
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
