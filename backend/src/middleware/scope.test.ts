import { describe, it, expect } from 'vitest';
import { scoped, stamped } from './scope';
import { runWithTenant, TenantContext } from './tenantContext';

// Bu — butun multi-tenant tizimning ASOSIY xavfsizlik chegarasi: har bir
// firma-ichki so'rov shu ikki funksiyadan o'tadi. Bu yerdagi regressiya
// firmalararo ma'lumot sizib chiqishiga olib keladi (aynan shu turdagi
// xatolar bu loyihada bir necha marta topilgan va tuzatilgan — index.ts,
// materials.ts, objects.ts izohlariga qarang). DB kerak emas — faqat
// AsyncLocalStorage konteksti bilan ishlaydi.

const ctx = (over: Partial<TenantContext> = {}): TenantContext => ({
  userId: 'u1', role: 'ishchi', companyId: 'company-A', ...over,
});

describe('scoped()', () => {
  it('adds companyId filter when tenant has one', () => {
    const result = runWithTenant(ctx(), () => scoped({ foo: 'bar' }));
    expect(result).toEqual({ foo: 'bar', companyId: 'company-A' });
  });

  it('does NOT let a caller override companyId via the input filter', () => {
    // Xavfsizlik: hatto chaqiruvchi companyId'ni o'zi qo'ygan bo'lsa ham,
    // JORIY tenant konteksti UNI QAYTA YOZISHI kerak — aks holda boshqa
    // firmaning ma'lumotini so'rash mumkin bo'lib qolardi.
    const result = runWithTenant(ctx({ companyId: 'company-A' }), () =>
      scoped({ companyId: 'company-B-attacker-supplied' })
    );
    expect(result.companyId).toBe('company-A');
  });

  it('developer (super-admin) sees everything — no filter added', () => {
    const result = runWithTenant(ctx({ isDeveloper: true, companyId: undefined }), () => scoped({ foo: 'bar' }));
    expect(result).toEqual({ foo: 'bar' });
  });

  it('legacy user (no companyId) is restricted to the null-company pool, not unfiltered', () => {
    const result = runWithTenant(ctx({ companyId: undefined }), () => scoped({ foo: 'bar' }));
    expect(result).toEqual({ foo: 'bar', companyId: null });
  });

  it('with no tenant context at all, filter passes through unchanged', () => {
    // optionalAuth orqali kelgan, hech qanday tokensiz so'rov uchun eski
    // xatti-harakat (bosqichma-bosqich joriy qilish) — lekin bu FAQAT
    // requireAuth talab qilinmaydigan ochiq yo'llarda amal qiladi.
    expect(scoped({ foo: 'bar' })).toEqual({ foo: 'bar' });
  });

  it('does not mutate the original filter object', () => {
    const original = { foo: 'bar' };
    runWithTenant(ctx(), () => scoped(original));
    expect(original).toEqual({ foo: 'bar' }); // companyId not added to original
  });
});

describe('stamped()', () => {
  it('stamps the current tenant companyId onto a new document', () => {
    const doc = runWithTenant(ctx(), () => stamped({ name: 'test' }));
    expect(doc).toEqual({ name: 'test', companyId: 'company-A' });
  });

  it('ignores any companyId the caller tries to set directly (JWT context wins)', () => {
    const doc = runWithTenant(ctx({ companyId: 'company-A' }), () =>
      stamped({ name: 'test', companyId: 'company-B-attacker-supplied' } as any)
    );
    expect(doc.companyId).toBe('company-A');
  });

  it('does nothing when there is no tenant context', () => {
    expect(stamped({ name: 'test' })).toEqual({ name: 'test' });
  });
});
