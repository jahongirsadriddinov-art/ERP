import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { getTenant } from '../middleware/tenantContext';
import { scoped, stamped } from '../middleware/scope';
import User from '../models/User';
import ObjectModel from '../models/Object';
import Transaction from '../models/Transaction';
import Message from '../models/Message';
import { emitToUser } from '../services/socket';
import { relayMessageToTelegram } from './messages';

const router = Router();

// ─── Groq (OpenAI-compatible) ─────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

async function groqChat(systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY env yo\'q');

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.1,
      max_tokens: 1536,
      response_format: { type: 'json_object' },
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    if (resp.status === 429) throw new Error('Groq AI limitga yetdi');
    throw new Error(`Groq API xatosi: ${resp.status} — ${JSON.stringify(data)}`);
  }

  return (data?.choices?.[0]?.message?.content as string) || '';
}

// Rolni JWT'dagi (365 kunlik sessiya davomida eskirishi mumkin bo'lgan) qiymatdan
// emas, DB'dagi joriy qiymatdan tekshiramiz.
async function requireBoss(req: Request, res: Response, next: NextFunction) {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'Auth kerak' });
  if (u.isOwner) return next();
  try {
    const dbUser = await User.findById(u.userId).select('role').lean();
    if (dbUser && (dbUser.role === 'direktor' || dbUser.role === 'orinbosar')) return next();
  } catch { /* quyida 403 qaytadi */ }
  return res.status(403).json({ error: 'Faqat rahbar va o\'rinbosar uchun' });
}

const SYSTEM_TEMPLATE = (callerRole: string, usersText: string, projectsText: string) =>
  `Siz qurilish ERP tizimining AI yordamchisiсiz. Hozir ${callerRole} bilan ishlayapsiz.

XODIMLAR:
${usersText}

LOYIHALAR/OBYEKTLAR:
${projectsText}

MUHIM QOIDALAR:
- Faqat JSON formatda javob bering (hech qanday qo'shimcha matn YO'Q).
- XODIMLAR/LOYIHALAR ro'yxatini hech qachon xom holda (id:, tel:, | belgilari bilan) ko'rsatmang — bu faqat SIZ uchun ichki ma'lumot.
- Foydalanuvchiga tabiiy, inson tilidagi javob bering.
- O'zbek tilida yozing.

JAVOB TURLARI:

1. Oddiy ma'lumot berish (type="query"):
{"type":"query","response":"javob matni"}

2. Xabar yuborish — faqat bu holat tasdiqlashni talab qiladi (type="action"):
{"type":"action","response":"Tasdiqlash so'rovi matni","action":{"type":"send_message","toUserId":"id","toUserName":"Ism","text":"xabar matni","description":"Qisqa tavsif"}}

3. Xodim qo'shish — darhol bajariladi, tasdiqlash kerak emas (type="direct_action"):
{"type":"direct_action","response":"Nima qilinayotganini tushuntiruvchi matn","action":{"type":"add_user","firstName":"Ism","lastName":"Familiya","phone":"+998XXXXXXXXX","role":"prorab|brigadir|ishchi|orinbosar","brigade":"Brigada nomi (ixtiyoriy)"}}

4. Xodimni o'chirish — darhol bajariladi, tasdiqlash kerak emas (type="direct_action"):
{"type":"direct_action","response":"Nima qilinayotganini tushuntiruvchi matn","action":{"type":"delete_user","userId":"id","userName":"Ism Familiya"}}

5. Xodim ma'lumotlarini yangilash — darhol bajariladi (type="direct_action"):
{"type":"direct_action","response":"Nima qilinayotganini tushuntiruvchi matn","action":{"type":"update_user","userId":"id","userName":"Ism","changes":{"firstName":"Yangi ism","lastName":"Familiya","role":"yangi_lavozim","brigade":"Brigada","phone":"+998XXXXXXXXX"}}}

6. Moliyaviy ma'lumot (type="query"):
{"type":"query","response":"Umumiy moliyaviy ma'lumot javob matni"}

XODIM QO'SHISH UCHUN LAVOZIMLAR: prorab, brigadir, ishchi, orinbosar
(direktor va dasturchi lavozimini o'zgartira olmaysiz)

SEND_MESSAGE uchun: foydalanuvchi buyruqni qisqartmalar yoki so'zlashuv uslubida yozishi mumkin.
action.text maydoniga grammatik jihatdan to'g'ri, xushmuomala gap yozing. Imlo xatosiz.

Agar ma'lumot etarli bo'lmasa (masalan, ism topilmasa, telefon berilmasa) — type="query" qaytarib kerakli ma'lumotni so'rang.`;

