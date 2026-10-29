import { Router } from 'express';
import { aiConfig } from '../aiVoice/config';
import { poolStatus } from '../aiVoice/lib/apiKeyPool';
import { geminiKeyCount } from '../aiVoice/lib/geminiKeys';
import { createTextAgent } from '../aiVoice/brain/textAgent';
import { newCorrelationId } from '../aiVoice/lib/ids';
import { PLATFORM_SCOPE } from '../aiVoice/platform';
import { workerConnectedHere } from '../aiVoice/telegram/workerNamespace';
import { getConnection, workerRecentlySeen } from '../aiVoice/telegram/accountService';
import type { ToolCtx } from '../aiVoice/contracts';

// "AI nega javob bermayapti?" — logsiz aniqlash uchun (owner 2026-10-29: AI na matnga
// javob beryapti, na qayta qo'ng'iroq qila olyapti). Bu yerda bitta sahifada ko'rinadi:
//  • qaysi provayderda nechta API kalit bor va nechtasi hozir limit/xato tufayli sovushda;
//  • Telegram qo'ng'iroq xizmati (tgcall-worker) ulanganmi;
//  • HAQIQIY sinov: AI'ga qisqa savol yuboriladi va javobi (yoki xatosi) ko'rsatiladi.
// Kalit QIYMATLARI hech qachon qaytarilmaydi — faqat sanoq.
const router = Router();

const TEST_TIMEOUT_MS = 30_000;

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const providers = [
      { name: 'OpenRouter', env: 'OPENROUTER_API_KEY', ...poolStatus('OPENROUTER_API_KEY') },
      { name: 'Groq', env: 'GROQ_API_KEY', ...poolStatus('GROQ_API_KEY') },
      { name: 'Gemini', env: 'GEMINI_API_KEYS', keys: geminiKeyCount(), cooling: 0 },
      { name: 'Anthropic', env: 'ANTHROPIC_API_KEY', keys: process.env.ANTHROPIC_API_KEY ? 1 : 0, cooling: 0 },
    ];

    // Worker SHU jarayonga ulangan bo'lmasligi mumkin, lekin yaqinda "tirik" signal
    // bergan bo'lsa — qo'ng'iroq baribir ketadi. Qo'ng'iroq kanali aynan shu ikkisini
    // birga tekshiradi (telegramCallChannel), shuning uchun panel ham xuddi shunday
    // hisoblashi kerak — aks holda panel "ulanmagan" deb yolg'on ko'rsatardi.
    const conn = await getConnection().catch(() => null);
    const tgWorker = {
      connected: workerConnectedHere() || workerRecentlySeen(conn, new Date()),
      lastSeenAt: conn?.lastHealthAt || conn?.leaseUntil || null,
      status: conn?.status || null,
      health: conn?.health?.state || null,
    };

    // Haqiqiy sinov — foydalanuvchi yozganda nima bo'lsa, xuddi shu yo'l
    const ctx: ToolCtx = {
      companyId: PLATFORM_SCOPE, userId: String(req.user!.userId), role: 'direktor', isOwner: true,
      lang: 'uz', tz: 'Asia/Tashkent', channel: 'web', purpose: 'assistant', correlationId: newCorrelationId(),
    };
    const startedAt = Date.now();
    let test: { ok: boolean; ms: number; reply?: string; error?: string };
    try {
      const out = await createTextAgent().run({
        ctx, history: [], userText: 'Qisqa javob ber: 2+2 nechchi?', signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      const reply = String(out?.text || '').trim();
      test = reply
        ? { ok: true, ms: Date.now() - startedAt, reply: reply.slice(0, 200) }
        : { ok: false, ms: Date.now() - startedAt, error: "Model bo'sh javob qaytardi" };
    } catch (err) {
      test = { ok: false, ms: Date.now() - startedAt, error: String((err as Error)?.message || err).slice(0, 300) };
    }

    res.json({ enabled: aiConfig.enabled, providers, tgWorker, test });
  } catch (err) {
    console.error('[aiHealth] xato:', err);
    res.status(500).json({ error: 'Holatni olib bo\'lmadi' });
  }
});

export default router;
