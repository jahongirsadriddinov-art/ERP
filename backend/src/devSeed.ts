import Company from './models/Company';
import User from './models/User';
import ObjectModel from './models/Object';
import Transaction from './models/Transaction';
import Otp from './models/Otp';
import { hashPassword } from './utils/tokens';
import { recordPoint } from './services/marketPrice';

// Lokal sinov uchun ma'lumot (owner 2026-10-29: lokal bazada "foydalanuvchi topilmadi"
// chiqdi — baza xotirada yangi ko'tariladi, ya'ni mutlaqo bo'sh).
//
// FAQAT lokal sinovda ishlaydi: NODE_ENV=development VA DEV_SEED=1 bo'lgandagina.
// Ikkala shart ham scripts/dev-local.js tomonidan qo'yiladi; prodda hech qachon
// bu qiymatlar bo'lmaydi, shuning uchun bu kod u yerda umuman ishga tushmaydi.
//
// Yaratiladi: firma, direktor, ikkita obyekt (koordinatasi bilan — ob-havo uchun)
// va bir nechta material xaridi (narx razvedkasi ishlashi uchun — bo'sh indeksda
// "ma'lumot yetarli emas" chiqadi va funksiyani sinab bo'lmaydi).

const PHONE = (process.env.DEV_SEED_PHONE || '+998901112233').trim();
const CODE = '1111';

/** Bir xil material uchun turli firmalardan kelgan narxlar — mediana shundan chiqadi. */
const PRICES: { name: string; unit: string; prices: number[] }[] = [
  { name: 'Sement M400', unit: 'qop', prices: [50000, 51000, 52000, 52000, 53000, 54000] },
  { name: "G'isht M100", unit: 'dona', prices: [1150, 1200, 1200, 1250, 1300] },
  { name: 'Armatura 12mm', unit: 't', prices: [9200000, 9400000, 9500000, 9600000] },
  { name: "Shag'al", unit: 'm3', prices: [170000, 175000, 180000, 185000] },
];

export async function seedDevData(): Promise<void> {
  if (process.env.NODE_ENV !== 'development' || process.env.DEV_SEED !== '1') return;
  if (await Company.countDocuments()) return;   // allaqachon bor — takror yaratmaymiz

  const company: any = await Company.create({
    name: 'Sinov Qurilish MChJ', branchId: 'BR-LOCAL-0001', region: 'Toshkent', phone: PHONE, status: 'ACTIVE',
  });
  const companyId = String(company._id);

  // telegramChatId SHART: "Kodni olish" tugmasi Telegramga bog'lanmagan foydalanuvchini
  // rad etadi. Lokal sinovda kod baribir bazadan olinadi (pastda), lekin shu maydon
  // bo'lmasa UI birinchi qadamdayoq to'xtab qoladi. Dasturchi chat id'si bor bo'lsa
  // o'shani qo'yamiz — shunda kod sinov botidan haqiqatan ham keladi.
  const director: any = await User.create({
    firstName: 'Sinov', lastName: 'Direktor', phone: PHONE, role: 'direktor',
    companyId, isOwner: true, language: 'uz',
    telegramChatId: String(process.env.DEVELOPER_CHAT_ID || '1'),
    phoneVerifiedAt: new Date(),
  });

  // Toshkent koordinatalari — ob-havo ogohlantirishi shu nuqtadan prognoz oladi
  const objects: any[] = await ObjectModel.insertMany([
    { name: 'Olmazor turar-joy', location: 'Toshkent, Olmazor', lat: 41.345, lng: 69.203, companyId, status: 'active', budget: 4_500_000_000 },
    { name: 'Chilonzor ofis', location: 'Toshkent, Chilonzor', lat: 41.275, lng: 69.204, companyId, status: 'active', budget: 1_800_000_000 },
  ]);

  // Narx razvedkasi uchun: har narx AYRIM firma nomidan (indeks kamida 2 ta
  // turli firma bo'lmasa xulosa bermaydi — shuning uchun soxta firma id'lari).
  let n = 0;
  for (const item of PRICES) {
    for (const [i, price] of item.prices.entries()) {
      await Transaction.create({
        type: 'material', materialName: item.name, unit: item.unit, price,
        quantity: 10, amount: price * 10, companyId, status: 'confirmed',
        projectId: String(objects[i % objects.length]._id),
        fromUserId: String(director._id), date: new Date().toISOString().slice(0, 10),
      });
      await recordPoint({
        name: item.name, unit: item.unit, price, source: 'receipt',
        companyId: `seed-firma-${i % 4}`, refId: `seed:${item.name}:${i}`,
      });
      n++;
    }
  }

  // Telegramsiz kirish: kod oldindan bazaga qo'yiladi (haqiqiy kodlar ham shu yerda
  // hash bo'lib saqlanadi — hech qanday "orqa eshik" qo'shilmagan, faqat ma'lumot).
  await Otp.create({
    phone: PHONE, otpHash: await hashPassword(CODE), attempts: 0,
    expiresAt: new Date(Date.now() + 365 * 24 * 3600_000),
  });

  const line = '─'.repeat(54);
  console.log(`\n${line}\n  LOKAL SINOV MA'LUMOTI TAYYOR`
    + `\n\n  Kirish:     ${PHONE}`
    + `\n  Kod:        ${CODE}   (Telegram shart emas)`
    + `\n\n  Firma:      ${company.name}`
    + `\n  Obyektlar:  ${objects.length} ta (koordinatasi bilan — ob-havo uchun)`
    + `\n  Narxlar:    ${n} ta xarid (bozor narxi qidiruvi uchun)`
    + `\n${line}\n`);
}
