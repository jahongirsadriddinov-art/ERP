// ─── Bot guruh va kanallarda (owner 2026-10-26) ─────────────────────────────────────────────────────────────
// "Har bir firma uchun guruh ochib botni admin qilaman, umumiy guruhlarga va kanallarga ham. Faqat bitta
//  firmaga moslashganlariga alohida buyruqlar qo'sh — kanallarga va umumiy guruhga alohida qil."
//
// Ikki xil rejim:
//   • FIRMA guruhi — direktor yoki o'rinbosar guruhda /ulash yozgan. Faqat shu firma ma'lumotlari ko'rinadi:
//     bugungi davomat, obyektlar, bugungi chiqim, haftalik hisobot.
//   • UMUMIY guruh yoki kanal — bog'lanmagan. Hamma uchun ochiq buyruqlar: kurs, ob-havo, yangilik, qo'llanma.
// Shaxsiy chatdagi mantiqqa umuman tegilmaydi.

import BotChatLink from '../models/BotChatLink';
import User from '../models/User';
import Company from '../models/Company';
import ObjectModel from '../models/Object';
import Attendance from '../models/Attendance';
import Transaction from '../models/Transaction';
import { guideText } from './guides';

export type ChatKind = 'group' | 'supergroup' | 'channel';
interface Sender { id?: number }
export interface GroupMsg {
  chat: { id: number | string; type: string; title?: string; username?: string };
  from?: Sender;
  text?: string;
}
type Send = (chatId: string, text: string, opts?: Record<string, unknown>) => Promise<unknown>;

const tashkentToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const money = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, '.');

/** "/bugun@qurilish_erp_bot arg" → { cmd: 'bugun', arg: 'arg' }; buyruq bo'lmasa null. */
export function parseCommand(text: string | undefined, botUsername?: string): { cmd: string; arg: string } | null {
  const t = String(text || '').trim();
  if (!t.startsWith('/')) return null;
  const m = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?\s*([\s\S]*)$/.exec(t);
  if (!m) return null;
  // Guruhda boshqa botga yo'llangan buyruq — tegmaymiz
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  return { cmd: m[1].toLowerCase(), arg: (m[3] || '').trim() };
}

const GENERAL_HELP = [
  '🤖 <b>QurilishERP bot</b> — umumiy buyruqlar:',
  '',
  '💵 /narx — dollar kursi (Kapitalbank)',
  '🌤 /obhavo — Toshkentdagi ob-havo',
  '📰 /yangilik — bugungi sarlavhalar',
  '📖 /qollanma — tizimdan foydalanish qo‘llanmasi',
  '🌐 /sayt — erp-firma.uz',
  '',
  '<i>Bu guruhni firmangizga bog‘lash uchun direktor yoki o‘rinbosar</i> /ulash <i>deb yozsin — shunda guruhda firma buyruqlari ochiladi.</i>',
].join('\n');

const COMPANY_HELP = (name: string) => [
  `🏢 <b>${name}</b> — guruh buyruqlari:`,
  '',
  '👷 /bugun — bugungi davomat',
  '🏗 /obyektlar — faol obyektlar va byudjet',
  '💸 /chiqim — bugungi chiqimlar',
  '📊 /hisobot — so‘nggi 7 kun (kirim/chiqim)',
  '📖 /qollanma — qo‘llanma',
  '',
  '💵 /narx · 🌤 /obhavo · 📰 /yangilik · 🌐 /sayt',
  '',
  '<i>Guruhni firmadan uzish:</i> /uzish',
].join('\n');

export interface GroupDeps {
  send: Send;
  /** /narx, /obhavo, /yangilik uchun — routes/ticker dagi bandlar */
  ticker: () => Promise<Array<{ kind: string; text: string; icon?: string }>>;
  botUsername?: string;
}

async function linkOf(chatId: string) {
  return BotChatLink.findOne({ chatId }).lean().catch(() => null);
}

