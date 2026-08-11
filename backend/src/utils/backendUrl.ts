// Backend'ning o'z ochiq (public) manzilini aniqlaydi — yuklangan fayllarga
// (rasm/video/ovoz) TO'LIQ, mutlaq URL berish uchun kerak. Agar bu joyda
// nisbiy ("/uploads/xxx") yoki noto'g'ri manzil (masalan localhost) qaytarilsa,
// o'sha URL saqlanib qoladigan barcha joyda (chat media, kompaniya logotipi
// va h.k.) — web, Windows (.exe/Tauri), Android (.apk/Capacitor) — rasm/fayl
// UMUMAN ochilmay qoladi, chunki har bir platforma boshqa origin'dan yuklaydi
// (erp-firma.uz / tauri.localhost / localhost) va nisbiy yo'l ULARNING O'Z
// origin'iga nisbatan hisoblanadi — backend'nikiga emas.
//
// Ustuvorlik:
//  1) RENDER_EXTERNAL_URL — Render avtomatik o'rnatadi (qo'lda sozlash shart
//     emas, hech qachon eskirmaydi/xato yozilmaydi).
//  2) BACKEND_URL — qo'lda sozlanadigan zaxira (Render'dan boshqa hostingda
//     ishlatilsa).
//  3) http://localhost:PORT — FAQAT mahalliy devda, ikkalasi ham yo'q bo'lsa.
export function getBackendUrl(): string {
  const url = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  return url.replace(/\/$/, '');
}
