import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { getTenant } from '../middleware/tenantContext';
import { scoped, stamped } from '../middleware/scope';
import User from '../models/User';
import ObjectModel from '../models/Object';
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
      max_tokens: 1024,
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

// Faqat direktor/orinbosar/isOwner — dasturchi emas.
// Rolni JWT'dagi (365 kunlik sessiya davomida eskirishi mumkin bo'lgan) qiymatdan
// emas, DB'dagi joriy qiymatdan tekshiramiz — aks holda foydalanuvchi rahbar/
// o'rinbosarga ko'tarilgandan keyin ham, qayta login qilmaguncha, eski token
// bilan "faqat rahbar va o'rinbosar uchun" deb rad etilaverar edi.
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

// POST /api/ai/chat
router.post('/chat', requireAuth, requireBoss, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Xabar kerak' });

    const [users, objects] = await Promise.all([
      User.find(scoped({})).select('firstName lastName role phone _id').lean(),
      ObjectModel.find(scoped({})).select('name status _id').lean(),
    ]);

    const callerRole = req.user!.role === 'direktor' ? 'Direktor' : 'O\'rinbosar';
    const usersText = users.length
      ? (users as any[]).map(u => `- ${u.firstName} ${u.lastName || ''} | rol:${u.role} | tel:${u.phone} | id:${u._id}`).join('\n')
      : '(xodimlar yo\'q)';
    const projectsText = objects.length
      ? (objects as any[]).map(o => `- ${o.name} | holat:${o.status} | id:${o._id}`).join('\n')
      : '(loyihalar yo\'q)';

    const SYSTEM = `Siz qurilish ERP tizimining AI yordamchisiсiz. Hozir ${callerRole} bilan ishlayapsiz.

XODIMLAR:
${usersText}

OBYEKTLAR:
${projectsText}

Qoidalar:
- Faqat JSON formatda javob bering (hech qanday qo'shimcha matn YO'Q).
- Xabar yuborish buyrug'i uchun type="action" qayaring.
- Ma'lumot so'rash/tushuntirish uchun type="query" qayaring.
- O'zbek tilida yozing.
- Agar xodim topilmasa, type="query" qaytarib nima kerakligini so'rang.
- XODIMLAR/OBYEKTLAR ro'yxatini hech qachon xom holda (id:, tel:, | belgilari bilan) ko'rsatmang — bu faqat SIZ uchun ichki ma'lumot. Foydalanuvchiga tabiiy, qisqa gapda javob bering (masalan: "Sizda 3 ta xodim bor: Aziz (Prorab), Vali (Brigadir), Olim (Ishchi).").
- MUHIM (send_message uchun): foydalanuvchi buyruqni imlo xatolari, qisqartmalar yoki
  so'zlashuv uslubida yozgan bo'lishi mumkin (masalan "ertaga ishga chiqsin dep ayt").
  action.text maydoniga buyruqni SO'ZMA-SO'Z ko'chirmang — mazmunini tushunib, xodimga
  yuborish uchun grammatik jihatdan to'g'ri, xushmuomala, to'liq gap qilib o'zingiz yozing
  (masalan: "Assalomu alaykum! Ertaga ishga chiqishingiz so'raladi."). Imlo xatosiz,
  tinish belgilari to'g'ri qo'yilgan bo'lsin.

FAQAT QUYIDAgI FORMATDA JAVOB BERING:
Oddiy javob uchun:
{"type":"query","response":"javob matni"}

Xabar yuborish uchun:
{"type":"action","response":"Tasdiqni so'rash matni","action":{"type":"send_message","toUserId":"id","toUserName":"Ism","text":"xabar matni","description":"Qisqa tavsif"}}`;

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

// POST /api/ai/execute — tasdiqdan so'ng amal bajarish
router.post('/execute', requireAuth, requireBoss, async (req, res) => {
  try {
    const { action } = req.body;
    if (!action?.type) return res.status(400).json({ error: 'Amal kerak' });

    if (action.type === 'send_message') {
      const { toUserId, text } = action;
      if (!toUserId || !text?.trim()) return res.status(400).json({ error: 'Qabul qiluvchi va matn kerak' });

      // AI modeldan kelgan toUserId'ni ko'r-ko'rona ishonib bo'lmaydi — model
      // uzun ID'ni noto'g'ri ko'chirib yozishi yoki xayoliy ID chiqarishi mumkin
      // (LLM'larda ma'lum muammo). Tekshirmasdan yozilsa, xabar HECH KIMGA
      // yetib bormagan holda "muvaffaqiyatli yuborildi" deb ko'rsatilardi —
      // buyruq "bajarilgandek" ko'rinib, aslida hech narsa bo'lmagan bo'lardi.
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

      // Oddiy chatdagi kabi — qabul qiluvchi saytda bo'lmasa ham Telegram orqali
      // xabar topsin (async, javobni kutmaymiz).
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

    res.status(400).json({ error: `Noma'lum amal: ${action.type}` });
  } catch (err: any) {
    console.error('[AI execute]', err.message);
    res.status(500).json({ error: 'Amalga oshirishda xatolik' });
  }
});

export default router;