/** Guruhdagi buyruqni bajaradi. Buyruq bo'lmasa yoki tegishli bo'lmasa — false (hech narsa yuborilmaydi). */
export async function handleGroupCommand(msg: GroupMsg, deps: GroupDeps): Promise<boolean> {
  const chatId = String(msg.chat.id);
  const kind = (msg.chat.type === 'channel' ? 'channel' : msg.chat.type === 'group' ? 'group' : 'supergroup') as ChatKind;
  const parsed = parseCommand(msg.text, deps.botUsername);
  if (!parsed) return false;
  const { cmd } = parsed;
  const say = (text: string) => deps.send(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });

  // Guruh ro'yxatda turishi uchun (sarlavha o'zgarsa yangilanadi)
  await BotChatLink.updateOne({ chatId }, { $set: { type: kind, title: msg.chat.title || msg.chat.username || chatId } }, { upsert: true }).catch(() => null);
  const link = await linkOf(chatId);
  const linked = !!link?.companyId;

  // ── Bog'lash / uzish ──
  if (cmd === 'ulash') {
    const u: any = msg.from?.id
      ? await User.findOne({ telegramUserId: String(msg.from.id) }).select('firstName lastName role companyId isOwner').lean().catch(() => null)
      : null;
    if (!u || !(u.isOwner || ['direktor', 'orinbosar', 'dasturchi'].includes(String(u.role)))) {
      await say('⛔️ Guruhni faqat firma direktori yoki o‘rinbosari bog‘lay oladi. Avval botga shaxsiy yozib /start qiling.');
      return true;
    }
    if (link?.companyId && String(link.companyId) !== String(u.companyId)) {
      await say(`⚠️ Bu guruh allaqachon <b>${link.companyName || 'boshqa firma'}</b>ga bog‘langan. Avval /uzish deb yozing.`);
      return true;
    }
    const c: any = u.companyId ? await Company.findById(u.companyId).select('name').lean().catch(() => null) : null;
    if (!c) { await say('⚠️ Sizning hisobingiz hech qaysi firmaga bog‘lanmagan.'); return true; }
    await BotChatLink.updateOne({ chatId }, {
      $set: {
        type: kind, title: msg.chat.title || chatId, companyId: String(u.companyId), companyName: c.name,
        linkedByUserId: String(u._id), linkedByName: [u.firstName, u.lastName].filter(Boolean).join(' '), linkedAt: new Date(),
      },
    }, { upsert: true });
    await say(`✅ Guruh <b>${c.name}</b> firmasiga bog‘landi.\n\n${COMPANY_HELP(c.name)}`);
    return true;
  }

  if (cmd === 'uzish') {
    const u: any = msg.from?.id ? await User.findOne({ telegramUserId: String(msg.from.id) }).select('role companyId isOwner').lean().catch(() => null) : null;
    const allowed = u && (u.isOwner || ['direktor', 'orinbosar', 'dasturchi'].includes(String(u.role))) && (!link?.companyId || String(link.companyId) === String(u.companyId) || u.role === 'dasturchi');
    if (!allowed) { await say('⛔️ Buni faqat shu firma direktori yoki o‘rinbosari qila oladi.'); return true; }
    await BotChatLink.updateOne({ chatId }, { $set: { companyId: null, companyName: null, linkedByUserId: null, linkedByName: null, linkedAt: null } });
    await say('🔓 Guruh firmadan uzildi. Endi faqat umumiy buyruqlar ishlaydi.');
    return true;
  }

  // ── Hamma joyda ishlaydigan buyruqlar ──
  if (cmd === 'start' || cmd === 'help' || cmd === 'yordam' || cmd === 'buyruqlar') {
    await say(linked ? COMPANY_HELP(String(link!.companyName || 'Firma')) : GENERAL_HELP);
    return true;
  }
  if (cmd === 'sayt') { await say('🌐 <b>erp-firma.uz</b> — tizimga kirish va ilovani yuklab olish.\n📖 Qo‘llanma: erp-firma.uz/qollanma/'); return true; }
  if (cmd === 'qollanma' || cmd === 'guide') {
    await say(linked ? guideText('prorab', 'uz') : '📖 Barcha rollar uchun qo‘llanma: https://erp-firma.uz/qollanma/\n\nO‘z rolingiz bo‘yicha qo‘llanmani botga shaxsiy /qollanma deb yozib oling.');
    return true;
  }
  if (cmd === 'narx' || cmd === 'kurs' || cmd === 'obhavo' || cmd === 'yangilik' || cmd === 'yangiliklar') {
    const items = await deps.ticker().catch(() => []);
    const pick = cmd === 'obhavo' ? items.filter((i) => i.kind === 'weather')
      : cmd === 'narx' || cmd === 'kurs' ? items.filter((i) => i.kind === 'rate')
        : items.filter((i) => i.kind === 'news').slice(0, 5);
    if (!pick.length) { await say('⏳ Ma’lumot hozir olinmadi, birozdan so‘ng urinib ko‘ring.'); return true; }
    await say(pick.map((i) => `${i.icon || '•'} ${i.text}`).join('\n'));
    return true;
  }

  // ── Faqat firma guruhida ──
  const COMPANY_CMDS = ['bugun', 'davomat', 'obyektlar', 'chiqim', 'hisobot'];
  if (COMPANY_CMDS.includes(cmd)) {
    if (!linked) {
      await say('🔒 Bu buyruq faqat firmaga bog‘langan guruhda ishlaydi.\nDirektor yoki o‘rinbosar /ulash deb yozsin.');
      return true;
    }
    const companyId = String(link!.companyId);
    const today = tashkentToday();

    if (cmd === 'bugun' || cmd === 'davomat') {
      const rows: any[] = await Attendance.find({ companyId, date: today }).select('userId status checkIn checkOut').lean();
      const total = await User.countDocuments({ companyId, role: { $in: ['ishchi', 'brigadir', 'prorab'] } });
      const working = rows.filter((r) => r.checkIn && !r.checkOut).length;
      const done = rows.filter((r) => r.checkOut).length;
      const late = rows.filter((r) => r.status === 'late').length;
      await say([
        `👷 <b>Bugungi davomat</b> — ${today}`,
        '',
        `• Ishda: <b>${working}</b>`,
        `• Ishni tugatgan: <b>${done}</b>`,
        `• Belgilanmagan: <b>${Math.max(0, total - rows.length)}</b> / ${total}`,
        late ? `• Kechikkan: <b>${late}</b>` : '',
      ].filter(Boolean).join('\n'));
      return true;
    }

    if (cmd === 'obyektlar') {
      const objs: any[] = await ObjectModel.find({ companyId, status: 'active' }).select('name budget location').limit(15).lean();
      if (!objs.length) { await say('🏗 Faol obyekt yo‘q.'); return true; }
      await say(['🏗 <b>Faol obyektlar</b>', '', ...objs.map((o, i) =>
        `${i + 1}. <b>${o.name}</b>${o.budget ? ` — ${money(o.budget)} so‘m` : ''}`)].join('\n'));
      return true;
    }

    if (cmd === 'chiqim') {
      const rows: any[] = await Transaction.find({
        companyId, date: today, type: { $nin: ['transfer', 'income'] }, status: { $ne: 'rejected' },
      }).select('type amount description status').lean();
      const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const pending = rows.filter((r) => r.status === 'pending').length;
      await say([
        `💸 <b>Bugungi chiqimlar</b> — ${today}`,
        '',
        `Jami: <b>${money(sum)} so‘m</b> (${rows.length} ta)`,
        pending ? `Tasdiq kutmoqda: <b>${pending}</b>` : '',
      ].filter(Boolean).join('\n'));
      return true;
    }

    if (cmd === 'hisobot') {
      const from = new Date(Date.now() + 5 * 3600_000 - 6 * 86400_000).toISOString().slice(0, 10);
      const rows: any[] = await Transaction.find({
        companyId, date: { $gte: from, $lte: today }, status: { $ne: 'rejected' },
      }).select('type amount').lean();
      const inc = rows.filter((r) => r.type === 'income').reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const exp = rows.filter((r) => r.type !== 'income' && r.type !== 'transfer').reduce((s, r) => s + (Number(r.amount) || 0), 0);
      await say([
        `📊 <b>So‘nggi 7 kun</b> (${from} — ${today})`,
        '',
        `📥 Kirim: <b>${money(inc)} so‘m</b>`,
        `📤 Chiqim: <b>${money(exp)} so‘m</b>`,
        `⚖️ Farq: <b>${money(inc - exp)} so‘m</b>`,
      ].join('\n'));
      return true;
    }
  }

  return false; // tanilmagan buyruq — guruhda jim turamiz
}
