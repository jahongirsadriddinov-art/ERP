import Company from '../../models/Company';
import ObjectModel from '../../models/Object';
import { isAiActive } from '../settings';
import { alertBosses } from '../../services/companyAlerts';
import { alertText, risksFor, severe, tomorrowForecast } from '../../services/weatherAlerts';
import { localDate } from '../lib/zonedTime';
import type { JobQueue } from '../queue/jobQueue';

// Ob-havo ogohlantirishi (owner 2026-10-29: "ob-havoni ogohlantirishini qo'shish kerak").
//
// Har kuni KECHQURUN ertangi kun tekshiriladi — rejani kechasi emas, bugun o'zgartirish
// mumkin bo'lsin. Xavf bo'lmasa HECH KIMGA xabar yuborilmaydi: har kuni "ertaga ob-havo
// yaxshi" deb yozish — spam, va bir hafta ichida odam bunday xabarlarni o'qimay qo'yadi.
//
// Joy: firmaning faol obyekti koordinatasi (bir nechta bo'lsa — birinchisi). Yo'q bo'lsa Toshkent.
//
// YETKAZISH (owner 2026-10-29: "AI telefon qilib va profilidan yozadi"): ogohlantirish
// rahbarlarga alertBosses orqali boradi — ilova bildirishnomasi + Telegram xabari.
// Xavf JIDDIY bo'lsa severity='critical' qo'yiladi: shunda 30 daqiqada o'qilmasa
// AI o'zi qo'ng'iroq qiladi. Yengil xavfda qo'ng'iroq qilinmaydi — har kuni
// "ertaga shamol" deb telefon qilish foydadan ko'ra ko'proq bezor qiladi.

export const WEATHER_JOB = 'aiv.weather.daily';

/** Toshkent vaqti bilan shu soatda yuboriladi. */
const SEND_HOUR = 18;

function hourInTashkent(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', hour12: false }).format(now));
}

export async function runWeatherAlerts(now: Date, opts: { force?: boolean } = {}): Promise<{ companies: number; sent: number }> {
  if (!opts.force && hourInTashkent(now) !== SEND_HOUR) return { companies: 0, sent: 0 };
  // Faqat FAOL firmalar: Company'da 'isActive' maydoni yo'q, 'status' bor —
  // eski shart to'xtatilgan firmalarni ham qamrab olardi.
  const companies: any[] = await Company.find({ status: 'ACTIVE' }).select('_id name region').limit(500).lean().catch(() => []);
  let sent = 0;
  for (const c of companies) {
    const companyId = String(c._id);
    try {
      if (!(await isAiActive(companyId))) continue;
      const obj: any = await ObjectModel.findOne({ companyId, lat: { $ne: null }, lng: { $ne: null }, status: { $ne: 'completed' as const } })
        .select('lat lng name location').lean().catch(() => null);
      const f = await tomorrowForecast(obj?.lat, obj?.lng);
      const risks = risksFor(f);
      if (!risks.length) continue;
      const place = obj?.location || obj?.name || c.region || '';
      const text = alertText(f, place);
      if (!text) continue;

      const bad = severe(risks);
      const r = await alertBosses({
        companyId,
        // Kalitda sana bor — bir kunda bitta ogohlantirish, lekin ertasiga yangisi keladi
        key: `weather:${localDate(now)}`,
        title: bad ? 'Ertaga ob-havo xavfli' : 'Ertangi ob-havo',
        body: text,
        severity: bad ? 'critical' : 'warning',
        entity: 'weather', entityId: localDate(now),
        dedupeHours: 20,
      });
      if (r.sent) sent++;
    } catch (e) {
      console.warn('[ob-havo] firma uchun xato:', companyId, String((e as Error)?.message || e).slice(0, 120));
    }
  }
  if (sent) console.log(`[ob-havo] ${sent} firmaga ertangi kun ogohlantirishi yuborildi (${localDate(now)})`);
  return { companies: companies.length, sent };
}

export function registerWeatherJob(q: JobQueue): void {
  if (q.registeredTypes().includes(WEATHER_JOB)) return;
  q.register(WEATHER_JOB, async ({ queue }) => { await runWeatherAlerts(queue.now()); }, {
    concurrency: 1, maxAttempts: 2, doneTtlMs: 2 * 3600_000,
  });
  // Soatiga bir marta uyg'onadi, lekin faqat belgilangan soatda yuboradi —
  // shu tariqa server qayta ishga tushsa ham kun o'tkazib yuborilmaydi.
  q.scheduleRecurring(WEATHER_JOB, 3600_000);
}
