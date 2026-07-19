import { Router, Request, Response, NextFunction } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth';
import { getTenant } from '../middleware/tenantContext';
import { scoped, stamped } from '../middleware/scope';
import User from '../models/User';
import ObjectModel from '../models/Object';
import Message from '../models/Message';
import { emitToUser } from '../services/socket';

const router = Router();

let anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY env yo\'q');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

// Faqat direktor/orinbosar/isOwner — dasturchi emas
function requireBoss(req: Request, res: Response, next: NextFunction) {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'Auth kerak' });
  if (u.isOwner || u.role === 'direktor' || u.role === 'orinbosar') return next();
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

FAQAT QUYIDAgI FORMATDA JAVOB BERING:
Oddiy javob uchun:
{"type":"query","response":"javob matni"}

Xabar yuborish uchun:
{"type":"action","response":"Tasdiqni so'rash matni","action":{"type":"send_message","toUserId":"id","toUserName":"Ism","text":"xabar matni","description":"Qisqa tavsif"}}`;

    const msgs = [
      ...(history as any[]).slice(-8).map(h => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user' as const, content: message.trim() },
    ];

    const resp = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM,
      messages: msgs,
    });

    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text.trim() : '{}';
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
    if (err.message?.includes('API_KEY') || err.status === 401) {
      return res.status(500).json({ error: 'AI API kaliti sozlanmagan' });
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

      return res.json({ ok: true, result: 'Xabar muvaffaqiyatli yuborildi' });
    }

    res.status(400).json({ error: `Noma'lum amal: ${action.type}` });
  } catch (err: any) {
    console.error('[AI execute]', err.message);
    res.status(500).json({ error: 'Amalga oshirishda xatolik' });
  }
});

export default router;
