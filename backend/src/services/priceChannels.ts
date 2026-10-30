import AppSettings from '../models/AppSettings';
import { recordPoint } from './marketPrice';

// Telegram ochiq kanallaridan narx yig'ish — BETA (owner 2026-10-29).
//
// NEGA AI AKKAUNTLARI ISHLATILMAYDI: ular allaqachon mo'rt (biri PEER_FLOOD yegan,
// ikkalasi "isitish" rejimida). O'nlab kanalga qo'shilib o'qish — bloklanishning eng
// qisqa yo'li, va u bilan birga AI qo'ng'iroq butunlay o'ladi. Shuning uchun bu yerda
// Telegram akkaunti UMUMAN YO'Q.
//
// Buning o'rniga Telegramning O'ZI beradigan ochiq sahifa ishlatiladi:
//     https://t.me/s/<kanal>
// Bu — oddiy HTML sahifa: akkaunt ham, API kalit ham, kanalga qo'shilish ham shart emas.
// Demak blok xavfi NOL va qo'ng'iroq tizimiga umuman tegmaydi.
//
// Cheklovlar (shuning uchun BETA):
//  • faqat OCHIQ kanallar (yopiq kanal ko'rinmaydi);
//  • faqat oxirgi ~20 ta post;
//  • narx e'londa qanday yozilgan bo'lsa shunday olinadi — bu SO'RALAYOTGAN narx,
//    chekdagi TO'LANGAN narx emas. Shuning uchun manba alohida belgilanadi ('telegram').

const FETCH_TIMEOUT_MS = 12_000;
const MAX_POSTS = 40;
/** Aqlga sig'adigan birlik narxi oralig'i (so'm) — telefon raqami yoki yil tushib qolmasin. */
const MIN_PRICE = 100;
const MAX_PRICE = 200_000_000;
/** Shu oraliq OLX yig'uvchisida ham ishlatiladi (bir xil chegara — bir xil sifat). */
export const PRICE_BAND = { min: MIN_PRICE, max: MAX_PRICE };

const CUR_RE = "(?:so[''`’]?m|sum|сум|сўм|uzs)";
export const UNIT_WORDS: Record<string, string> = {
  qop: 'qop', коп: 'qop', мешок: 'qop', meshok: 'qop',
  kg: 'kg', кг: 'kg', kilogramm: 'kg',
  tonna: 't', тонна: 't', tn: 't',
  dona: 'dona', дона: 'dona', шт: 'dona', sht: 'dona',
  m2: 'm2', кв: 'm2', kvadrat: 'm2',
  m3: 'm3', куб: 'm3', kub: 'm3',
  metr: 'm', метр: 'm',
  litr: 'l', литр: 'l',
  rulon: 'rulon', рулон: 'rulon',
};

export interface ParsedPrice { name: string; price: number; unit: string }