// POST /api/ai/chat
router.post('/chat', requireAuth, requireBoss, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Xabar kerak' });

    const [users, objects] = await Promise.all([
      User.find(scoped({})).select('firstName lastName role phone _id brigade').lean(),
      ObjectModel.find(scoped({})).select('name status _id').lean(),
    ]);

    const callerRole = req.user!.role === 'direktor' ? 'Direktor' : 'O\'rinbosar';
    const usersText = users.length
      ? (users as any[]).map(u => `- ${u.firstName} ${u.lastName || ''} | rol:${u.role}${u.brigade ? ' | brigada:' + u.brigade : ''} | tel:${u.phone} | id:${u._id}`).join('\n')
      : '(xodimlar yo\'q)';
    const projectsText = objects.length
      ? (objects as any[]).map(o => `- ${o.name} | holat:${o.status} | id:${o._id}`).join('\n')
      : '(loyihalar yo\'q)';

    const SYSTEM = SYSTEM_TEMPLATE(callerRole, usersText, projectsText);

    const messages = [
      ...(history as any[]).slice(-8).map((h: any) => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content,
      })),
      { role: 'user', content: message.trim() },
    ];

    const raw = await groqChat(SYSTEM, messages);

    let parsed: any;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : raw);
    } catch {
      parsed = { type: 'query', response: raw || 'Kechirasiz, javob tayyorlanmadi.' };
    }
    if (!parsed.type) parsed.type = 'query';
    if (!parsed.response) parsed.response = 'Kechirasiz, tushunmadim.';

    res.json(parsed);
  } catch (err: any) {
    console.error('[AI chat]', err.message);
    if (err.message?.includes('API_KEY') || err.message?.includes('env yo\'q')) {
      return res.status(500).json({ error: 'AI API kaliti sozlanmagan' });
    }
    if (err.message?.includes('limitga yetdi')) {
      return res.status(429).json({ error: 'Groq AI limitga yetdi. Birozdan keyin qayta urinib ko\'ring.' });
    }
    res.status(500).json({ error: 'AI xizmati bilan ulanishda xatolik' });
  }
});

