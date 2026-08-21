// O'zbekiston vaqti — doim UTC+5, yozgi vaqtga (DST) o'tish yo'q, shuning
// uchun oddiy soat qo'shish orqali hisoblash yetarli va ishonchli (Intl/ICU
// ma'lumotlar bazasiga bog'liq emas).
//
// MUHIM: bu backend Render'da UTC serverda ishlaydi. `new Date().toISOString()
// .split('T')[0]` orqali "bugungi sana" hisoblash — Toshkent yarim tunidan
// ertalab soat 05:00gacha bo'lgan oraliqda NOTO'G'RI natija beradi (UTC hali
// "kecha"ni ko'rsatadi, Toshkentda esa allaqachon "bugun"). Yo'qlama
// (attendance) kabi kun chegarasiga bog'liq narsalar uchun shu funksiyani
// ishlating, xom `new Date().toISOString()` emas.
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

export function todayInTashkent(): string {
  return new Date(Date.now() + TASHKENT_OFFSET_MS).toISOString().split('T')[0];
}

// Berilgan vaqtning (yo'q bo'lsa — hozirgi) Toshkent bo'yicha SOATI (0-23).
// "Kech qoldi" kabi ish vaqti qoidalari server soatidan (Render — UTC) emas,
// shundan foydalanishi kerak — aks holda "9:00dan keyin kech" degan qoida
// aslida Toshkent bo'yicha soat 14:00gacha hech qachon ishlamas edi.
export function tashkentHour(date: Date = new Date()): number {
  return new Date(date.getTime() + TASHKENT_OFFSET_MS).getUTCHours();
}
