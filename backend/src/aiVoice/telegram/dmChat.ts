import User from '../../models/User';
import type { WorkerEvent } from '../contracts';
import { checkActor } from '../actor';
import { createTextAgent } from '../brain/textAgent';
import { aiLangOf, localizeFree } from '../bot/i18n';
import { hitRate } from '../lib/mongoRateLimit';
import { newCorrelationId } from '../lib/ids';
import { getSettings, isAiActive } from '../settings';
import type { ToolCtx } from '../tools/types';
import { findEmployeeByTgId } from './tgLink';
import { callWorker } from './workerRpc';
import { workerHub } from './workerNamespace';

// AI Telegram akkauntiga yozilgan xabarlar (owner 2026-10-22: "AI ulangan akkauntlarga yozsa ham javob bersin va
// aytganini qilsin — oddiy chatdek"). Worker 'dm.received' voqeasini yuboradi; ERP botga bog'langan xodim bo'lsa —
// u xodim sifatida matnli AI agent ishlaydi (bot AI rejimi bilan bir xil qoidalar va tool'lar), javob shu akkauntdan
// yuboriladi. Tasdiq talab qiladigan amallar — matn bilan ("ha"/"yo'q"; agent qisqa javobni o'zi taniydi).
// Notanish odamga — kuniga bir marta qisqa tushuntirish (spam bo'lmasin).

const AGENT_TIMEOUT_MS = 45_000;
const HISTORY_MAX = 16;
const TG_ID_RE = /^\d{1,20}$/;
const ACC_RE = /^[0-9a-f]{24}$/;

type Turn = { role: 'user' | 'assistant'; text: string };
const histories = new Map<string, { at: number; turns: Turn[]; correlationId: string }>();
const busy = new Set<string>();

const T = {
  uz: {
    unknown: "Assalomu alaykum! Men firma AI yordamchisiman. Avval ERP botida /start bosib, telefon raqamingizni ulashing — shundan keyin shu yerda yozganingizni bajaraman.",
    off: "Firmangizda AI yordamchi hozir o'chiq. Rahbaringizga ayting.",
    busy: "Bir daqiqa, oldingi savolingiz ustida ishlayapman…",
    rate: "Juda ko'p xabar keldi — birozdan keyin yozing.",
    confirm: (s: string) => `Tasdiqlaysizmi: ${s}? «ha» yoki «yo'q» deb yozing.`,
    error: "Kechirasiz, hozir javob bera olmadim. Birozdan keyin qayta yozing.",
  },
  ru: {
    unknown: "Здравствуйте! Я ИИ-помощник фирмы. Сначала нажмите /start в ERP-боте и поделитесь номером — после этого я буду выполнять ваши просьбы здесь.",
    off: "ИИ-помощник в вашей фирме сейчас выключен. Скажите руководителю.",
    busy: "Минуту, работаю над предыдущим вопросом…",
    rate: "Слишком много сообщений — напишите чуть позже.",
    confirm: (s: string) => `Подтверждаете: ${s}? Напишите «да» или «нет».`,
    error: "Извините, сейчас не получилось ответить. Попробуйте чуть позже.",
  },
};

async function send(account: string | undefined, tgUserId: string, text: string): Promise<void> {
  await callWorker('dm.send', { ...(account ? { account } : {}), tgUserId, text: text.slice(0, 4000) }).catch((e) =>
    console.warn('[aiVoice/dm] javob yuborilmadi:', (e as Error)?.message?.slice(0, 80)));
}

export async function handleDm(ev: { account?: string; tgUserId: string; text: string }): Promise<void> {
  const tgUserId = String(ev.tgUserId || '');
  const text = String(ev.text || '').trim().slice(0, 2000);
  const account = typeof ev.account === 'string' && ACC_RE.test(ev.account) ? ev.account : undefined;
  if (!TG_ID_RE.test(tgUserId) || !text) return;

  const who = await findEmployeeByTgId(tgUserId);
  if (!who) {
    // Notanish — kuniga bir marta tushuntirish
    const once = await hitRate(`aiv:dm:unknown:${tgUserId}`, 1, 24 * 3600_000);
    if (once.allowed) await send(account, tgUserId, T.uz.unknown);
    return;
  }
  const user: any = await User.findById(who.employeeId).select('language role isOwner').lean().catch(() => null);
  const lang = aiLangOf(user?.language);
  const L = T[lang];
  if (!(await isAiActive(who.companyId))) { await send(account, tgUserId, L.off); return; }
  const ac = await checkActor(who.employeeId, who.companyId);
  if (!ac.ok) return;
  const key = `${who.employeeId}:${account || 'p'}`;
  if (busy.has(key)) { await send(account, tgUserId, L.busy); return; }
  const settings = await getSettings(who.companyId);
  const rate = await hitRate(`aiv:dm:${who.employeeId}`, settings.limits.botMsgsPer10Min, 10 * 60_000);
  if (!rate.allowed) { await send(account, tgUserId, L.rate); return; }

  const now = Date.now();
  for (const [k, h] of histories) if (now - h.at > 2 * 3600_000) histories.delete(k);
  const h = histories.get(key) || { at: now, turns: [], correlationId: newCorrelationId() };
  busy.add(key);
  callWorker('dm.typing', { ...(account ? { account } : {}), tgUserId }).catch(() => undefined);
  try {
    const role = (ac.actor.isOwner ? 'direktor' : ac.actor.role) as ToolCtx['role'];
    const ctx: ToolCtx = {
      companyId: who.companyId, userId: who.employeeId, role, isOwner: !!ac.actor.isOwner, lang, tz: 'Asia/Tashkent',
      // 'bot' kanali — tasdiqlar matn bilan ("ha"/"yo'q") shu yerda hal qilinadi (agent quickConfirm)
      channel: 'bot', purpose: 'assistant', correlationId: h.correlationId,
    } as ToolCtx;
    const out = await createTextAgent().run({ ctx, history: [...h.turns], userText: text, signal: AbortSignal.timeout(AGENT_TIMEOUT_MS) });
    let reply = localizeFree(user?.language, String(out?.text || '').trim()).slice(0, 3500) || L.error;
    const pend = (out?.pendingActions || []).map((p: any) => String(p?.summary || p?.tool || '').slice(0, 300)).filter(Boolean);
    if (pend.length && !/tasdiq|подтвер/i.test(reply)) reply += `\n\n${L.confirm(pend.join('; '))}`;
    h.turns.push({ role: 'user', text }, { role: 'assistant', text: reply });
    if (h.turns.length > HISTORY_MAX) h.turns.splice(0, h.turns.length - HISTORY_MAX);
    h.at = Date.now();
    histories.set(key, h);
    await send(account, tgUserId, reply);
  } catch (e) {
    console.error('[aiVoice/dm] agent xatosi:', String((e as Error)?.message || e).slice(0, 160));
    await send(account, tgUserId, L.error);
  } finally {
    busy.delete(key);
  }
}

let initialized = false;
export function initDmChat(): void {
  if (initialized) return;
  initialized = true;
  workerHub.on('event', (ev: WorkerEvent) => {
    if ((ev as any)?.type !== 'dm.received') return;
    handleDm(ev as any).catch((e) => console.error('[aiVoice/dm] xato:', (e as Error)?.message));
  });
}

/** Faqat testlar uchun. */
export function __resetDmChatForTests(): void { histories.clear(); busy.clear(); }
