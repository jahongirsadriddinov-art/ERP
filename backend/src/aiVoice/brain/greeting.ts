import AiActionAudit from '../../models/AiActionAudit';
import AiCallSession from '../../models/AiCallSession';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import { isObjectIdString } from '../lib/ids';
import { zonedParts } from '../lib/zonedTime';
import { normApostrophes } from './style';

// Jonli salom (owner 2026-10-22): "har qo'ng'iroqda bir xil gap — «Qandaysiz, nima yordam bera olaman»". Endi salom
// odamdek: kun vaqti (tong/kun/kech/tun), ism, oxirgi suhbat qachon bo'lgani (bugun yana / kecha / ancha bo'ldi) va
// yaqinda nima qilgani (rahbarga xabar, eslatma, xodimga qo'ng'iroq) — qisqa. Bir odamga KETMA-KET bir xil salom
// aytilmaydi: oxirgi salom AiEmployeeContact.lastGreeting'da (matn va ovoz uchun umumiy).

export type GreetLang = 'uz' | 'ru';
export type Recency = 'never' | 'today' | 'yesterday' | 'week' | 'long';
export type DayPart = 'morning' | 'day' | 'evening' | 'night';

export interface GreetingInput {
  lang: GreetLang;
  name?: string;
  hour: number;                      // Toshkent soati 0..23
  recency?: Recency;
  /** Yaqinda (3 kun ichida) muvaffaqiyatli bajarilgan amal (tool nomi). */
  recentTool?: string;
  /** Oxirgi aytilgan salom — aynan shu qaytarilmaydi. */
  last?: string;
  /** Foydalanuvchi o'zi salom berganmi (shunda alik bilan boshlanadi). */
  replyTo?: boolean;
  rng?: () => number;
}

/** Owner: shu qolip endi ishlatilmaydi. */
export const BANNED_GREETING_RE = /qandaysiz[,.!?]?\s*(sizga\s+)?(nima|qanday)\s+yordam\s+bera\s+olaman/i;

export const dayPartOf = (hour: number): DayPart => (hour >= 5 && hour < 11 ? 'morning' : hour >= 11 && hour < 17 ? 'day' : hour >= 17 && hour < 22 ? 'evening' : 'night');

