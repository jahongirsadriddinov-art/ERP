#!/usr/bin/env node
// QurilishERP — O'Z-O'ZINI TEKSHIRUV.
//
// Nega kerak (owner 2026-10-30: "o'zing chek qiladigan, hamma narsani real
// o'zing chek qiladigan"): yangi funksiyalar ko'payib ketdi va "ishlayaptimi?"
// degan savolga har safar qo'lda javob izlash uzoq. Bu skript HAQIQIY
// tekshiradi: kod yig'iladimi, testlar o'tadimi, jonli server javob beradimi,
// tashqi manbalar (OLX, ob-havo) tirikmi, sayt haqiqatan yangilanganmi.
//
// Hech narsa o'zgartirmaydi — faqat o'qiydi. Yozish, deploy, push qilmaydi.
//
// Ishga tushirish:
//   node scripts/selfcheck.mjs            — hammasi
//   node scripts/selfcheck.mjs --quick    — sekin yig'ish/testlarsiz (faqat jonli tekshiruv)
//   node scripts/selfcheck.mjs --local    — faqat kod (tashqi tarmoqqa chiqmaydi)

import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'backend');
const FRONTEND = join(ROOT, 'frontend');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const LOCAL_ONLY = args.includes('--local');

const API = process.env.SELFCHECK_API || 'https://erpfirma-backend.up.railway.app';
const SITE = process.env.SELFCHECK_SITE || 'https://erp-firma.uz';

const results = [];
let current = null;

const C = { ok: '\x1b[32m', bad: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' };

function head(title) {
  process.stdout.write(`\n${C.dim}${'─'.repeat(64)}${C.off}\n  ${title}\n${C.dim}${'─'.repeat(64)}${C.off}\n`);
}

/** Bitta tekshiruv. fn true/{ok,note} qaytarsa — o'tdi; otsa yoki false — yiqildi. */
async function check(group, name, fn, opts = {}) {
  current = name;
  const t0 = Date.now();
  let state = 'pass';
  let note = '';
  try {
    const r = await fn();
    if (r === false) state = 'fail';
    else if (r && typeof r === 'object') {
      if (r.skip) state = 'skip';
      else if (r.ok === false) state = opts.soft ? 'warn' : 'fail';
      note = r.note || '';
    }
  } catch (e) {
    state = opts.soft ? 'warn' : 'fail';
    note = String(e?.message || e).replace(/\s+/g, ' ').slice(0, 220);
  }
  const ms = Date.now() - t0;
  results.push({ group, name, state, note, ms });
  const mark = state === 'pass' ? `${C.ok}OK  ${C.off}` : state === 'fail' ? `${C.bad}XATO${C.off}`
    : state === 'warn' ? `${C.warn}OGOH${C.off}` : `${C.dim}O'TK ${C.off}`;
  process.stdout.write(`  ${mark} ${name}${note ? `\n       ${C.dim}${note}${C.off}` : ''}${C.dim}  (${ms} ms)${C.off}\n`);
}

/** Buyruqni ishga tushiradi; chiqishi va kodini qaytaradi (hech qachon otmaydi). */
function run(cmd, cmdArgs, cwd, timeoutMs = 900_000) {
  return new Promise((resolve) => {
    const p = spawn(cmd, cmdArgs, { cwd, shell: process.platform === 'win32' });
    let out = '';
    const take = (d) => { out += d.toString(); if (out.length > 400_000) out = out.slice(-200_000); };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    const timer = setTimeout(() => { p.kill(); resolve({ code: -1, out: out + '\n[vaqt tugadi]' }); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e.message) }); });
  });
}

// Tarmoq bir marta uzilib qolsa — butun tekshiruv qizil bo'lmasin. Bitta qayta
// urinish beriladi (haqiqiy nosozlik ikkinchi marta ham takrorlanadi, shuning
// uchun bu xatoni yashirmaydi).
const UA = { 'User-Agent': 'QurilishERP selfcheck' };

async function once(url, ms) {
  return fetch(url, { signal: AbortSignal.timeout(ms), headers: UA });
}

async function withRetry(url, ms) {
  try {
    return await once(url, ms);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 2000));
    return once(url, ms);
  }
}

