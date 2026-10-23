// ─── Standart avatarlar manifesti (owner 2026-10-23) ───────────────────────────────────────────────
// Rasmi yo'q har bir foydalanuvchiga shu ro'yxatdan AVTOMATIK, barqaror (user id'dan deterministik, ism-familiyaga
// qarab jinsga mos) "memoji" yuz tushadi — components/UserAvatar.tsx. Foydalanuvchi qo'lda tanlamaydi; yagona
// tanlov — o'z profil rasmini yuklash. To'plam almashtirilsa: fayllarni public/avatars/ ga tashlab, shu ro'yxatni
// (va NOTICE.txt'ni) yangilash kifoya.
//
// Joriy to'plam: Microsoft Fluent Emoji 3D (MIT) — faqat bosh ustun bo'lgan odamlar, 5 xil teri rangi.
// Manba fayllar va litsenziya: public/avatars/NOTICE.txt.

export type AvatarGender = "m" | "f" | "n";

/** Bosh doirani to'ldirishi uchun rasmni kattalashtirish (memoji uslubi): zoom — masshtab, y — markaz
 *  balandligi (% rasm tepasidan). Faqat yelkasi/tanasi ko'rinadigan (bust) rasmlar uchun; yuz hech qachon kesilmaydi. */
export interface AvatarFit { zoom: number; y: number }

export interface AvatarMeta {
  /** Barqaror id (fayl nomi bilan bir xil) */
  id: string;
  /** public/ ga nisbatan yo'l */
  file: string;
  gender: AvatarGender;
  fit?: AvatarFit;
}

// Kaska + jilet — bosh rasmning yuqori ~45%ida (kaska+yuz markazi ~34%)
const WORKER: AvatarFit = { zoom: 1.3, y: 34 };
// Ro'mol — bosh+ro'mol yuqori ~70%da (markazi ~38%)
const SCARF: AvatarFit = { zoom: 1.3, y: 38 };

