import User from '../../models/User';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import { isAiActive } from '../settings';
import { getSharedQueue, type JobQueue } from '../queue/jobQueue';
import { callWorker } from './workerRpc';
import { pickPoolAccount } from './companyAccounts';


// Yangi xodim qo'shilganda AI o'zini tanishtiradi (owner 2026-10-29: "firmada user
// qo'shilgan vaqt AI akkauntlar o'sha nomerlarning barchasini kontaktga ismi bilan
// saqlasin, keyin hammasiga o'zi yozsin, o'zini tanishtirsin va kontaktiga qo'shishni
// tushuntirsin va o'rgatsin").
//
// NEGA SEKIN: Telegram yangi akkauntdan notanish odamlarga ko'p yozilishini SPAM deb
// biladi — aynan shu sababdan bitta AI akkaunti PEER_FLOOD yegan (28.10). Shuning uchun
// bu yerda hech qanday "hammasiga birdan" yuborish YO'Q: har bir xodim alohida ish
// (job) bo'lib navbatga tushadi, worker kunlik chegarani (kontakt/xabar) o'zi qo'llaydi
// va chegara tugasa ish KEYINGI KUNGA suriladi. 10 ta xodim bir necha kunda qamraladi,
// akkaunt esa xavf ostida qolmaydi.
//
// Tanishtiruv yuborilgach AiEmployeeContact.introducedAt belgilanadi — ikkinchi marta
// yozilmaydi (xodim o'chirilib qayta qo'shilsa ham, belgi o'sha kontakt yozuvida turadi).

export const INTRO_JOB = 'aiv.tg.intro';

/** Chegara/limit sabablari — xato emas, shunchaki "hozir emas": ish keyinroq qaytadi. */
const DEFER = new Set(['import_limited', 'flood_wait', 'rate_limited', 'spam_limited', 'account_frozen', 'peer_limited']);
/** Chegara tugaganda keyingi urinish — ertasi kuni (kunlik limit shunda yangilanadi). */
const DEFER_MS = 6 * 3600_000;

function introText(name: string, aiName: string, lang: 'uz' | 'ru'): string {
  const first = (name || '').split(' ')[0] || '';
  if (lang === 'ru') {
    return `Здравствуйте${first ? ', ' + first : ''}! Я ${aiName} — AI-помощник вашей компании в ERP.\n\n`
      + `Я могу звонить и писать вам по рабочим вопросам: напоминания, подтверждение выхода на работу, отчёты, расходы.\n\n`
      + `Важная просьба: сохраните мой номер в контакты (откройте мой профиль → «Добавить в контакты»). `
      + `Без этого Telegram может не пропускать мои звонки и сообщения к вам.\n\n`
      + `Напишите мне в любое время — отвечу.`;
  }
  return `Assalomu alaykum${first ? ', ' + first : ''}! Men ${aiName} — firmangizning ERP tizimidagi AI yordamchisiman.\n\n`
    + `Ish bo'yicha sizga qo'ng'iroq qilaman va yozaman: eslatmalar, ishga kelishni tasdiqlash, hisobotlar, xarajatlar.\n\n`
    + `Bitta iltimos: raqamimni kontaktingizga saqlab qo'ying (profilimni oching → «Kontaktga qo'shish»). `
    + `Aks holda Telegram mening qo'ng'iroq va xabarlarimni sizga o'tkazmasligi mumkin.\n\n`
    + `Istalgan vaqtda yozing — javob beraman.`;
}

