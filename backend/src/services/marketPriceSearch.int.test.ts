// Owner 2026-10-30: "sement" deb qidirdi — hech nima chiqmadi, holbuki
// indeksda "Sement M400" bor edi. Kalit aniq moslik talab qilardi.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import MarketPrice from '../models/MarketPrice';
import { lookupPrice, recordPoint } from './marketPrice';

let mongo: MongoMemoryServer;
const FIRMA_A = 'firma-a';
const FIRMA_B = 'firma-b';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 180_000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await MarketPrice.deleteMany({}); });

const add = async (name: string, price: number, companyId: string, i: number) =>
  recordPoint({ name, unit: 'qop', price, companyId, refId: `${name}:${companyId}:${i}`, source: 'receipt' });

describe('qidiruv', () => {
  it("umumiy so'z bilan aniqroq nomni topadi (sement → Sement M400)", async () => {
    for (const [i, p] of [50000, 52000, 54000].entries()) await add('Sement M400', p, FIRMA_A, i);
    for (const [i, p] of [51000, 53000].entries()) await add('Sement M500', p, FIRMA_B, i + 10);
    const r = await lookupPrice('sement', 'qop');
    expect(r).not.toBeNull();
    expect(r!.points).toBeGreaterThanOrEqual(4);
    expect(r!.median).toBeGreaterThan(49_000);
  });

  it('aniq nom bilan ham ishlaydi', async () => {
    for (const [i, p] of [50000, 52000, 54000, 56000].entries()) await add('Sement M400', p, `f-${i}`, i);
    const r = await lookupPrice('Sement M400', 'qop');
    expect(r?.points).toBe(4);
  });

  it("bog'liq bo'lmagan so'z topilmaydi", async () => {
    for (const [i, p] of [50000, 52000, 54000, 56000].entries()) await add('Sement M400', p, `f-${i}`, i);
    expect(await lookupPrice('armatura', 'qop')).toBeNull();
  });

  it("faqat bitta firma ma'lumoti bo'lsa — O'SHA firmaga ko'rsatiladi, boshqasiga yo'q", async () => {
    for (const [i, p] of [50000, 52000, 54000, 56000].entries()) await add('Qum', p, FIRMA_A, i);
    expect(await lookupPrice('qum', 'qop')).toBeNull();                       // begona
    const own = await lookupPrice('qum', 'qop', { companyId: FIRMA_A });
    expect(own).not.toBeNull();
    expect(own!.ownOnly).toBe(true);
  });
});
