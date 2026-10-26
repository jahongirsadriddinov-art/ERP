import { describe, it, expect } from 'vitest';
import { guideText, guideRoleOf, GUIDE_ROLES } from './guides';

describe('rol qo\'llanmalari', () => {
  it('har bir rol uchun o\'ziga xos matn (uz va ru)', () => {
    const seen = new Set<string>();
    for (const r of GUIDE_ROLES) {
      const uz = guideText(r, 'uz');
      expect(uz.length).toBeGreaterThan(200);
      expect(uz).toContain('<b>');
      expect(seen.has(uz)).toBe(false);
      seen.add(uz);
      expect(guideText(r, 'ru')).not.toBe(uz);
    }
  });

  it('notanish rol — ishchi qo\'llanmasi', () => {
    expect(guideRoleOf('kimdir')).toBe('ishchi');
    expect(guideText(undefined)).toBe(guideText('ishchi'));
  });

  it('prorab qo\'llanmasi chek surati va davomat haqida aytadi', () => {
    const t = guideText('prorab');
    expect(t).toMatch(/chek/i);
    expect(t).toMatch(/davomat/i);
  });
});
