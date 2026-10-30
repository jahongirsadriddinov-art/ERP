import User from '../../models/User';
import Company from '../../models/Company';
import { importContactNow } from './accountService';

// Kontaktlarni QO'LDA qo'shish (owner 2026-10-30: "hamma userlar chiqadi,
// hohlasam bittalab, hohlasam qanchadir, hohlasam hammasini bittada, hohlasam
// aynan qaysidir firmani userlarini").
//
// NEGA KERAK: Telegram notanish odamga qo'ng'iroq qilishni cheklaydi
// (PeerFloodError). Odam AI akkauntining kontaktida bo'lsa — cheklov tegmaydi.
// Avtomatik qo'shish soatiga bir nechta bilan cheklangan, shuning uchun yangi
// xodimlar uzoq navbatda turardi. Endi egasi o'zi tanlab, darhol qo'sha oladi.
//
// XAVFSIZLIK: qaror odamniki, lekin cheklov butunlay olib tashlanmaydi —
// importlar orasida tanaffus bor va bitta yurishda chegara qo'yilgan. Buning
// sababi shu: juda tez import qilish aynan o'sha PeerFlood/ban'ga olib keladi,
// ya'ni muammoni hal qilish o'rniga kuchaytirardi.

/** Bitta yurishda ko'pi bilan shuncha kontakt. */
const MAX_PER_RUN = 60;
/** Importlar orasidagi tanaffus (ms). */
const GAP_MS = 20_000;

export interface ImportCandidate {
  id: string; name: string; role: string; companyId: string; companyName: string;
  /** Telegram'i ulanganmi (ulanmagani importdan foyda bermaydi). */
  linked: boolean;
  status: string;
}

export interface ImportProgress {
  running: boolean;
  total: number; done: number; ok: number; failed: number;
  startedAt: string | null; finishedAt: string | null;
  current: string | null;
  /** Har bir natija: ism → holat. */
  results: { name: string; status: string }[];
  stopRequested: boolean;
}

const progress: ImportProgress = {
  running: false, total: 0, done: 0, ok: 0, failed: 0,
  startedAt: null, finishedAt: null, current: null, results: [], stopRequested: false,
};

export const importProgress = (): ImportProgress => ({ ...progress, results: progress.results.slice(-80) });

export function requestStop(): void {
  if (progress.running) progress.stopRequested = true;
}

/** Tanlash uchun foydalanuvchilar ro'yxati (firma bo'yicha ham filtrlanadi). */
export async function listCandidates(opts: { companyId?: string } = {}): Promise<ImportCandidate[]> {
  const AiEmployeeContact = (await import('../../models/AiEmployeeContact')).default;
  const filter: Record<string, unknown> = { isBlocked: { $ne: true }, role: { $ne: 'dasturchi' } };
  if (opts.companyId) filter.companyId = String(opts.companyId);
  const users: any[] = await User.find(filter).select('firstName lastName role companyId').sort({ companyId: 1, firstName: 1 }).limit(2000).lean();
  const companyIds = [...new Set(users.map((u) => String(u.companyId || '')).filter(Boolean))];
  const companies: any[] = await Company.find({ _id: { $in: companyIds } }).select('name').lean().catch(() => []);
  const nameOf = new Map(companies.map((c) => [String(c._id), String(c.name || '')]));
  const contacts: any[] = await AiEmployeeContact.find({ employeeId: { $in: users.map((u) => String(u._id)) } })
    .select('employeeId telegram.tgUserId telegram.resolveStatus').lean().catch(() => []);
  const byEmp = new Map(contacts.map((c: any) => [String(c.employeeId), c]));
  return users.map((u) => {
    const c: any = byEmp.get(String(u._id));
    return {
      id: String(u._id),
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—',
      role: String(u.role || ''),
      companyId: String(u.companyId || ''),
      companyName: nameOf.get(String(u.companyId || '')) || '—',
      linked: !!c?.telegram?.tgUserId,
      status: String(c?.telegram?.resolveStatus || ''),
    };
  });
}

/**
 * Tanlangan foydalanuvchilarni fonda kontaktga qo'shadi. Darhol qaytadi —
 * jarayon uzoq (har biri orasida tanaffus), shuning uchun holat alohida
 * so'raladi (importProgress).
 */
export async function startImport(userIds: string[]): Promise<{ started: boolean; total: number; error?: string }> {
  if (progress.running) return { started: false, total: 0, error: 'Avvalgi jarayon hali tugamadi' };
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(String).filter(Boolean))].slice(0, MAX_PER_RUN);
  if (!ids.length) return { started: false, total: 0, error: 'Hech kim tanlanmadi' };

  const users: any[] = await User.find({ _id: { $in: ids } }).select('firstName lastName companyId').lean();
  if (!users.length) return { started: false, total: 0, error: 'Foydalanuvchi topilmadi' };

  Object.assign(progress, {
    running: true, total: users.length, done: 0, ok: 0, failed: 0,
    startedAt: new Date().toISOString(), finishedAt: null, current: null, results: [], stopRequested: false,
  });

  void (async () => {
    for (const [i, u] of users.entries()) {
      if (progress.stopRequested) break;
      const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || String(u._id);
      progress.current = name;
      let status = 'error';
      try {
        status = await importContactNow(String(u.companyId || ''), String(u._id));
      } catch (e) {
        status = String((e as Error)?.message || e).slice(0, 60);
      }
      progress.done++;
      if (status === 'resolved') progress.ok++; else progress.failed++;
      progress.results.push({ name, status });
      // Oxirgisidan keyin kutishning hojati yo'q
      if (i < users.length - 1 && !progress.stopRequested) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
    }
    progress.running = false;
    progress.current = null;
    progress.finishedAt = new Date().toISOString();
  })();

  return { started: true, total: users.length };
}

export const limits = { maxPerRun: MAX_PER_RUN, gapSeconds: GAP_MS / 1000 };