async function getJson(url, ms = 20_000) {
  const r = await withRetry(url, ms);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function status(url, ms = 20_000) {
  return (await withRetry(url, ms)).status;
}

/** Testlar natijasini vitest chiqishidan o'qiydi ("Tests  34 passed"). */
function testsSummary(out) {
  const m = /Tests\s+(?:\x1b\[[0-9;]*m)*(.*?)(?:\n|$)/.exec(out.replace(/\x1b\[[0-9;]*m/g, ''));
  const line = m ? m[1].trim() : '';
  const failed = /\bfailed\b/.test(line);
  return { line, failed };
}

// ═══════════════════════════ 1. KOD ═══════════════════════════

async function codeChecks() {
  head('1. Kod: yig\'iladimi va testlar o\'tadimi');

  await check('kod', 'backend TypeScript xatosiz', async () => {
    if (QUICK) return { skip: true };
    const r = await run('npx', ['tsc', '--noEmit'], BACKEND);
    if (r.code !== 0) return { ok: false, note: r.out.split('\n').filter(Boolean).slice(0, 3).join(' | ') };
    return true;
  });

  await check('kod', 'frontend yig\'iladi (vite build)', async () => {
    if (QUICK) return { skip: true };
    const r = await run('npx', ['vite', 'build'], FRONTEND);
    if (r.code !== 0) return { ok: false, note: r.out.split('\n').filter((l) => /error/i.test(l)).slice(0, 3).join(' | ') };
    return true;
  });

  // Yangi funksiyalarning testlari ALOHIDA — qaysi biri yiqilganini darhol ko'rish uchun
  const SUITES = [
    ['brigada reytingi (xizmat)', ['src/services/brigades.test.ts']],
    ['brigada reytingi (integratsion: firmalararo izolyatsiya)', ['src/routes/brigades.int.test.ts']],
    ['narx indeksi (mediana, birlik, kalit)', ['src/services/marketPrice.test.ts']],
    ['narx manbasi: Telegram kanallari', ['src/services/priceChannels.test.ts']],
    ['narx manbasi: OLX tahlilchisi', ['src/services/priceOlx.test.ts']],
    ['ob-havo xavflari', ['src/services/weatherAlerts.test.ts']],
  ];
  for (const [label, files] of SUITES) {
    await check('kod', `test — ${label}`, async () => {
      if (QUICK) return { skip: true };
      for (const f of files) if (!existsSync(join(BACKEND, f))) return { ok: false, note: `fayl yo'q: ${f}` };
      const r = await run('npx', ['vitest', 'run', ...files], BACKEND);
      const s = testsSummary(r.out);
      if (r.code !== 0 || s.failed) return { ok: false, note: s.line || 'test yiqildi' };
      return { note: s.line };
    });
  }

  await check('kod', 'frontend testlari (hammasi)', async () => {
    if (QUICK) return { skip: true };
    const r = await run('npx', ['vitest', 'run'], FRONTEND);
    const s = testsSummary(r.out);
    if (r.code !== 0 || s.failed) return { ok: false, note: s.line || 'test yiqildi' };
    return { note: s.line };
  });
}

// ═══════════════════════ 2. XAVFSIZLIK QOIDALARI ═══════════════════════

async function invariantChecks() {
  head('2. Xavfsizlik va loyiha qoidalari');

  await check('qoida', 'brigada ma\'lumotnomasi scoped() bilan cheklanmagan, baho esa firma doirasida', () => {
    const src = readFileSync(join(BACKEND, 'src/routes/brigades.ts'), 'utf8');
    if (/\bscoped\s*\(/.test(src)) return { ok: false, note: "ma'lumotnoma scoped() bilan cheklangan — boshqa firmalar reytingi ko'rinmay qoladi" };
    // Yozish va tasdiqlash doimo companyId bilan izlanishi SHART
    const writes = ['findOneAndUpdate', 'reviews/:id/approve', 'reviews/:id/reject'];
    if (!/companyId: company/.test(src)) return { ok: false, note: 'sharh yozishda companyId qo\'yilmagan' };
    if ((src.match(/companyId: company/g) || []).length < 2) return { ok: false, note: 'tasdiqlash/rad etishda firma tekshiruvi yetarli emas' };
    return { note: `yozish yo'llari firma doirasida (${writes.length} ta joy)` };
  });

  await check('qoida', 'baho faqat tasdiqdan keyin reytingga qo\'shiladi', () => {
    const svc = readFileSync(join(BACKEND, 'src/services/brigades.ts'), 'utf8');
    if (!/status: 'approved'/.test(svc)) return { ok: false, note: "recomputeBrigade tasdiqlanganlardan boshqasini ham sanayapti" };
    const rt = readFileSync(join(BACKEND, 'src/routes/brigades.ts'), 'utf8');
    if (!/status: 'pending' as const/.test(rt)) return { ok: false, note: "yangi baho darhol 'pending' bo'lmayapti" };
    return true;
  });

  await check('qoida', 'manba havolasi majburiy va tekshiriladigan ko\'rinishda', () => {
    const svc = readFileSync(join(BACKEND, 'src/services/brigades.ts'), 'utf8');
    if (!/validSourceUrl/.test(svc)) return { ok: false, note: 'havola tekshiruvi yo\'q' };
    const rt = readFileSync(join(BACKEND, 'src/routes/brigades.ts'), 'utf8');
    if (!/validSourceUrl\(sourceUrl\)/.test(rt)) return { ok: false, note: 'yo\'lda havola tekshirilmayapti' };
    return true;
  });

  await check('qoida', 'kelishuv summasi SERVERDA hisoblanadi', () => {
    const rt = readFileSync(join(BACKEND, 'src/routes/brigades.ts'), 'utf8');
    if (/agreedTotal: Number\(req\.body/.test(rt) || /payable: Number\(req\.body/.test(rt)) {
      return { ok: false, note: 'jami summa klientdan olinayapti — ishonib bo\'lmaydi' };
    }
    if (!/dealTotals\(/.test(rt)) return { ok: false, note: 'dealTotals ishlatilmayapti' };
    return true;
  });

  await check('qoida', 'brauzer dialoglari ishlatilmaydi (Tauri\'da ishlamaydi)', async () => {
    if (QUICK) {
      const bad = [];
      const walk = (d) => {
        for (const n of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, n.name);
          if (n.isDirectory()) walk(p);
          else if (/\.tsx?$/.test(n.name) && !/\.test\./.test(n.name)
            && /\bwindow\.(confirm|alert|prompt)\s*\(/.test(readFileSync(p, 'utf8'))) bad.push(n.name);
        }
      };
      walk(join(FRONTEND, 'src/app'));
      return bad.length ? { ok: false, note: bad.join(', ') } : true;
    }
    const r = await run('npx', ['vitest', 'run', 'src/app/lib/noNativeDialogs.test.ts'], FRONTEND);
    return r.code === 0 || { ok: false, note: 'taqiqlangan dialog topildi' };
  });

  await check('qoida', 'narx indeksida maxfiylik chegaralari saqlangan', () => {
    const src = readFileSync(join(BACKEND, 'src/services/marketPrice.ts'), 'utf8');
    const pts = /MIN_POINTS\s*=\s*(\d+)/.exec(src);
    const firms = /MIN_COMPANIES\s*=\s*(\d+)/.exec(src);
    if (!pts || !firms) return { ok: false, note: 'chegaralar topilmadi' };
    if (Number(firms[1]) < 2) return { ok: false, note: 'bitta firma narxi oshkor bo\'lib qolishi mumkin' };
    return { note: `kamida ${pts[1]} kuzatuv, ${firms[1]} firma` };
  });
}

// ═══════════════════════ 3. JONLI TIZIM ═══════════════════════

async function liveChecks() {
  head('3. Jonli tizim (production)');

  let started = '';
  await check('jonli', 'backend javob beradi va bazaga ulangan', async () => {
    const h = await getJson(`${API}/health`);
    started = h.serverStartedAt || '';
    if (!h.ok) return { ok: false, note: 'health ok:false' };
    if (h.db !== 1) return { ok: false, note: `baza ulanmagan (db=${h.db})` };
    return { note: `ishga tushgan: ${started}` };
  });

  await check('jonli', 'brigada yo\'li ulangan va himoyalangan', async () => {
    const s = await status(`${API}/api/brigades`);
    if (s === 404) return { ok: false, note: 'yo\'l serverga ulanmagan (404)' };
    if (s !== 401) return { ok: false, note: `kutilgan 401, keldi ${s}` };
    return { note: '401 — token talab qiladi (to\'g\'ri)' };
  });

  await check('jonli', 'bozor narxi yo\'li ulangan va himoyalangan', async () => {
    const s = await status(`${API}/api/market-price?q=sement`);
    if (s === 404) return { ok: false, note: 'yo\'l ulanmagan (404)' };
    if (s !== 401) return { ok: false, note: `kutilgan 401, keldi ${s}` };
    return { note: '401 — token talab qiladi (to\'g\'ri)' };
  });

  // Hash tengligini talab qilmaydi: CI o'zi yig'sa, AYNI koddan ham boshqa hash
  // chiqadi va tekshiruv bekorga qizil bo'ladi. Shuning uchun FUNKSIONAL
  // tekshiriladi — jonli bundle ichida oxirgi funksiyalarning belgisi bormi.
  await check('jonli', 'saytdagi bundle oxirgi funksiyalarni o\'z ichiga oladi', async () => {
    const live = await withRetry(SITE, 20_000).then((r) => r.text());
    const asset = /index-[A-Za-z0-9_-]+\.js/.exec(live)?.[0];
    if (!asset) return { ok: false, note: 'asset nomi topilmadi' };
    const js = await withRetry(`${SITE}/assets/${asset}`, 30_000).then((r) => r.text());
    const MARKERS = [['Brigadalar', 'brigada reytingi'], ['Bozor narxi', 'narx qidiruvi']];
    const missing = MARKERS.filter(([m]) => !js.includes(m)).map(([, label]) => label);
    if (missing.length) return { ok: false, note: `jonli saytda yo'q: ${missing.join(', ')} — deploy kerak` };
    const localFile = join(FRONTEND, 'dist/index.html');
    const want = existsSync(localFile) ? /index-[A-Za-z0-9_-]+\.js/.exec(readFileSync(localFile, 'utf8'))?.[0] : null;
    return { note: `${asset}${want && want !== asset ? ` · lokal yig'ilma boshqa (${want}) — CI o'zi yig'adi, zarar yo'q` : ''}` };
  });

  await check('jonli', 'ilova (APK/EXE) relizi joyida', async () => {
    const d = await getJson(`${API}/api/deploy/latest`);
    if (!d.available) return { ok: false, note: 'reliz yo\'q' };
    for (const k of ['apkUrl', 'exeUrl']) if (!d[k]) return { ok: false, note: `${k} yo'q` };
    return { note: `versiya ${d.version}` };
  }, { soft: true });

  // Sayt yangilansa ham ILOVA eski qolib ketishi mumkin (APK/EXE alohida
  // yig'iladi). Shuni aniq ko'rsatamiz: reliz versiyasidagi commit HEAD'dan
  // necha commit orqada.
  await check('jonli', 'ilova relizi oxirgi kod bilan', async () => {
    const d = await getJson(`${API}/api/deploy/latest`).catch(() => null);
    const sha = /-([0-9a-f]{7,40})$/.exec(String(d?.version || ''))?.[1];
    if (!sha) return { skip: true, note: 'reliz versiyasida commit yo‘q' };
    const r = await run('git', ['rev-list', '--count', `${sha}..HEAD`], ROOT, 30_000);
    const behind = Number(String(r.out).trim());
    if (r.code !== 0 || !Number.isFinite(behind)) return { skip: true, note: 'commit topilmadi (reliz boshqa tarmoqdanmi?)' };
    if (behind > 0) return { ok: false, note: `ilova ${behind} commit orqada (reliz ${sha}) — APK/EXE qayta yig'ilishi kerak` };
    return { note: `reliz HEAD bilan bir xil (${sha})` };
  }, { soft: true });
}

// ═══════════════════════ 4. TASHQI MANBALAR ═══════════════════════

async function sourceChecks() {
  head('4. Tashqi manbalar (narx va ob-havo tirikmi)');

  // DIQQAT: OLX avtomatik so'rovlarni bloklashi mumkin (403). Bunday holatda
  // brauzer niqobi ostida o'tishga URINILMAYDI — bu saytning bot tekshiruvini
  // chetlab o'tish bo'ladi. Yig'uvchi 403 da jim bo'sh qaytaradi, ya'ni tizim
  // buzilmaydi; shunchaki shu manba yopiq va buni ogohlantirish qilib ko'rsatamiz.
  await check('manba', 'OLX ochiq ro\'yxati javob beradi va narx maydoni joyida', async () => {
    const st = await status('https://www.olx.uz/api/v1/offers/?limit=3&query=sement', 25_000).catch(() => 0);
    if (st === 403 || st === 429) {
      return { ok: false, note: `OLX avtomatik so'rovlarni bloklayapti (HTTP ${st}) — bu manba hozir ishlamaydi` };
    }
    const d = await getJson('https://www.olx.uz/api/v1/offers/?offset=0&limit=10&query=sement', 25_000);
    const rows = Array.isArray(d?.data) ? d.data : [];
    if (!rows.length) return { ok: false, note: 'e\'lon kelmadi — OLX tuzilmasi o\'zgargan yoki bloklangan' };
    const withPrice = rows.filter((o) => (o.params || []).some((p) => p?.key === 'price')).length;
    if (!withPrice) return { ok: false, note: 'narx maydoni yo\'q — tuzilma o\'zgargan' };
    return { note: `${rows.length} e'lon, ${withPrice} tasida narx maydoni` };
  }, { soft: true });

  await check('manba', 'Telegram ochiq sahifasi o\'qiladi (akkauntsiz)', async () => {
    const r = await withRetry('https://t.me/s/durov', 20_000);
    if (!r.ok) return { ok: false, note: `HTTP ${r.status}` };
    const html = await r.text();
    if (!/tgme_widget_message/.test(html)) return { ok: false, note: 'sahifa tuzilmasi o\'zgargan' };
    return { note: 'o\'qildi' };
  }, { soft: true });

  await check('manba', 'ob-havo prognozi keladi (ertangi kun)', async () => {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=41.300&longitude=69.240'
      + '&daily=temperature_2m_min,temperature_2m_max,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_speed_10m_max'
      + '&timezone=Asia%2FTashkent&forecast_days=2';
    const d = await getJson(url, 20_000);
    const t = d?.daily?.time;
    if (!Array.isArray(t) || t.length < 2) return { ok: false, note: 'ertangi kun yo\'q' };
    return { note: `ertaga ${t[1]}: ${d.daily.temperature_2m_min[1]}…${d.daily.temperature_2m_max[1]}°C` };
  }, { soft: true });
}

// ═══════════════════════ XULOSA ═══════════════════════

function summary() {
  const n = (s) => results.filter((r) => r.state === s).length;
  head('Xulosa');
  const groups = [...new Set(results.map((r) => r.group))];
  for (const g of groups) {
    const rs = results.filter((r) => r.group === g);
    const bad = rs.filter((r) => r.state === 'fail').length;
    const warn = rs.filter((r) => r.state === 'warn').length;
    const done = rs.filter((r) => r.state === 'pass').length;
    const total = rs.filter((r) => r.state !== 'skip').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '░');
    process.stdout.write(`  ${g.padEnd(7)} ${bar} ${String(pct).padStart(3)}%  ${done}/${total}`
      + `${bad ? `${C.bad} · ${bad} xato${C.off}` : ''}${warn ? `${C.warn} · ${warn} ogohlantirish${C.off}` : ''}\n`);
  }
  const fails = results.filter((r) => r.state === 'fail');
  if (fails.length) {
    process.stdout.write(`\n  ${C.bad}Tuzatish kerak:${C.off}\n`);
    for (const f of fails) process.stdout.write(`   • ${f.name}${f.note ? ` — ${f.note}` : ''}\n`);
  }
  const warns = results.filter((r) => r.state === 'warn');
  if (warns.length) {
    process.stdout.write(`\n  ${C.warn}Ogohlantirish (tashqi sabab bo'lishi mumkin):${C.off}\n`);
    for (const f of warns) process.stdout.write(`   • ${f.name}${f.note ? ` — ${f.note}` : ''}\n`);
  }
  process.stdout.write(`\n  Jami: ${n('pass')} o'tdi · ${n('fail')} xato · ${n('warn')} ogohlantirish · ${n('skip')} o'tkazildi\n\n`);
  return fails.length === 0;
}

const t0 = Date.now();
if (!QUICK) await codeChecks(); else { head('1. Kod'); process.stdout.write(`  ${C.dim}--quick: yig'ish va testlar o'tkazib yuborildi${C.off}\n`); }
await invariantChecks();
if (!LOCAL_ONLY) { await liveChecks(); await sourceChecks(); }
else process.stdout.write(`\n  ${C.dim}--local: jonli tekshiruvlar o'tkazib yuborildi${C.off}\n`);
const ok = summary();
process.stdout.write(`${C.dim}  (${Math.round((Date.now() - t0) / 1000)} s)${C.off}\n`);
process.exit(ok ? 0 : 1);
