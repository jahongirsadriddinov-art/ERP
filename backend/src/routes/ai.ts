import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { getTenant } from '../middleware/tenantContext';
import { scoped, stamped } from '../middleware/scope';
import User from '../models/User';
import ObjectModel from '../models/Object';
import Message from '../models/Message';
import { emitToUser } from '../services/socket';

const router = Router();

// ─── Gemini key rotation ──────────────────────────────────────────────────────
const GEMINI_KEYS: string[] = (
  process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || ''
).split(',').map(k => k.trim()).filter(Boolean);

let keyIdx = 0;
function currentKey(): string { return GEMINI_KEYS[keyIdx] || ''; }
function rotateKey(): boolean {
  const next = (keyIdx + 1) % GEMINI_KEYS.length;
  if (next === keyIdx) return false;
  keyIdx = next;
  console.warn(`[AI] Gemini key ${keyIdx + 1}/${GEMINI_KEYS.length} ga o'tildi`);
  return true;
}
function isQuotaError(body: any, status: number): boolean {
  if (status === 429) return true;
  const msg = JSON.stringify(body || '');
  return msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('rate limit');
}

async function geminiChat(systemPrompt: string, contents: Array<{ role: string; parts: Array<{ text: string }> }>): Promise<string> {
  if (!GEMINI_KEYS.length) throw new Error('GEMINI_API_KEY env yo\'q');

  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const key = currentKey();
    if (!key) throw new Error('Gemini API kaliti topilmadi');

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 512, temperature: 0.1 },
        }),
      }
    );

    const data = await resp.json();

    if (!resp.ok && isQuotaError(data, resp.status)) {
      if (rotateKey()) continue;
      throw new Error('Barcha Gemini kalitlari limitga yetdi');
    }

    if (!resp.ok) throw new Error(`Gemini API xatosi: ${resp.status} — ${JSON.stringify(data)}`);

    return (data?.candidates?.[0]?.content?.parts?.[0]?.text as string) || '';
  }

  throw new Error('Gemini API bilan ulanishda xatolik');
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

    // Map history to Gemini contents format (assistant → model)
    const contents = [
      ...(history as any[]).slice(-8).map((h: any) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: [{ text: message.trim() }] },
    ];

    const raw = await geminiChat(SYSTEM, contents);

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
      return res.status(429).json({ error: 'Gemini AI kunlik/oylik limitga yetdi. Birozdan keyin qayta urinib ko\'ring yoki yangi API kalit qo\'shing.' });
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