// TARTIB MUHIM: standart tanlov hash % ro'yxat uzunligi bo'yicha — tartib o'zgarsa avtomatik yuzlar ham o'zgaradi.
export const AVATARS: AvatarMeta[] = [
  { id: "man-bald-dark", file: "/avatars/man-bald-dark.webp", gender: "m" },
  { id: "man-bald-light", file: "/avatars/man-bald-light.webp", gender: "m" },
  { id: "man-bald-medium", file: "/avatars/man-bald-medium.webp", gender: "m" },
  { id: "man-bald-medium-light", file: "/avatars/man-bald-medium-light.webp", gender: "m" },
  { id: "man-beard-dark", file: "/avatars/man-beard-dark.webp", gender: "m" },
  { id: "man-beard-medium", file: "/avatars/man-beard-medium.webp", gender: "m" },
  { id: "man-beard-medium-dark", file: "/avatars/man-beard-medium-dark.webp", gender: "m" },
  { id: "man-beard-medium-light", file: "/avatars/man-beard-medium-light.webp", gender: "m" },
  { id: "man-blonde-hair-light", file: "/avatars/man-blonde-hair-light.webp", gender: "m" },
  { id: "man-blonde-hair-medium-light", file: "/avatars/man-blonde-hair-medium-light.webp", gender: "m" },
  { id: "man-construction-worker-dark", file: "/avatars/man-construction-worker-dark.webp", gender: "m", fit: WORKER },
  { id: "man-construction-worker-light", file: "/avatars/man-construction-worker-light.webp", gender: "m", fit: WORKER },
  { id: "man-construction-worker-medium", file: "/avatars/man-construction-worker-medium.webp", gender: "m", fit: WORKER },
  { id: "man-curly-hair-dark", file: "/avatars/man-curly-hair-dark.webp", gender: "m" },
  { id: "man-curly-hair-light", file: "/avatars/man-curly-hair-light.webp", gender: "m" },
  { id: "man-curly-hair-medium", file: "/avatars/man-curly-hair-medium.webp", gender: "m" },
  { id: "man-curly-hair-medium-dark", file: "/avatars/man-curly-hair-medium-dark.webp", gender: "m" },
  { id: "man-dark", file: "/avatars/man-dark.webp", gender: "m" },
  { id: "man-light", file: "/avatars/man-light.webp", gender: "m" },
  { id: "man-medium", file: "/avatars/man-medium.webp", gender: "m" },
  { id: "man-medium-dark", file: "/avatars/man-medium-dark.webp", gender: "m" },
  { id: "man-medium-light", file: "/avatars/man-medium-light.webp", gender: "m" },
  { id: "man-red-hair-light", file: "/avatars/man-red-hair-light.webp", gender: "m" },
  { id: "man-red-hair-medium-light", file: "/avatars/man-red-hair-medium-light.webp", gender: "m" },
  { id: "man-white-hair-light", file: "/avatars/man-white-hair-light.webp", gender: "m" },
  { id: "man-white-hair-medium", file: "/avatars/man-white-hair-medium.webp", gender: "m" },
  { id: "man-white-hair-medium-dark", file: "/avatars/man-white-hair-medium-dark.webp", gender: "m" },
  { id: "old-man-dark", file: "/avatars/old-man-dark.webp", gender: "m" },
  { id: "old-man-light", file: "/avatars/old-man-light.webp", gender: "m" },
  { id: "old-man-medium", file: "/avatars/old-man-medium.webp", gender: "m" },
  { id: "person-wearing-turban-medium", file: "/avatars/person-wearing-turban-medium.webp", gender: "m" },
  { id: "person-wearing-turban-medium-light", file: "/avatars/person-wearing-turban-medium-light.webp", gender: "m" },
  { id: "old-woman-dark", file: "/avatars/old-woman-dark.webp", gender: "f" },
  { id: "old-woman-light", file: "/avatars/old-woman-light.webp", gender: "f" },
  { id: "old-woman-medium", file: "/avatars/old-woman-medium.webp", gender: "f" },
  { id: "woman-blonde-hair-light", file: "/avatars/woman-blonde-hair-light.webp", gender: "f" },
  { id: "woman-blonde-hair-medium-light", file: "/avatars/woman-blonde-hair-medium-light.webp", gender: "f" },
  { id: "woman-construction-worker-light", file: "/avatars/woman-construction-worker-light.webp", gender: "f", fit: WORKER },
  { id: "woman-construction-worker-medium", file: "/avatars/woman-construction-worker-medium.webp", gender: "f", fit: WORKER },
  { id: "woman-curly-hair-dark", file: "/avatars/woman-curly-hair-dark.webp", gender: "f" },
  { id: "woman-curly-hair-medium", file: "/avatars/woman-curly-hair-medium.webp", gender: "f" },
  { id: "woman-curly-hair-medium-light", file: "/avatars/woman-curly-hair-medium-light.webp", gender: "f" },
  { id: "woman-dark", file: "/avatars/woman-dark.webp", gender: "f" },
  { id: "woman-light", file: "/avatars/woman-light.webp", gender: "f" },
  { id: "woman-medium", file: "/avatars/woman-medium.webp", gender: "f" },
  { id: "woman-medium-dark", file: "/avatars/woman-medium-dark.webp", gender: "f" },
  { id: "woman-medium-light", file: "/avatars/woman-medium-light.webp", gender: "f" },
  { id: "woman-red-hair-light", file: "/avatars/woman-red-hair-light.webp", gender: "f" },
  { id: "woman-red-hair-medium-light", file: "/avatars/woman-red-hair-medium-light.webp", gender: "f" },
  { id: "woman-white-hair-light", file: "/avatars/woman-white-hair-light.webp", gender: "f" },
  { id: "woman-white-hair-medium", file: "/avatars/woman-white-hair-medium.webp", gender: "f" },
  { id: "woman-with-headscarf-light", file: "/avatars/woman-with-headscarf-light.webp", gender: "f", fit: SCARF },
  { id: "woman-with-headscarf-medium", file: "/avatars/woman-with-headscarf-medium.webp", gender: "f", fit: SCARF },
  { id: "woman-with-headscarf-medium-dark", file: "/avatars/woman-with-headscarf-medium-dark.webp", gender: "f", fit: SCARF },
  { id: "woman-with-headscarf-medium-light", file: "/avatars/woman-with-headscarf-medium-light.webp", gender: "f", fit: SCARF },
  { id: "construction-worker-medium", file: "/avatars/construction-worker-medium.webp", gender: "n", fit: WORKER },
  { id: "older-person-dark", file: "/avatars/older-person-dark.webp", gender: "n" },
  { id: "older-person-medium-light", file: "/avatars/older-person-medium-light.webp", gender: "n" },
  { id: "person-light", file: "/avatars/person-light.webp", gender: "n" },
  { id: "person-medium-dark", file: "/avatars/person-medium-dark.webp", gender: "n" },
];
