import Company from '../../models/Company';
import ObjectModel from '../../models/Object';
import { isAiActive } from '../settings';
import { getChannel } from '../channels/registry';
import { alertText, risksFor, severe, tomorrowForecast } from '../../services/weatherAlerts';
import { newCorrelationId } from '../lib/ids';
import { localDate } from '../lib/zonedTime';
import type { ChannelCtx } from '../contracts';
import type { JobQueue } from '../queue/jobQueue';

// Ob-havo ogohlantirishi (owner 2026-10-29: "ob-havoni ogohlantirishini qo'shish kerak").
//
// Har kuni KECHQURUN ertangi kun tekshiriladi — rejani kechasi emas, bugun o'zgartirish
// mumkin bo'lsin. Xavf bo'lmasa HECH KIMGA xabar yuborilmaydi: har kuni "ertaga ob-havo
// yaxshi" deb yozish — spam, va bir hafta ichida odam bunday xabarlarni o'qimay qo'yadi.
//
// Joy: firmaning faol obyekti koordinatasi (bir nechta bo'lsa — birinchisi). Yo'q bo'lsa Toshkent.

export const WEATHER_JOB = 'aiv.weather.daily';

/** Toshkent vaqti bilan shu soatda yuboriladi. */
const SEND_HOUR = 18;

function hourInTashkent(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', hour12: false }).format(now));
}

export async function runWeatherAlerts(now: Date, opts: { force?: boolean } = {}): Promise<{ companies: number; sent: number }> {
  if (!opts.force && hourInTashkent(now) !== SEND_HOUR) return { companies: 0, sent: 0 };
  const companies: any[] = await Company.find({ isActive: { $ne: false } }).select('_id name region').limit(500).lean().catch(() => []);
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

      const ctx: ChannelCtx = {
        companyId, employeeId: '', correlationId: newCorrelationId(),
        purpose: 'assistant', lang: 'uz', now, attemptNo: 1,
      };
      const r = await getChannel('notify_manager')?.attempt(ctx, {
        kind: 'manager_alert',
        title: 'Ertangi ob-havo',
        text,
        urgency: severe(risks) ? 'high' : 'normal',
      });
      if (r && (r.outcome === 'delivered' || r.outcome === 'answered')) sent++;
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
