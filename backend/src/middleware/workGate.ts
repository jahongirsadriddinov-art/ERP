import { Request } from 'express';
import Attendance from '../models/Attendance';
import { todayInTashkent } from '../utils/tz';

// "Ishga keldim" darvozasi — ishchi/prorab/brigadir faqat SMENA OCHIQ bo'lganda (bugun check-in qilgan va
// hali "Ishni tugatdim" bosmagan) tizimdan foydalana oladi. Ishni tugatgach — sayt, ilova va botda hech narsa
// ishlamaydi, faqat qayta "Ishga keldim" (joylashuv bilan) va kirish/holat yo'llari ochiq.
export const WORKER_ROLES = ['ishchi', 'prorab', 'brigadir'];
const cache = new Map<string, { working: boolean; at: number }>();
const TTL = 20_000;

export async function isOnShift(userId: string): Promise<boolean> {
  const c = cache.get(userId);
  if (c && Date.now() - c.at < TTL) return c.working;
  let working = true;
  try {
    const r: any = await Attendance.findOne({ userId, date: todayInTashkent() }).select('checkIn checkOut').lean();
    working = !!r?.checkIn && !r?.checkOut;
  } catch { working = true; } // baza xatosi ishni to'xtatib qo'ymasin
  cache.set(userId, { working, at: Date.now() });
  return working;
}
export function invalidateShift(userId: string) { cache.delete(String(userId)); }

// Smena yopiq bo'lsa ham ochiq qoladigan yo'llar (darvoza ekrani, qayta ishga kelish, joylashuv, sozlamalar)
const ALLOW = [/^\/api\/attendance/, /^\/api\/auth/, /^\/api\/gps/, /^\/api\/pin/, /^\/api\/sessions/, /^\/api\/push/,
  /^\/api\/errors/, /^\/api\/status/, /^\/api\/currency/];
const ALLOW_GET = [/^\/api\/users\/?$/, /^\/api\/company/, /^\/api\/notifications\/unread-count/];

export function workGateBlocks(req: Request, role: string): boolean {
  if (!WORKER_ROLES.includes(role)) return false;
  const p = (req.originalUrl || '').split('?')[0];
  if (ALLOW.some(re => re.test(p))) return false;
  if (req.method === 'GET' && ALLOW_GET.some(re => re.test(p))) return false;
  return true;
}
export const CHECKIN_REQUIRED = { error: "Avval \"Ishga keldim\" tugmasini bosing — ish vaqti tugagan yoki hali boshlanmagan.", checkinRequired: true };
