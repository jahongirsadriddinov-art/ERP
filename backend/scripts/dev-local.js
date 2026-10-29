// Lokal sinov uchun backend (owner 2026-10-29: "manga ham test qilishim uchun localhost qilip ber").
//
// MongoDB O'RNATISH SHART EMAS: baza shu jarayonning XOTIRASIDA ko'tariladi
// (mongodb-memory-server — loyihada testlar uchun allaqachon bor). Server to'xtaganda
// ma'lumot ham o'chadi — aynan sinov uchun kerak bo'lgan narsa.
//
// Jonli bazaga va jonli saytga HECH QANDAY ta'siri yo'q.
//
// Ishga tushirish:  cd backend && npm run dev:local
// MONGODB_URI oldindan berilgan bo'lsa — o'sha ishlatiladi (xotira bazasi ko'tarilmaydi).

const { spawn } = require('child_process');
const path = require('path');

async function main() {
  let uri = process.env.MONGODB_URI;
  let mem = null;

  if (!uri || /127\.0\.0\.1|localhost/.test(uri)) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    process.stdout.write('Xotiradagi MongoDB ko\'tarilmoqda (birinchi marta bir necha daqiqa olishi mumkin)...\n');
    mem = await MongoMemoryServer.create();
    uri = mem.getUri('erp_firma_local');
    process.stdout.write('Baza tayyor (xotirada, server to\'xtasa o\'chadi).\n');
  } else {
    process.stdout.write('DIQQAT: MONGODB_URI tashqi bazaga ishora qilyapti — xotira bazasi ishlatilmadi.\n');
  }

  // Windows'da .cmd ni to'g'ridan-to'g'ri spawn qilish EINVAL beradi (Node 20+ xavfsizlik
  // o'zgarishi) — shuning uchun ts-node'ni Node orqali bevosita ishga tushiramiz.
  const tsNode = require.resolve('ts-node/dist/bin.js', { paths: [path.join(__dirname, '..')] });
  const child = spawn(
    process.execPath,
    [tsNode, path.join(__dirname, '..', 'src', 'index.ts')],
    {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        MONGODB_URI: uri,
        NODE_ENV: 'development',
        // XAVFSIZLIK: lokal server JONLI Telegram botini ishga tushirmasin. Bitta bot
        // tokeni bilan ikki joyda polling qilinsa, xabarlar ikkiga bo'linadi va JONLI
        // bot ishdan chiqadi (foydalanuvchilar javob olmay qoladi). Shuning uchun
        // bot va AI Telegram akkauntlari lokalda O'CHIQ.
        // Ataylab yoqish kerak bo'lsa: set DEV_ENABLE_BOT=1
        ...(process.env.DEV_ENABLE_BOT === '1' ? {} : { TELEGRAM_BOT_TOKEN: '', AIV_WORKER_PUBKEY: '' }),
      },
    },
  );

  const stop = async () => {
    child.kill();
    if (mem) await mem.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => { if (mem) mem.stop().catch(() => undefined); process.exit(code || 0); });
}

main().catch((e) => {
  console.error('dev-local ishga tushmadi:', e?.message || e);
  process.exit(1);
});