// POST /api/ai/execute — tasdiqlashdan so'ng amal bajarish (send_message)
// va bevosita bajarish (add_user, delete_user, update_user)
router.post('/execute', requireAuth, requireBoss, async (req, res) => {
  try {
    const { action } = req.body;
    if (!action?.type) return res.status(400).json({ error: 'Amal kerak' });

    // ── Xabar yuborish (tasdiqlashdan so'ng) ──────────────────────────────────
    if (action.type === 'send_message') {
      const { toUserId, text } = action;
      if (!toUserId || !text?.trim()) return res.status(400).json({ error: 'Qabul qiluvchi va matn kerak' });

      const recipient = await User.findOne(scoped({ _id: String(toUserId) })).select('_id telegramChatId language').lean();
      if (!recipient) return res.status(404).json({ error: "Qabul qiluvchi topilmadi — ro'yxatdan qayta tanlab ko'ring" });

      const t = getTenant();
      const fromUserId = String(t?.userId || req.user!.userId);

      const msg = await Message.create(stamped({
        fromUserId,
        toUserId: String(toUserId),
        text: text.trim(),
        timestamp: new Date().toISOString(),
        read: false,
      }));

      const payload = { ...msg.toObject(), id: msg._id };
      emitToUser(String(toUserId), 'message:new', payload);
      emitToUser(fromUserId, 'message:new', payload);

      if (recipient.telegramChatId) {
        User.findById(fromUserId).select('firstName lastName').lean()
          .then(sender => {
            const senderName = sender ? `${sender.firstName} ${sender.lastName || ''}`.trim() : 'AI yordamchi';
            return relayMessageToTelegram(recipient.telegramChatId!, senderName, { text: text.trim(), type: 'text' });
          })
          .catch(() => {});
      }

      return res.json({ ok: true, result: 'Xabar muvaffaqiyatli yuborildi' });
    }

    // ── Xodim qo'shish (bevosita) ──────────────────────────────────────────────
    if (action.type === 'add_user') {
      const { firstName, lastName, phone, role, brigade } = action;
      if (!firstName || !phone || !role) {
        return res.status(400).json({ error: 'Ism, telefon raqam va lavozim kerak' });
      }

      // direktor/dasturchi lavozimini AI orqali qo'shib bo'lmaydi
      if (['direktor', 'dasturchi'].includes(role)) {
        return res.status(403).json({ error: "Direktor va dasturchi lavozimini faqat dasturchi paneli orqali qo'shish mumkin" });
      }

      let formattedPhone = String(phone).replace(/\s+/g, '');
      if (!formattedPhone.startsWith('+')) formattedPhone = '+' + formattedPhone;

      const existing = await User.findOne({ phone: formattedPhone });
      if (existing) {
        return res.status(400).json({ error: `Bu telefon raqam (${formattedPhone}) allaqachon tizimda ro'yxatga olingan` });
      }

      const newUser = await User.create(stamped({
        firstName: String(firstName).trim(),
        lastName: lastName ? String(lastName).trim() : '',
        phone: formattedPhone,
        role,
        ...(brigade ? { brigade: String(brigade).trim() } : {}),
        projectIds: [],
      }));

      return res.json({
        ok: true,
        result: `${firstName}${lastName ? ' ' + lastName : ''} (${role}) muvaffaqiyatli qo'shildi. Telefon: ${formattedPhone}`,
        user: {
          id: newUser._id,
          name: `${newUser.firstName}${newUser.lastName ? ' ' + newUser.lastName : ''}`,
          role: newUser.role,
          phone: newUser.phone,
        },
      });
    }

    // ── Xodimni o'chirish (bevosita) ───────────────────────────────────────────
    if (action.type === 'delete_user') {
      const { userId, userName } = action;
      if (!userId) return res.status(400).json({ error: 'Xodim ID kerak' });

      const deleted = await User.findOneAndDelete(scoped({ _id: String(userId) }));
      if (!deleted) return res.status(404).json({ error: 'Xodim topilmadi yoki uni o\'chirish huquqingiz yo\'q' });

      return res.json({
        ok: true,
        result: `${userName || deleted.firstName + ' ' + (deleted.lastName || '')} tizimdan muvaffaqiyatli o'chirildi`,
        deletedId: String(deleted._id),
      });
    }

    // ── Xodim ma'lumotlarini yangilash (bevosita) ──────────────────────────────
    if (action.type === 'update_user') {
      const { userId, changes } = action;
      if (!userId || !changes) return res.status(400).json({ error: 'Xodim ID va o\'zgartirish ma\'lumotlari kerak' });

      const user = await User.findOne(scoped({ _id: String(userId) }));
      if (!user) return res.status(404).json({ error: 'Xodim topilmadi' });

      // direktor/dasturchi lavozimiga AI orqali ko'tarib bo'lmaydi
      const requester = req.user;
      const isDeveloperCaller = !!(requester?.isDeveloper || requester?.role === 'dasturchi');
      if (changes.role && ['direktor', 'dasturchi'].includes(changes.role) && changes.role !== user.role && !isDeveloperCaller) {
        return res.status(403).json({ error: "Bu lavozimni faqat dasturchi paneli orqali o'zgartirish mumkin" });
      }

      if (changes.firstName) user.firstName = String(changes.firstName).trim();
      if (changes.lastName !== undefined) user.lastName = String(changes.lastName || '').trim();
      if (changes.role) user.role = changes.role;
      if (changes.brigade !== undefined) user.brigade = changes.brigade ? String(changes.brigade).trim() : '';
      if (changes.phone) {
        let fp = String(changes.phone).replace(/\s+/g, '');
        if (!fp.startsWith('+')) fp = '+' + fp;
        user.phone = fp;
      }
      await user.save();

      const updatedName = `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`;
      return res.json({
        ok: true,
        result: `${updatedName} ma'lumotlari muvaffaqiyatli yangilandi`,
        user: { id: user._id, name: updatedName, role: user.role, phone: user.phone },
      });
    }

    res.status(400).json({ error: `Noma'lum amal: ${action.type}` });
  } catch (err: any) {
    console.error('[AI execute]', err.message);
    res.status(500).json({ error: 'Amalga oshirishda xatolik' });
  }
});

export default router;
