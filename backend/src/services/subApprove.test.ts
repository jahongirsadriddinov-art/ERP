// sub_approve_/sub_reject_ tugmalari: obunani faqat dasturchi tasdiqlay/rad eta oladi.
import { describe, it, expect } from 'vitest';
import { canDecideSubscription } from './botSecurity';

describe('canDecideSubscription', () => {
  it('faqat dasturchi', () => {
    expect(canDecideSubscription({ role: 'dasturchi' }, 1, '')).toBe(true);
    for (const role of ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi', '', undefined, null]) {
      expect(canDecideSubscription({ role } as any, 555, '')).toBe(false);
      expect(canDecideSubscription({ role } as any, 555, '777')).toBe(false); // boshqa chat
    }
  });

  it('foydalanuvchi topilmasa (botga ulanmagan chat) — rad', () => {
    expect(canDecideSubscription(null, 555, '')).toBe(false);
    expect(canDecideSubscription(undefined, 555, '777')).toBe(false);
    expect(canDecideSubscription(null, null, '777')).toBe(false);
  });

  it('DEVELOPER_CHAT_ID chati (tugmalar aynan shu yerga yuboriladi) — hisob bogʻlanmagan boʻlsa ham ruxsat', () => {
    expect(canDecideSubscription(null, 777, '777')).toBe(true);
    expect(canDecideSubscription({ role: 'ishchi' }, '-100123', '-100123')).toBe(true);
    expect(canDecideSubscription(null, 777, undefined)).toBe(false);
  });
});
