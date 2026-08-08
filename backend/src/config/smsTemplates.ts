// SMS matn shablonlari — markazlashtirilgan, shu yerda o'zgartiriladi.
// Eskiz TEST rejimida faqat ularning o'zi belgilagan qat'iy matnlarga ruxsat
// beradi (eskizService shu ro'yxatdan foydalanadi, ESKIZ_TEST_MODE=true bo'lsa).
export const ESKIZ_TEST_MESSAGES = [
  'Это тест от Eskiz',
  'Bu Eskiz dan test',
  'This is test from Eskiz',
] as const;

// Production'da haqiqiy foydalanuvchiga yuboriladigan matn.
export function otpSmsText(code: string): string {
  return `ERP-FIRMA.UZ ga kirish uchun tasdiqlash kodingiz: ${code}. Ushbu kodni hech kimga bermang.`;
}
