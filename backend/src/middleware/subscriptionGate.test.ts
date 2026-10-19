import { describe, it, expect, vi, beforeEach } from 'vitest';

let doc: any = null;
let gen = 0;
vi.mock('../models/Subscription', () => ({
  default: { findOne: () => ({ sort: () => ({ select: () => ({ lean: async () => doc }) }) }) },
  subscriptionChangeGen: () => gen,
}));

import { subscriptionBlockOf, subscriptionGateApplies } from './subscriptionGate';

// Obuna tugagan firmaning ochiq sessiyasi ham to'xtashi kerak (audit #27) — login'dagi qoida bilan bir xil.
describe('subscriptionBlockOf', () => {
  beforeEach(() => { gen++; }); // har test — yangi kesh avlodi

  it('blocks an active subscription whose period has ended', async () => {
    doc = { status: 'active', currentPeriodEnd: new Date(Date.now() - 1000) };
    expect(await subscriptionBlockOf('c1')).toBe('expired');
  });

  it('blocks pending / expired / rejected', async () => {
    for (const status of ['pending', 'expired', 'rejected'] as const) {
      gen++;
      doc = { status };
      expect(await subscriptionBlockOf('c1')).toBe(status);
    }
  });

  it('lets active, trialing and missing subscriptions through', async () => {
    doc = { status: 'active', currentPeriodEnd: new Date(Date.now() + 86_400_000) };
    expect(await subscriptionBlockOf('c1')).toBeNull();
    gen++; doc = { status: 'trialing' };
    expect(await subscriptionBlockOf('c1')).toBeNull();
    gen++; doc = null;
    expect(await subscriptionBlockOf('c1')).toBeNull();
  });

  it('re-reads after the subscription changes (approval takes effect at once)', async () => {
    doc = { status: 'expired' };
    expect(await subscriptionBlockOf('c2')).toBe('expired');
    doc = { status: 'active', currentPeriodEnd: new Date(Date.now() + 86_400_000) };
    expect(await subscriptionBlockOf('c2')).toBe('expired'); // kesh
    gen++;
    expect(await subscriptionBlockOf('c2')).toBeNull();
  });
});

describe('subscriptionGateApplies', () => {
  const req = (url: string) => ({ originalUrl: url }) as any;
  it('keeps login, subscription and payment routes open', () => {
    for (const u of ['/api/auth/me', '/api/admin/subscriptions/my', '/api/admin/subscriptions/pay', '/api/plans', '/api/sessions']) {
      expect(subscriptionGateApplies(req(u))).toBe(false);
    }
  });
  it('gates business data', () => {
    for (const u of ['/api/transactions', '/api/objects?x=1', '/api/ai/chat', '/api/messages']) {
      expect(subscriptionGateApplies(req(u))).toBe(true);
    }
  });
});
