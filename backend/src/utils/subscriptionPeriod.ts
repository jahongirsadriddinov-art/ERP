// Obuna muddatini UZAYTIRISH (qolgan kunlarga qo'shish) formulasi —
// /:id/renew va Roxiy webhook (ikkalasi ham "mavjud obunani davom ettirish")
// ishlatadi, shu sabab bitta joyga chiqarilgan (avval ikkalasida alohida
// nusxalangan edi). /:id/approve BILAN QASDDAN baham ko'rilmaydi — u yangi/
// birinchi tasdiqlash bo'lgani uchun muddatni "hozir"dan boshlab hisoblaydi.
export function extendPeriodEnd(currentPeriodEnd: Date | null | undefined, days: number, now: Date = new Date()): Date {
  const base = (currentPeriodEnd && currentPeriodEnd > now) ? currentPeriodEnd : now;
  return new Date(base.getTime() + days * 86400000);
}