const P = {
  uz: {
    open: {
      morning: ['Xayrli tong{n}!', 'Assalomu alaykum{n}, tongingiz xayrli bo\'lsin!', 'Tong bilan{n}!', 'Assalomu alaykum{n}! Erta turibsiz-ku.'],
      day: ['Assalomu alaykum{n}!', 'Salom{n}!', 'Xayrli kun{n}!', 'Assalomu alaykum{n}, ishlar qizg\'inmi?'],
      evening: ['Xayrli kech{n}!', 'Assalomu alaykum{n}!', 'Kechingiz xayrli bo\'lsin{n}!', 'Salom{n}, kun qanday o\'tdi?'],
      night: ['Assalomu alaykum{n}, kech bo\'lib qoldi-ku!', 'Salom{n}! Hali ham ishdasizmi?', 'Assalomu alaykum{n}!'],
    } as Record<DayPart, string[]>,
    reply: ['Va alaykum assalom{n}!', 'Vaalaykum salom{n}!', 'Salom{n}, xush kelibsiz!'],
    recency: {
      today: ['Yana eshitaman.', 'Yana birga ishlaymiz.', 'Qaytganingizdan xursandman.'],
      yesterday: ['Kecha gaplashgan edik.', 'Kechagi suhbatdan keyin yana salom.'],
      long: ['Ancha bo\'ldi gaplashmaganimizga.', 'Ko\'rinmay qoldingiz-ku.'],
    } as Partial<Record<Recency, string[]>>,
    recent: {
      notifyManager: ['Rahbarga yozgan gapingizdan javob bo\'ldimi?'],
      messageEmployee: ['Xodimga yuborgan xabaringiz yetib bordi.', 'Oxirgi xabaringiz yetkazilgan.'],
      callEmployee: ['Xodimga aytgan gapingizni yetkazganman.'],
      createReminder: ['Eslatmalaringiz joyida.', 'Eslatmangiz kuzatuvda.'],
    } as Record<string, string[]>,
    ask: {
      morning: ['Bugun nimadan boshlaymiz?', 'Bugungi rejalar qanday?', 'Nima qilib beray?'],
      day: ['Nima qilib beray?', 'Qanday ish bor?', 'Eshitaman, ayting.', 'Nimaga yordam kerak?'],
      evening: ['Nima qilib beray?', 'Kun yakunida nima kerak?', 'Eshitaman.'],
      night: ['Tez hal qilamiz — nima kerak?', 'Eshitaman.', 'Nima qilib beray?'],
    } as Record<DayPart, string[]>,
  },
  ru: {
    open: {
      morning: ['Доброе утро{n}!', 'Здравствуйте{n}, доброе утро!', 'С добрым утром{n}!'],
      day: ['Здравствуйте{n}!', 'Добрый день{n}!', 'Привет{n}!'],
      evening: ['Добрый вечер{n}!', 'Здравствуйте{n}!', 'Привет{n}, как прошёл день?'],
      night: ['Здравствуйте{n}, уже поздно!', 'Добрый вечер{n}! Ещё на работе?'],
    } as Record<DayPart, string[]>,
    reply: ['Здравствуйте{n}!', 'И вам здравствуйте{n}!', 'Привет{n}!'],
    recency: {
      today: ['Снова на связи.', 'Хорошо, что вы снова здесь.'],
      yesterday: ['Вчера мы общались.'],
      long: ['Давно не общались.'],
    } as Partial<Record<Recency, string[]>>,
    recent: {
      notifyManager: ['Руководитель ответил на ваше сообщение?'],
      messageEmployee: ['Ваше сообщение сотруднику доставлено.'],
      callEmployee: ['Ваши слова сотруднику переданы.'],
      createReminder: ['Ваши напоминания на месте.'],
    } as Record<string, string[]>,
    ask: {
      morning: ['С чего начнём сегодня?', 'Какие планы на сегодня?', 'Чем помочь?'],
      day: ['Чем помочь?', 'Что нужно сделать?', 'Слушаю вас.'],
      evening: ['Чем помочь?', 'Что нужно под конец дня?', 'Слушаю.'],
      night: ['Быстро решим — что нужно?', 'Слушаю.'],
    } as Record<DayPart, string[]>,
  },
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Odamdek, qisqa (2–3 jumla) va har safar boshqacha salom. `last` bilan bir xil bo'lmaydi; taqiqlangan qolip yo'q.
 */
export function composeGreeting(i: GreetingInput): string {
  const rng = i.rng || Math.random;
  const pick = <T>(a: T[]): T => a[Math.floor(rng() * a.length) % a.length];
  const L = P[i.lang === 'ru' ? 'ru' : 'uz'];
  const part = dayPartOf(((i.hour % 24) + 24) % 24);
  const name = String(i.name || '').replace(/[^\p{L}\p{M}' -]/gu, '').trim().slice(0, 30);
  const n = name ? `, ${name}` : '';
  const last = clean(String(i.last || '')).toLowerCase();
  let out = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    const parts = [pick(i.replyTo ? L.reply : L.open[part]).replace('{n}', n)];
    const rec = i.recency ? L.recency[i.recency] : undefined;
    const did = i.recentTool ? L.recent[i.recentTool] : undefined;
    const r = rng();
    if (did && r < 0.5) parts.push(pick(did));
    else if (rec && r < 0.85) parts.push(pick(rec));
    // Ochilish allaqachon savol bilan tugagan bo'lsa ("ishlar qizg'inmi?") — ikkinchi savol shart emas
    if (!/\?$/.test(parts[parts.length - 1]) || rng() < 0.3) parts.push(pick(L.ask[part]));
    out = clean(parts.join(' '));
    if (out.toLowerCase() !== last && !BANNED_GREETING_RE.test(out)) return out;
  }
  // Juda kam ehtimol: hamma urinish oxirgisiga teng — qisqa boshqa variant
  const alt = clean(`${i.lang === 'ru' ? 'Слушаю вас' : 'Eshitaman'}${n}.`);
  return alt.toLowerCase() !== last ? alt : `${out} ${pick(L.ask[part])}`;
}

/** Oxirgi suhbat qachon bo'lganidan "yaqinlik" (Toshkent kunlari bo'yicha). */
export function recencyOf(lastAt: Date | null | undefined, now: Date = new Date()): Recency {
  if (!lastAt) return 'never';
  const d0 = zonedParts(lastAt).date;
  const d1 = zonedParts(now).date;
  const days = Math.round((Date.parse(`${d1}T00:00:00Z`) - Date.parse(`${d0}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 7) return 'week';
  return 'long';
}

const RECENT_TOOLS = ['notifyManager', 'messageEmployee', 'callEmployee', 'createReminder'];

/**
 * Shaxs uchun salom (DB'dan oxirgi salom, oxirgi suhbat va yaqindagi amal) va uni eslab qolish.
 * Xato bo'lsa ham salom qaytadi (xotirasiz).
 */
export async function greetingFor(o: {
  companyId: string; userId: string; lang: GreetLang; name?: string; now?: Date; replyTo?: boolean; excludeSessionId?: string; rng?: () => number;
}): Promise<string> {
  const now = o.now || new Date();
  const hour = Number(zonedParts(now).hhmm.slice(0, 2));
  const ok = isObjectIdString(o.companyId) && isObjectIdString(o.userId);
  let last = '';
  let lastAt: Date | undefined;
  let recentTool: string | undefined;
  if (ok) {
    const [contact, call, act]: any[] = await Promise.all([
      AiEmployeeContact.findOne({ companyId: o.companyId, employeeId: o.userId }).select('lastGreeting lastGreetingAt').lean().catch(() => null),
      AiCallSession.findOne({
        companyId: o.companyId, employeeId: o.userId, answeredAt: { $ne: null },
        ...(o.excludeSessionId && isObjectIdString(o.excludeSessionId) ? { _id: { $ne: o.excludeSessionId } } : {}),
      }).sort({ answeredAt: -1 }).select('answeredAt').lean().catch(() => null),
      AiActionAudit.findOne({
        companyId: o.companyId, actorUserId: o.userId, kind: 'write', status: { $in: ['ok', 'confirmed'] }, tool: { $in: RECENT_TOOLS },
        createdAt: { $gt: new Date(now.getTime() - 3 * 86_400_000) },
      }).sort({ createdAt: -1 }).select('tool').lean().catch(() => null),
    ]);
    last = String(contact?.lastGreeting || '');
    const times = [contact?.lastGreetingAt, call?.answeredAt].filter(Boolean).map((d: any) => new Date(d));
    lastAt = times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : undefined;
    recentTool = act?.tool;
  }
  const text = composeGreeting({ lang: o.lang, name: o.name, hour, recency: recencyOf(lastAt, now), recentTool, last, replyTo: o.replyTo, rng: o.rng });
  if (ok) await rememberGreeting(o.companyId, o.userId, text, now);
  return text;
}

/** Ikki salom amalda bir xilmi (tinish belgilari, katta-kichik harf, emoji e'tiborsiz). */
export function sameGreeting(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => normApostrophes(String(s || '').toLowerCase()).replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const x = n(a);
  return !!x && x === n(b);
}

/** Shu odamga aytilgan oxirgi salomni eslab qolish (matn va ovoz uchun umumiy). */
export async function rememberGreeting(companyId: string, userId: string, text: string, now: Date = new Date()): Promise<void> {
  if (!isObjectIdString(companyId) || !isObjectIdString(userId)) return;
  await AiEmployeeContact.updateOne(
    { companyId, employeeId: userId },
    { $set: { lastGreeting: String(text || '').slice(0, 300), lastGreetingAt: now }, $setOnInsert: { companyId, employeeId: userId } },
    { upsert: true },
  ).catch(() => undefined);
}
