import { describe, it, expect, vi, beforeEach } from 'vitest';

const notifyDeveloper = vi.fn(async (_message: string) => undefined);
vi.mock('./bot', () => ({ notifyDeveloper, bot: { sendMessage: vi.fn(async () => undefined) } }));
vi.mock('../models/Company', () => ({ default: { findById: () => ({ select: () => ({ lean: () => ({ catch: async () => ({ name: 'Alfa Qurilish', branchId: 'BR-0001', phone: '+998901112233', region: 'Toshkent' }) }) }) }) } }));
vi.mock('../models/Subscription', () => ({ default: { findOne: () => ({ sort: () => ({ select: () => ({ lean: () => ({ catch: async () => ({ status: 'expired', selectedPlan: 'pro', currentPeriodEnd: new Date('2026-10-01') }) }) }) }) }) } }));
vi.mock('../models/User', () => ({ default: { findById: () => ({ select: () => ({ lean: () => ({ catch: async () => ({ firstName: 'Jahongir', lastName: 'S', phone: '+998901112233', role: 'direktor' }) }) }) }) } }));
vi.mock('../config/plans', () => ({ PLAN_CONFIG: { pro: { label: 'Pro', amount: 1_200_000 } } }));

import { requestAdminHelp } from './adminHelpRequest';

let n = 0;
const company = () => `firma-${++n}`;

beforeEach(() => notifyDeveloper.mockClear());

describe('requestAdminHelp', () => {
  it("dasturchiga firma, tarif va bog'lanish ma'lumotlari bilan xabar yuboradi", async () => {
    const r = await requestAdminHelp({ companyId: company(), userId: 'u1', source: 'web' });
    expect(r.ok).toBe(true);
    const msg = String(notifyDeveloper.mock.calls[0][0]);
    for (const part of ['Alfa Qurilish', 'BR-0001', 'Jahongir', '+998901112233', 'Pro', 'expired']) {
      expect(msg).toContain(part);
    }
  });

  it('manbani (sayt/bot) xabarda ko\u2018rsatadi', async () => {
    await requestAdminHelp({ companyId: company(), userId: 'u1', source: 'bot' });
    expect(String(notifyDeveloper.mock.calls[0][0])).toContain('Telegram bot');
  });

  it("takror bosilsa xabar qayta yuborilmaydi (admin ko'milib qolmasin)", async () => {
    const c = company();
    expect((await requestAdminHelp({ companyId: c, userId: 'u1', source: 'web' })).ok).toBe(true);
    const again = await requestAdminHelp({ companyId: c, userId: 'u1', source: 'web' });
    expect(again.ok).toBe(false);
    expect(again.throttled).toBe(true);
    expect(again.retryAfterSec).toBeGreaterThan(0);
    expect(notifyDeveloper).toHaveBeenCalledTimes(1);
  });

  it("firma aniqlanmasa xabar yubormaydi", async () => {
    const r = await requestAdminHelp({ companyId: '', userId: 'u1', source: 'web' });
    expect(r.ok).toBe(false);
    expect(notifyDeveloper).not.toHaveBeenCalled();
  });
});
