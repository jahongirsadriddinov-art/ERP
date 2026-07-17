import { AsyncLocalStorage } from 'async_hooks';

// Har bir so'rov (request) uchun tenant konteksti. JWT dan olingan companyId
// shu yerda saqlanadi, keyin route'lar va Mongoose hook'lari uni o'qiydi —
// companyId'ni HECH QACHON frontend body/query'dan olmaymiz, faqat JWT'dan.
export interface TenantContext {
  userId: string;
  role: string;
  companyId?: string;
  isOwner?: boolean;
  branchId?: string;
  isDeveloper?: boolean; // super-admin (dasturchi) — barcha firmalarni ko'radi, tenant filtri o'chadi
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

// Joriy so'rovning tenant kontekstini qaytaradi (bo'lmasa undefined).
export function getTenant(): TenantContext | undefined {
  return tenantStorage.getStore();
}

// Joriy so'rovning companyId sini qaytaradi.
export function currentCompanyId(): string | undefined {
  return tenantStorage.getStore()?.companyId;
}

// Berilgan kontekstda funksiyani ishga tushiradi.
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStorage.run(ctx, fn);
}
