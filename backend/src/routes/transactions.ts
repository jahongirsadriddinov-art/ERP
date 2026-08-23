import { Router } from 'express';
import Transaction from '../models/Transaction';
import Material from '../models/Material';
import { bot, notifyAdmins } from '../services/bot';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { emitToUser } from '../services/socket';
import { tb, BotLang } from '../i18n/bot';
import { sendEmail } from '../services/email';
import { logAudit } from '../services/audit';

const router = Router();

// Idempotency cache: key → { id, result, expiresAt }
// Duplicate POST /:id/confirm yoki yangi expense yaratilganda ikki marta yuborilishiga qarshi
const idempotencyCache = new Map<string, { id: string; result: any; expiresAt: number }>();
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000; // 24 soat

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of idempotencyCache) { if (v.expiresAt < now) idempotencyCache.delete(k); }
}, 60 * 60 * 1000); // 1 soatda bir tozalaymiz

// Get all transactions
// Ko'rinish (visibility) qoidasi: direktor/orinbosar firmaning BARCHA
// tranzaksiyalarini ko'radi (moliyani nazorat qilish ularning vazifasi).
// Boshqa har qanday rol (ishchi, prorab, brigadir va h.k.) FAQAT o'zi
// yaratgan yoki o'ziga tegishli (yuboruvchi/qabul qiluvchi) yozuvlarni
// ko'radi — boshqa xodimlarning shaxsiy chiqim/maosh yozuvlari ko'rinmaydi.
// companyId izolyatsiyasi scoped() orqali baribir ustidan qo'llanadi.
router.get('/', async (req, res) => {
  try {
    const tenant = getTenant();
    const isFinanceAdmin = tenant?.isDeveloper || tenant?.role === 'direktor' || tenant?.role === 'orinbosar';
    const filter = isFinanceAdmin || !tenant?.userId
      ? scoped()
      : scoped({ $or: [{ createdById: tenant.userId }, { toUserId: tenant.userId }, { fromUserId: tenant.userId }] });
    const transactions = await Transaction.find(filter).sort({ createdAt: -1 });
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
    const VALID_TYPES = ['transfer', 'expense', 'income', 'oylik', 'material', 'jihozlar', 'transport', 'boshqa'];
    if (!data.type) {
      return res.status(400).json({ success: false, errors: [{ field: 'type', message: 'Tur kiritilishi shart' }] });
    }
    if (!VALID_TYPES.includes(data.type)) {
      return res.status(400).json({ success: false, errors: [{ field: 'type', message: `Noto'g'ri tur: ${data.type}` }] });
    }
    if (data.type === 'transfer') {
      const errs: { field: string; message: string }[] = [];
      if (!data.materialName || String(data.materialName).trim().length < 1)
        errs.push({ field: 'materialName', message: 'Material nomi kiritilishi shart' });
      if (!data.quantity || isNaN(Number(data.quantity)) || Number(data.quantity) <= 0)
        errs.push({ field: 'quantity', message: 'Miqdor musbat son bo\'lishi kerak' });
      if (!data.toUserId)
        errs.push({ field: 'toUserId', message: 'Kimga yuborilishini ko\'rsating' });
      if (errs.length) return res.status(400).json({ success: false, errors: errs });
    } else {
      const amount = Number(data.amount);
      if (!data.amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ success: false, errors: [{ field: 'amount', message: 'Summa musbat son bo\'lishi kerak' }] });
      }
      if (amount > 1e13) {
        return res.status(400).json({ success: false, errors: [{ field: 'amount', message: 'Summa juda katta' }] });
      }
    }

    // Idempotency: agar client idempotency key yuborsa — duplicate requestni qaytaramiz
    const idempKey = (req.headers['x-idempotency-key'] as string || '').trim();
    if (idempKey) {
      const cached = idempotencyCache.get(idempKey);
      if (cached) {
        return res.status(200).json(cached.result);
      }
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
      txData.price = data.price != null ? Number(data.price) : undefined;
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
      // MUHIM: createdById HECH QACHON so'rov tanasidan olinmaydi — faqat
      // tekshirilgan JWT kontekstidan (companyId/stamped() bilan bir xil
      // qoida). Aks holda har qanday xodim boshqa birovning (masalan
      // direktorning) ID'sini yuborib, quyidagi admin-tasdiqlash talabini
      // chetlab o'tishi yoki tranzaksiyani boshqa birovga yopishtirishi
      // mumkin edi. Faqat autentifikatsiyasiz (legacy) so'rovlarda body'dagi
      // qiymatga qaytiladi — eski xatti-harakat saqlanadi.
      txData.createdById = getTenant()?.userId || (data.createdById ? String(data.createdById) : undefined);
      txData.status = data.toUserId ? 'pending' : (data.status || 'confirmed');
    }

    // direktor/orinbosardan BOSHQA har qanday rol chiqim yaratsa — admin
    // tasdiqlashi shart (allow-list emas, deny-list: yangi rol qo'shilsa ham
    // ushbu qoida avtomatik ishlab turadi). Bunday holatda ANIQ kim
    // tasdiqlashini xodimning O'ZI tanlashi SHART (aniq talab) — bo'sh
    // "istalgan admin tasdiqlasin" endi qabul qilinmaydi.
    const creatorId = txData.createdById || getTenant()?.userId;
    if (txData.type !== 'transfer' && creatorId) {
      const creator = await User.findById(creatorId).catch(() => null);
      if (creator && !['direktor', 'orinbosar'].includes(creator.role)) {
        txData.requiresAdminApproval = true;
        txData.status = 'pending';

        const approverId = data.approverId ? String(data.approverId) : undefined;
        if (!approverId) {
          return res.status(400).json({ success: false, errors: [{ field: 'approverId', message: 'Kim tasdiqlashini tanlang' }] });
        }
        const approver = await User.findOne({ _id: approverId, companyId: creator.companyId }).catch(() => null);
        if (!approver || !['direktor', 'orinbosar'].includes(approver.role)) {
          return res.status(400).json({ success: false, errors: [{ field: 'approverId', message: 'Noto\'g\'ri tasdiqlovchi tanlandi' }] });
        }
        txData.approverId = approverId;
      }
    }

    const tx = new Transaction(stamped(txData));
    await tx.save();

    // Send telegram notification
    if (tx.status === 'pending') {
      try {
        if (tx.type === 'transfer' && tx.toUserId) {
          // Bitta xabarda: to'liq matn + tugmalar (avval 2 alohida xabar edi)
          const toUser = await User.findById(tx.toUserId).catch(() => null);
          if (toUser && toUser.telegramChatId) {
            const toLang = toUser.language as BotLang | undefined;
            const msg = tb(toLang, 'transferNewFull', { name: tx.materialName || '—', qty: String(tx.quantity), unit: tx.unit || '', sender: tx.fromUserName || '—', date: tx.date || '—' });
            await bot.sendMessage(toUser.telegramChatId, msg, {
              parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
                { text: tb(toLang, 'confirmBtn'), callback_data: `confirm_${tx._id}` },
                { text: tb(toLang, 'rejectBtn'), callback_data: `reject_${tx._id}` },
              ]] }
            }).catch(console.error);
          }
        } else if (tx.type !== 'transfer' && tx.toUserId) {
          // Payment to specific user — bitta xabarda matn + tugmalar
          const toUser = await User.findById(tx.toUserId).catch(() => null);
          if (toUser && toUser.telegramChatId) {
            const toLang = toUser.language as BotLang | undefined;
            const msg = tb(toLang, 'paymentNew', { amount: `${(tx.amount || 0).toLocaleString()} so'm`, reason: tx.description || '—', date: tx.date || '—' });
            await bot.sendMessage(toUser.telegramChatId, msg, {
              parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
                { text: tb(toLang, 'confirmBtn'), callback_data: `confirm_${tx._id}` },
                { text: tb(toLang, 'rejectBtn'), callback_data: `reject_${tx._id}` },
              ]] }
            }).catch(console.error);
          }
        }

        // Chiqim uchun ANIQ tasdiqlovchi tanlangan bo'lsa — o'sha odamga
        // to'g'ridan-to'g'ri, harakat tugmalari bilan xabar (bu yuqoridagi
        // toUserId xabaridan FARQLI: u "pul oldingizmi" deb so'raydi, bu esa
        // "chiqimni tasdiqlaysizmi" deb so'raydi — ikkalasi ham kelishi mumkin).
        if (tx.requiresAdminApproval && tx.approverId) {
          const approverUser = await User.findById(tx.approverId).catch(() => null);
          if (approverUser && approverUser.telegramChatId) {
            const aLang = approverUser.language as BotLang | undefined;
            const requester = await User.findById(tx.createdById).catch(() => null);
            const requesterName = requester ? `${requester.firstName} ${requester.lastName || ''}`.trim() : '—';
            const msg = tb(aLang, 'approverPaymentNew', { amount: `${(tx.amount || 0).toLocaleString()} so'm`, reason: tx.description || '—', date: tx.date || '—', requester: requesterName });
            await bot.sendMessage(approverUser.telegramChatId, msg, {
              parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
                { text: tb(aLang, 'confirmBtn'), callback_data: `confirm_${tx._id}` },
                { text: tb(aLang, 'rejectBtn'), callback_data: `reject_${tx._id}` },
              ]] }
            }).catch(console.error);
          }
        }

        // Boshqa (tanlanmagan) adminlarga — shunchaki xabardorlik uchun,
        // tugmasiz (ular baribir tasdiqlay olmaydi — yuqoridagi tekshiruvga qarang).
        const adminMsg = tx.type === 'transfer'
          ? `📦 *Yangi yukxat*\n${tx.materialName} — ${tx.quantity} ${tx.unit}\nYuboruvchi: ${tx.fromUserName || '—'}\nQabul qiluvchi: ${tx.toUserName || '—'}`
          : `💰 *Yangi to'lov so'rovi*\n${tx.description || '—'} — ${(tx.amount || 0).toLocaleString()} so'm`;
        await notifyAdmins(adminMsg).catch(console.error);

      } catch(notifErr) {
        console.error('Telegram notification error:', notifErr);
      }
    }

    const result = tx.toObject();
    const responseBody = { ...result, id: tx._id };
    // Idempotency key bo'lsa — natijani cache'ga qo'shamiz (24 soat)
    if (idempKey) {
      idempotencyCache.set(idempKey, { id: String(tx._id), result: responseBody, expiresAt: Date.now() + IDEMPOTENCY_TTL });
    }
    res.status(201).json(responseBody);
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
        // Yuboruvchi kiritgan narx (tx.price) katalogdagi Material.price'dan ustuvor —
        // smetada yo'q/eskirgan narx bo'lsa ham chiqim to'g'ri hisoblansin.
        const mat = await Material.findOne({ objectId: tx.projectId, name: tx.materialName });
        const unitPrice = tx.price ?? mat?.price;
        if (unitPrice) {
          expenseTx = await Transaction.create(stamped({
            type: 'material',
            status: 'confirmed',
            date: tx.date,
            amount: unitPrice * tx.quantity,
            description: `Material: ${tx.materialName} (${tx.quantity} ${tx.unit})`,
            projectId: tx.projectId,
            createdById: tx.fromUserId,
            toUserId: tx.toUserId,
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

    // Notify sender (Telegram + Email)
    try {
      const fromUserId = tx.fromUserId || tx.createdById;
      if (fromUserId) {
        const fromUser = await User.findById(fromUserId).catch(() => null) ||
                         await User.findOne({ _id: fromUserId }).catch(() => null);
        if (fromUser) {
          const label = (tx.type === 'transfer' ? tx.materialName : tx.description) || '—';
          if (fromUser.telegramChatId) {
            await bot.sendMessage(fromUser.telegramChatId, tb(fromUser.language as BotLang | undefined, 'simpleConfirmedNotify', { label })).catch(console.error);
          }
          if (fromUser.email && tx.type !== 'transfer') {
            await sendEmail(fromUser.email, "Tranzaksiya tasdiqlandi — QurilishERP", `
              <h2>Tranzaksiya tasdiqlandi ✅</h2>
              <p><b>${label}</b> — ${(tx.amount || 0).toLocaleString()} so'm</p>
              <p>Sana: ${tx.confirmedDate}</p>
            `).catch(console.error);
          }
        }
      }
    } catch(notifErr) {
      console.error('Telegram/Email notification error:', notifErr);
    }

    const result = tx.toObject();
    res.json({ ...result, id: tx._id });
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Admin chiqim tasdiqlash (expense approval chain)
router.patch('/:id/approve', async (req, res) => {
  try {
    const { note } = req.body;
    const tx = await Transaction.findOne(scoped({ _id: req.params.id }));
    if (!tx) return res.status(404).json({ error: 'Topilmadi' });
    if (tx.status !== 'pending') return res.status(409).json({ error: 'Bu allaqachon qayta ishlangan' });
    if (!tx.requiresAdminApproval) return res.status(400).json({ error: 'Bu tranzaksiya admin tasdiqlashini talab qilmaydi' });

    const actingUserId = getTenant()?.userId;
    if (!actingUserId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const actor = await User.findById(actingUserId).catch(() => null);
    if (!actor || !['direktor', 'orinbosar'].includes(actor.role)) {
      return res.status(403).json({ error: 'Faqat direktor yoki orinbosar tasdiqlashi mumkin' });
    }
    // Xodim chiqim yaratganda ANIQ tasdiqlovchi tanlagan bo'lsa — FAQAT
    // o'sha odam tasdiqlay oladi, boshqa admin emas (aniq talab). Eski
    // (approverId'siz) yozuvlar uchun eski xatti-harakat saqlanadi — har
    // qanday admin tasdiqlay oladi.
    if (tx.approverId && String(tx.approverId) !== String(actingUserId)) {
      return res.status(403).json({ error: 'Bu chiqimni faqat tanlangan tasdiqlovchi tasdiqlay oladi' });
    }

    const historyEntry = {
      userId: actingUserId,
      name: `${actor.firstName} ${actor.lastName || ''}`.trim(),
      role: actor.role,
      action: 'approved' as const,
      date: new Date().toISOString().split('T')[0],
      note: note || '',
    };

    tx.approvalHistory = [...(tx.approvalHistory || []), historyEntry];
    tx.status = 'confirmed';
    tx.confirmedById = actingUserId;
    tx.confirmedDate = new Date().toISOString().split('T')[0];
    await tx.save();

    // Audit log
    await logAudit({
      userId: actingUserId,
      userName: historyEntry.name,
      userRole: actor.role,
      action: 'approve',
      entity: 'transaction',
      entityId: String(tx._id),
      description: `Chiqim tasdiqlandi: ${tx.description || '—'} — ${(tx.amount || 0).toLocaleString()} so'm`,
      newValue: { status: 'confirmed', approvedBy: historyEntry.name },
      companyId: actor.companyId,
      req,
    });

    // Realtime emit
    const payload = { ...tx.toObject(), id: tx._id };
    if (tx.createdById) emitToUser(String(tx.createdById), 'transaction:update', payload);
    if (tx.toUserId) emitToUser(String(tx.toUserId), 'transaction:update', payload);

    // Email notification to creator
    try {
      const creatorId = tx.createdById || tx.toUserId;
      if (creatorId) {
        const creator = await User.findById(creatorId).catch(() => null);
        if (creator?.email) {
          await sendEmail(creator.email, "Chiqim tasdiqlandi — QurilishERP", `
            <h2>Chiqim tasdiqlandi ✅</h2>
            <p><b>${tx.description || '—'}</b> — ${(tx.amount || 0).toLocaleString()} so'm</p>
            <p>Tasdiqlagan: ${historyEntry.name} (${actor.role})</p>
            <p>Sana: ${historyEntry.date}</p>
          `).catch(console.error);
        }
      }
    } catch {}

    // Telegram notification
    try {
      const creatorId = tx.createdById || tx.toUserId;
      if (creatorId) {
        const creator = await User.findById(creatorId).catch(() => null);
        if (creator?.telegramChatId) {
          const label = tx.description || '—';
          await bot.sendMessage(creator.telegramChatId, `✅ Chiqimingiz tasdiqlandi: *${label}* — ${(tx.amount || 0).toLocaleString()} so'm`, { parse_mode: 'Markdown' }).catch(console.error);
        }
      }
    } catch {}

    res.json({ ...tx.toObject(), id: tx._id });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Reject transaction — qabul qiluvchi yoki admin rad etishi mumkin
router.patch('/:id/reject', async (req, res) => {
  try {
    const { note } = req.body;
    const tx = await Transaction.findOne(scoped({ _id: req.params.id }));
    if (!tx) return res.status(404).json({ error: 'Topilmadi' });
    if (tx.status !== 'pending') return res.status(409).json({ error: 'Bu allaqachon qayta ishlangan' });

    const actingUserId = getTenant()?.userId;
    if (!actingUserId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const actor = await User.findById(actingUserId).catch(() => null);
    const isAdmin = actor && ['direktor', 'orinbosar'].includes(actor.role);
    const isRecipient = String(tx.toUserId) === String(actingUserId);

    if (!isAdmin && !isRecipient) {
      return res.status(403).json({ error: 'Faqat qabul qiluvchi yoki admin rad etishi mumkin' });
    }
    // Agar chiqim uchun ANIQ tasdiqlovchi tanlangan bo'lsa — faqat o'sha admin
    // rad eta oladi (boshqa admin emas). isRecipient yo'li (transfer qabul
    // qiluvchisi) bunga bog'liq emas — approverId faqat admin-tasdiqlash
    // oqimiga tegishli, shuning uchun isAdmin bo'lgan holatdagina tekshiramiz.
    if (isAdmin && tx.approverId && String(tx.approverId) !== String(actingUserId)) {
      return res.status(403).json({ error: 'Bu chiqimni faqat tanlangan tasdiqlovchi rad eta oladi' });
    }

    if (tx.requiresAdminApproval && actor) {
      tx.approvalHistory = [...(tx.approvalHistory || []), {
        userId: actingUserId,
        name: `${actor.firstName} ${actor.lastName || ''}`.trim(),
        role: actor.role,
        action: 'rejected',
        date: new Date().toISOString().split('T')[0],
        note: note || '',
      }];
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
          const label = (tx.type === 'transfer' ? tx.materialName : tx.description) || '—';
          await bot.sendMessage(fromUser.telegramChatId, tb(fromUser.language as BotLang | undefined, 'simpleRejectedNotify', { label })).catch(console.error);
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
// XAVFSIZLIK — TOPILMA (audit): scoped() firmalararo o'chirishni to'sardi,
// lekin firma ICHIDA hech qanday rol tekshiruvi yo'q edi — /approve,
// /confirm, /reject barchasida rol/egalik tekshiruvi bor edi, faqat
// o'chirishda yo'q qolib ketgan (aniq xatolik) — istalgan oddiy ishchi
// firmaning istalgan moliyaviy yozuvini (o'zi yaratmagan bo'lsa ham)
// butunlay o'chira olardi.
router.delete('/:id', async (req, res) => {
  try {
    const actingUserId = getTenant()?.userId;
    if (!actingUserId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const tx = await Transaction.findOne(scoped({ _id: req.params.id }));
    if (!tx) return res.status(404).json({ error: 'Topilmadi' });
    const actor = await User.findById(actingUserId).catch(() => null);
    const isBoss = actor && ['direktor', 'orinbosar'].includes(actor.role);
    const isCreator = String(tx.createdById) === String(actingUserId);
    if (!isBoss && !isCreator) {
      return res.status(403).json({ error: 'Faqat direktor, orinbosar yoki yozuvni yaratgan xodim o\'chira oladi' });
    }
    await tx.deleteOne();
    res.json({ message: "O'chirildi" });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
