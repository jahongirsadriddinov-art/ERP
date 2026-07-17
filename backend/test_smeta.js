const path = require('path');
// load env
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function main() {
  const { parseSmeta } = require('./dist/services/smetaParser');
  const pdfPath = 'C:/Users/jahon/Downloads/Telegram Desktop/Смета Олмалик сервис.pdf';
  try {
    const results = await parseSmeta(pdfPath, 'application/pdf', (msg, pct) => {
      console.log(`[${pct}%] ${msg}`);
    });
    console.log('JAMI:', results.length, 'ta qator');
    results.slice(0, 15).forEach((r, i) => console.log(`${i+1}.`, JSON.stringify(r)));
  } catch(e) {
    console.error('XATO:', e.message);
  }
}
main();
