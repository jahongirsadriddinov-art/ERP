// Lokal sinov uchun backend (owner 2026-10-29: "manga ham test qilishim uchun localhost qilip ber").
//
// MongoDB O'RNATISH SHART EMAS: baza shu jarayonning XOTIRASIDA ko'tariladi
// (mongodb-memory-server loyihada testlar uchun allaqachon bor). Server to'xtaganda
// ma'lumot ham o'chadi — aynan sinov uchun kerak bo'lgan narsa.
//
// TELEGRAM: jonli bot tokeni bilan ishga tushirish TAQIQLANGAN. Bitta token bilan ikki
// joyda polling qilinsa, kelgan xabarlar ikkiga bo'linadi va JONLI bot ishdan chiqadi —
// foydalanuvchilar javob olmay qoladi. Shuning uchun ALOHIDA SINOV BOTI kerak
// (owner taklifi): @BotFather -> /newbot -> token -> backend/.env.local.
//
// Ishga tushirish:  cd backend && npm run dev:local

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const NL = String.fromCharCode(10);

/** backend/.env.local — faqat LOKAL sinov qiymatlari (.gitignore'da, git'ga tushmaydi). */
function readEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(NL)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function needTestBot() {
  const lines = [
    '',
    '  Lokal sinov uchun ALOHIDA Telegram bot kerak.',
    '',
    "  Nega: jonli bot tokeni bilan ishga tushirilsa, kelgan xabarlar ikkiga bo'linadi",
    '  va JONLI bot ishdan chiqadi - foydalanuvchilaringiz javob olmay qoladi.',
    '',
    '  1) Telegramda @BotFather -> /newbot -> nom bering (masalan: QurilishERP Test)',
    '  2) Bergan tokenini backend/.env.local fayliga yozing:',
    '',
    '       TELEGRAM_BOT_TOKEN=8123456789:AA...',
    '       BOT_USERNAME=qurilish_erp_test_bot',
    '',
    '  3) Qaytadan ishga tushiring: npm run dev:local',
    '',
  ];
  process.stderr.write(lines.join(NL));
  process.exit(1);
}

/** Port bandmi — band bo'lsa tushunarli xabar berib to'xtaymiz (EADDRINUSE stack emas).
 *  ULANIB ko'riladi, bog'lanib emas: server IPv6 (:::5000) da tursa, 0.0.0.0 ga bog'lanish
 *  Windows'da muvaffaqiyatli bo'lib, bandlikni SEZMAY qolardi (owner sinovida shunday bo'ldi). */
function portBusy(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (busy) => { sock.destroy(); resolve(busy); };
    sock.setTimeout(700);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

async function main() {
  const local = readEnvLocal();

  const port = Number(local.PORT || process.env.PORT || 5000);
  if (await portBusy(port)) {
    process.stderr.write([
      '',
      '  ' + port + '-port band - backend ishga tusha olmaydi.',
      '',
      '  Sabab: oldingi sinov serveri hali ishlayapti.',
      '  Yechim: oldingi oynada Ctrl+C bosing, yoki:',
      '',
      '      npx kill-port ' + port,
      '',
    ].join(NL));
    process.exit(1);
  }

  const token = local.TELEGRAM_BOT_TOKEN;
  if (!token || token === process.env.TELEGRAM_BOT_TOKEN) needTestBot();

  let uri = local.MONGODB_URI || process.env.MONGODB_URI;
  let mem = null;

  if (!uri || /127\.0\.0\.1|localhost/.test(uri)) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    process.stdout.write("Xotiradagi MongoDB ko'tarilmoqda (birinchi marta bir necha daqiqa olishi mumkin)..." + NL);
    mem = await MongoMemoryServer.create();
    uri = mem.getUri('erp_firma_local');
    process.stdout.write("Baza tayyor (xotirada, server to'xtasa o'chadi)." + NL);
  }
  const uname = String(local.BOT_USERNAME || '?').replace(/^@+/, '');
  process.stdout.write('Sinov boti: @' + uname + ' (jonli botga tegilmaydi).' + NL);

  // Windows'da .cmd ni to'g'ridan-to'g'ri spawn qilish EINVAL beradi (Node 20+ xavfsizlik
  // o'zgarishi) - shuning uchun ts-node'ni Node orqali bevosita ishga tushiramiz.
  const tsNode = require.resolve('ts-node/dist/bin.js', { paths: [path.join(__dirname, '..')] });
  const child = spawn(process.execPath, [tsNode, path.join(__dirname, '..', 'src', 'index.ts')], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      ...local,                 // .env.local jonli .env ustidan yozadi (sinov boti shu yerda)
      MONGODB_URI: uri,
      NODE_ENV: 'development',
      DEV_SEED: '1',            // bo'sh bazaga sinov firmasi va narxlar qo'yiladi
      AIV_WORKER_PUBKEY: '',    // AI qo'ng'iroq worker'i lokalda kerak emas
    },
  });

  const stop = async () => {
    child.kill();
    if (mem) await mem.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => {
    if (mem) mem.stop().catch(() => undefined);
    process.exit(code || 0);
  });
}

main().catch((e) => {
  process.stderr.write('dev-local ishga tushmadi: ' + (e && e.message ? e.message : String(e)) + NL);
  process.exit(1);
});