/** Yangi xodim uchun tanishtiruvni navbatga qo'yadi (xatolar yutiladi — xodim qo'shish buzilmasin). */
export async function enqueueIntroduce(companyId: string, employeeId: string): Promise<void> {
  try {
    const q = getSharedQueue();
    if (!q || !companyId || !employeeId) return;
    ensureIntroJob(q);
    await q.enqueue({
      type: INTRO_JOB, companyId, employeeId, refId: employeeId,
      dedupeKey: `aiv:intro:${employeeId}`,
      // Darhol emas: xodim endi qo'shildi, ma'lumotlari to'liq yozilsin
      runAt: new Date(q.now().getTime() + 60_000),
      maxAttempts: 12,
    });
  } catch (e) {
    console.warn('[aiVoice/intro] navbatga qo\'shilmadi:', (e as Error)?.message);
  }
}

let registered = false;
export function ensureIntroJob(q: JobQueue): void {
  if (registered || q.registeredTypes().includes(INTRO_JOB)) return;
  registered = true;
  q.register(INTRO_JOB, async ({ job }) => {
    await runIntroduce(String(job.companyId || ''), String(job.employeeId || ''));
  }, { concurrency: 1, maxAttempts: 12, backoffBaseMs: DEFER_MS });
}

export type IntroOutcome = 'sent' | 'skipped' | 'deferred';

/** Bitta xodimga tanishtiruv. Chegaraga urilsa 'deferred' (ish qayta uriniladi). */
export async function runIntroduce(companyId: string, employeeId: string): Promise<IntroOutcome> {
  if (!companyId || !employeeId) return 'skipped';
  if (!(await isAiActive(companyId))) return 'skipped';

  const u: any = await User.findOne({ _id: employeeId, companyId, isBlocked: { $ne: true } })
    .select('firstName lastName phone language role').lean().catch(() => null);
  if (!u || !u.phone) return 'skipped';

  const ct: any = await AiEmployeeContact.findOne({ companyId, employeeId })
    .select('introducedAt optOut telegram.tgUserId').lean();
  if (ct?.introducedAt || ct?.optOut?.all) return 'skipped';

  const acc = await pickPoolAccount(new Date(), { employeeId });
  if (!acc) return 'deferred';                       // bo'sh akkaunt yo'q — keyinroq

  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  const lang: 'uz' | 'ru' = String(u.language || '').startsWith('ru') ? 'ru' : 'uz';

  // 1) Raqamni kontaktga ISMI bilan saqlash (worker importContacts qiladi) va Telegram id'sini olish
  let tgUserId = typeof ct?.telegram?.tgUserId === 'string' ? ct.telegram.tgUserId : '';
  if (!tgUserId) {
    const r = await callWorker('contact.lookup', { phone: String(u.phone), account: acc.id }).catch((e) => {
      console.warn('[aiVoice/intro] contact.lookup:', (e as Error)?.message);
      return null;
    });
    if (!r) return 'deferred';
    if (DEFER.has(String(r.status))) return 'deferred';
    if (r.status !== 'resolved' || !r.tgUserId) {
      // Telefon Telegram'da yo'q yoki maxfiylik yopiq — qayta urinish foydasiz
      await mark(companyId, employeeId);
      return 'skipped';
    }
    tgUserId = String(r.tgUserId);
    await AiEmployeeContact.updateOne(
      { companyId, employeeId },
      { $set: { 'telegram.tgUserId': tgUserId, 'telegram.resolveStatus': 'resolved', 'telegram.resolvedAt': new Date() } },
      { upsert: true },
    ).catch(() => undefined);
  }

  // 2) Tanishtiruv xabari
  try {
    await callWorker('dm.send', { account: acc.id, tgUserId, text: introText(name, acc.name || 'AI', lang) });
  } catch (e) {
    const code = String((e as Error)?.message || '');
    if (DEFER.has(code)) return 'deferred';
    console.warn('[aiVoice/intro] dm.send:', code.slice(0, 120));
    return 'deferred';
  }
  await mark(companyId, employeeId);
  return 'sent';
}

function mark(companyId: string, employeeId: string) {
  return AiEmployeeContact.updateOne(
    { companyId, employeeId }, { $set: { introducedAt: new Date() } }, { upsert: true },
  ).catch(() => undefined);
}
