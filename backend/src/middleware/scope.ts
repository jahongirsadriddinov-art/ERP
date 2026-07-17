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
export function scoped<T extends Record<string, any>>(filter: T = {} as T): T {
  if (getTenant()?.isDeveloper) return filter;
  const cid = currentCompanyId();
  if (cid) return { ...filter, companyId: cid };
  return filter;
}

// Yaratilayotgan hujjatga companyId muhrlaydi (kontekst mavjud bo'lsa).
// companyId HECH QACHON frontend body'dan olinmaydi — faqat JWT konteksti'dan.
export function stamped<T extends Record<string, any>>(doc: T): T {
  const cid = currentCompanyId();
  if (cid) return { ...doc, companyId: cid };
  return doc;
}
