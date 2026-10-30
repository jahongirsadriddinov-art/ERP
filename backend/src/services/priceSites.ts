import AppSettings from '../models/AppSettings';
import { recordPoint } from './marketPrice';
import { parsePost } from './priceChannels';

// Saytlardan narx yig'ish (owner 2026-10-30: "faqat tg kanal emas, saytlar
// bilan ham kiritib bo'ladi").
//
// Telegram kanallari bilan BIR XIL mantiq: sahifa matni olinadi va narx
// ajratuvchi mavjud tahlilchidan o'tkaziladi. Yangi tahlilchi yozilmadi —
// narx "Sement M400 — 52 000 so'm/qop" ko'rinishida yozilgan bo'lsa, u
// kanalda ham, saytda ham bir xil ko'rinadi.
//
// CHEGARA (shuning uchun BETA): faqat ODDIY (server qaytaradigan) HTML
// o'qiladi. Narxlari JavaScript bilan chiziladigan sayt bo'sh chiqadi —
// shuning uchun qo'shishdan oldin "Sinab ko'rish" bor: nechta narx
// chiqqani darhol ko'rinadi, ishlamasa qo'shilmaydi.
//
// XAVFSIZLIK: faqat http(s), ichki tarmoq manzillari rad etiladi.

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML = 900_000;
const MAX_SITES = 20;

export interface SitePoint { name: string; price: number; unit: string }
export interface SiteProbe { url: string; ok: boolean; prices: number; sample?: string; error?: string }

/** Manzilni tekshiradi va bir ko'rinishga keltiradi. Yaroqsiz bo'lsa — bo'sh satr. */
export function normalizeSiteUrl(raw: unknown): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const host = u.hostname.toLowerCase();
    // Ichki/xizmat manzillari — serverning o'z tarmog'iga so'rov yuborilmasin
    if (!host.includes('.')) return '';
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return '';
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return '';
    if (host.endsWith('.local') || host.endsWith('.internal')) return '';
    u.hash = '';
    return u.toString().slice(0, 300);
  } catch {
    return '';
  }
}

/** HTML'dan o'qiladigan matn: skript/uslub olib tashlanadi, teglar qatorga bo'linadi. */
export function htmlToText(html: string): string {
  return String(html || '')
    .slice(0, MAX_HTML)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // Jadval KATAKLARI bitta qatorda qoladi: nom va narx odatda qo'shni
    // kataklarda turadi ("<td>Sement M400</td><td>52 000 so'm</td>") — ularni
    // alohida qatorga bo'lib yuborilsa, tahlilchi nomni narxga bog'lay olmaydi.
    .replace(/<\/(td|th)>/gi, ' ')
    // Qolgan bloklar yangi qatordan — tahlilchi satr bo'yicha ishlaydi
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{2,}/g, '\n');
}

/** Sayt matnidan narxlar. */
export function parseSite(html: string): SitePoint[] {
  return parsePost(htmlToText(html)).slice(0, 200);
}

/** Saytni sinab ko'radi: ochiladimi va nechta narx chiqadi. */
export async function probeSite(raw: string, fetchImpl: typeof fetch = fetch): Promise<SiteProbe> {
  const url = normalizeSiteUrl(raw);
  if (!url) return { url: String(raw || '').slice(0, 120), ok: false, prices: 0, error: "Manzil noto'g'ri" };
  try {
    const r = await fetchImpl(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QurilishERP narx indeksi)', Accept: 'text/html' },
    });
    if (!r.ok) return { url, ok: false, prices: 0, error: `Sayt javob bermadi (HTTP ${r.status})` };
    const points = parseSite(await r.text());
    return {
      url, ok: true, prices: points.length,
      ...(points[0] ? { sample: `${points[0].name} — ${points[0].price.toLocaleString('uz-UZ')} so'm/${points[0].unit}` } : {}),
    };
  } catch (e) {
    return { url, ok: false, prices: 0, error: String((e as Error)?.message || e).slice(0, 120) };
  }
}

/** Saqlangan sayt ro'yxati. */
export async function getSites(): Promise<string[]> {
  const doc: any = await AppSettings.findOne({ key: 'global' }).select('priceSites').lean().catch(() => null);
  const list = Array.isArray(doc?.priceSites) ? doc.priceSites : [];
  return list.map((x: unknown) => normalizeSiteUrl(x)).filter(Boolean).slice(0, MAX_SITES);
}

export async function setSites(list: unknown[]): Promise<string[]> {
  const clean = [...new Set((Array.isArray(list) ? list : []).map(normalizeSiteUrl).filter(Boolean))].slice(0, MAX_SITES);
  await AppSettings.updateOne({ key: 'global' }, { $set: { priceSites: clean } }, { upsert: true });
  return clean;
}

export interface SiteCollectResult { sites: number; prices: number; errors: string[] }

/** Barcha saytlarni aylanib chiqib, topilgan narxlarni indeksga yozadi. */
export async function collectFromSites(opts: { fetchImpl?: typeof fetch } = {}): Promise<SiteCollectResult> {
  const sites = await getSites();
  const out: SiteCollectResult = { sites: sites.length, prices: 0, errors: [] };
  for (const url of sites) {
    const r = await probeSite(url, opts.fetchImpl || fetch);
    if (!r.ok) { out.errors.push(`${url}: ${r.error}`); continue; }
    try {
      const html = await (opts.fetchImpl || fetch)(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QurilishERP narx indeksi)', Accept: 'text/html' },
      }).then((x) => x.text());
      const host = new URL(url).hostname;
      for (const [i, p] of parseSite(html).entries()) {
        await recordPoint({
          name: p.name, unit: p.unit, price: p.price, source: 'manual',
          // Bitta sahifadagi bitta qator bir marta hisoblansin
          refId: `site:${host}:${i}:${p.name.slice(0, 24)}:${p.price}`,
        });
        out.prices++;
      }
    } catch (e) {
      out.errors.push(`${url}: ${String((e as Error)?.message || e).slice(0, 80)}`);
    }
  }
  if (out.prices) console.log(`[narx/sayt] ${out.prices} ta narx yig'ildi (${out.sites} sayt)`);
  return out;
}
