import { currentCompanyId, getTenant } from './tenantContext';

/**
 * TENANT SCOPING YORDAMCHILARI.
 *
 * Muhim xavfsizlik xususiyati: bu funksiyalar faqat JOriy so'rovda tenant
 * konteksti (companyId) MAVJUD bo'lsagina ta'sir qiladi. Kontekst bo'lmasa
 * (masalan eski, token yubormaydigan klient yoki companyId'siz eski JWT),
 * ular hech narsa qo'shmaydi — eski xatti-harakat to'liq saqlanadi.
 * Shu tufayli izolyatsiyani bosqichma-bosqich, hech narsani buzmasdan yoqamiz.
 */

// Mongoose find/update filtriga companyId qo'shadi (kontekst mavjud bo'lsa).
// DASTURCHI (super-admin) uchun filtr QO'SHILMAYDI — u barcha firmalarni ko'radi.
//
// Izolyatsiya qat'iy:
//  • dasturchi                → filtr yo'q (hammasini ko'radi)
//  • companyId bor            → faqat o'z firmasi
//  • autentifikatsiya bor,    → faqat LEGACY (companyId'siz, null) pool —
//    lekin companyId yo'q       boshqa firmalarning ma'lumoti KO'RINMAYDI
//  • autentifikatsiyasiz      → filtr yo'q (eski token yubormaydigan klient)
export function scoped<T extends Record<string, any>>(filter: T = {} as T): T {
  const t = getTenant();
  if (t?.isDeveloper) return filter;
  const cid = t?.companyId;
  if (cid) return { ...filter, companyId: cid };
  if (t) return { ...filter, companyId: null as any }; // legacy user → faqat null-company
  return filter;
}

// Yaratilayotgan hujjatga companyId muhrlaydi (kontekst mavjud bo'lsa).
// companyId HECH QACHON frontend body'dan olinmaydi — faqat JWT konteksti'dan.
export function stamped<T extends Record<string, any>>(doc: T): T {
  const cid = currentCompanyId();
  if (cid) return { ...doc, companyId: cid };
  return doc;
}