/** Bitta satrdan narx ajratadi. Narx yoki nom topilmasa — null. */
export function parseLine(line: string): ParsedPrice | null {
  const raw = String(line || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length > 200) return null;
  // Telefon raqami, havola, teg — narx emas
  if (/\+998|https?:|@[a-z_]/i.test(raw)) return null;

  // Raqamni EHTIYOT bilan ajratamiz. Sodda "[0-9 ]+" naqshi "Sement M400 52000 so'm"
  // da "400 52000" ni bitta son deb o'qib, narxni 40 052 000 qilib yuborardi (test bilan
  // topildi). Shuning uchun: yo minglik guruhlar (52 000 / 9 500 000 - har guruh ANIQ 3 xona),
  // yoki yaxlit 3-9 xonali son. Oldidan raqam kelmasligi ham shart (M400 ning "400" i emas).
  const m = new RegExp(`(?<![0-9])([0-9]{1,3}(?:[ .,' ][0-9]{3})+|[0-9]{3,9})\\s*${CUR_RE}`, 'i').exec(raw);
  if (!m) return null;
  const price = Number(m[1].replace(/[^0-9]/g, ''));
  if (!Number.isFinite(price) || price < MIN_PRICE || price > MAX_PRICE) return null;

  // Birlik: narxdan keyin ("/qop", "1 qop") yoki satrning istalgan joyida
  const after = raw.slice(m.index + m[0].length, m.index + m[0].length + 24).toLowerCase();
  const before = raw.slice(0, m.index).toLowerCase();
  let unit = '';
  for (const [w, u] of Object.entries(UNIT_WORDS)) {
    const re = new RegExp(`(^|[^a-zа-я0-9])${w}([^a-zа-я0-9]|$)`, 'i');
    if (re.test(after)) { unit = u; break; }
  }
  if (!unit) {
    for (const [w, u] of Object.entries(UNIT_WORDS)) {
      const re = new RegExp(`(^|[^a-zа-я0-9])${w}([^a-zа-я0-9]|$)`, 'i');
      if (re.test(before)) { unit = u; break; }
    }
  }
  if (!unit) return null;      // birliksiz narx solishtirib bo'lmaydi — tashlanadi

  // Nom: narxdan oldingi matn, bezaklardan tozalangan
  const name = raw.slice(0, m.index)
    .replace(/[-–—:•*_=>«»"']+/g, ' ')
    .replace(/\b\d+\s*(qop|kg|dona|tonna|шт|кг)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 2 || name.length > 60) return null;
  if (!/[a-zа-яё]/i.test(name)) return null;     // faqat raqamdan iborat "nom" — emas
  return { name, price, unit };
}

/** Post matnidan barcha narxlarni ajratadi. */
export function parsePost(text: string): ParsedPrice[] {
  const out: ParsedPrice[] = [];
  for (const line of String(text || '').split(/[\n\r]+/)) {
    const p = parseLine(line);
    if (p) out.push(p);
  }
  return out;
}

/** t.me/s/<kanal> sahifasidan post matnlari (HTML teglarsiz). */
export async function fetchChannelPosts(channel: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const ch = String(channel || '').replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9_]{4,32}$/.test(ch)) return [];
  const r = await fetchImpl(`https://t.me/s/${ch}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; QurilishERP/1.0)' },
  });
  if (!r.ok) throw new Error(`HTTP_${r.status}`);
  const html = await r.text();
  const posts: string[] = [];
  const re = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && posts.length < MAX_POSTS) {
    const text = m[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    if (text.trim()) posts.push(text);
  }
  return posts;
}

/** Sozlamadagi kanallar ro'yxati (dasturchi panelidan boshqariladi). */
export async function getChannels(): Promise<string[]> {
  const s: any = await AppSettings.findOne({ key: 'global' }).select('priceChannels').lean().catch(() => null);
  const list = Array.isArray(s?.priceChannels) ? s.priceChannels : [];
  return list.map((c: unknown) => String(c).replace(/^@/, '').trim()).filter(Boolean).slice(0, 30);
}

export interface CollectResult { channels: number; posts: number; prices: number; errors: string[] }

/** Barcha kanallarni aylanib chiqib, topilgan narxlarni indeksga yozadi. */
export async function collectFromChannels(opts: { fetchImpl?: typeof fetch } = {}): Promise<CollectResult> {
  const channels = await getChannels();
  const out: CollectResult = { channels: channels.length, posts: 0, prices: 0, errors: [] };
  for (const ch of channels) {
    try {
      const posts = await fetchChannelPosts(ch, opts.fetchImpl || fetch);
      out.posts += posts.length;
      for (const [i, text] of posts.entries()) {
        for (const p of parsePost(text)) {
          await recordPoint({
            name: p.name, unit: p.unit, price: p.price, source: 'telegram',
            // Bitta post bitta marta hisoblansin (qayta yurishda takrorlanmaydi)
            refId: `tg:${ch}:${i}:${p.name.slice(0, 24)}:${p.price}`,
          });
          out.prices++;
        }
      }
    } catch (e) {
      out.errors.push(`${ch}: ${String((e as Error)?.message || e).slice(0, 80)}`);
    }
  }
  return out;
}

/** Har 6 soatda avtomatik yig'ish (Telegram kanallari + OLX). Kanal ro'yxati bo'sh bo'lsa — faqat OLX. */
const EVERY_MS = 6 * 3600_000;
const FIRST_DELAY_MS = 2 * 60_000;   // serverni ishga tushishiga xalaqit qilmasin
let timer: NodeJS.Timeout | null = null;

export function startPriceCollector(): void {
  if (timer) return;
  // Indeks bo'sh bo'lsa — avval bazadagi eski xaridlardan to'ldiriladi, aks holda
  // qidiruv birinchi kunlarda doim bo'sh qaytadi (owner 2026-10-30).
  void import('./marketPrice').then((m) => m.backfillIfEmpty()).catch(() => undefined);
  const run = () => {
    // OLX ham shu bilan birga yurib chiqadi (ochiq e'lonlar — kalit kerak emas).
    // Xatosi kanal yig'ishini to'xtatmasligi uchun alohida zanjirda.
    void import('./priceOlx')
      .then((m) => m.collectFromOlx())
      .catch((e) => console.warn("[narx/olx] yig'ish xatosi:", String((e as Error)?.message || e).slice(0, 160)));
    collectFromChannels()
      .then((r) => {
        if (r.channels) {
          console.log(`[narx] ${r.channels} kanal, ${r.posts} post, ${r.prices} narx` + (r.errors.length ? ` (xato: ${r.errors.join('; ').slice(0, 200)})` : ''));
        }
      })
      .catch((e) => console.warn("[narx] yig'ish xatosi:", String((e as Error)?.message || e).slice(0, 160)));
  };
  const first = setTimeout(run, FIRST_DELAY_MS);
  first.unref?.();
  timer = setInterval(run, EVERY_MS);
  timer.unref?.();
}
