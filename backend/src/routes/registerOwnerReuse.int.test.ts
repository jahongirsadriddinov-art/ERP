// Owner 2026-10-26: "akkaunt nomeri almashgan, lekin hali ham qolib ketgan" — eski, FIRMASIZ qolgan egalik yozuvi
// (firma o'chirilgan yoki eski xato qurboni) yangi firma ochishni to'sib qo'yardi. Endi u tozalanadi; tirik firma
// egasi bo'lsa — baribir to'siladi (bitta akkaunt = bitta firma).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('../services/email', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('../services/telegramIdentity', () => ({ linkTelegram: vi.fn(async () => undefined), onPhoneChanged: vi.fn(async () => undefined) }));

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Company from '../models/Company';

let mongo: MongoMemoryServer;
const TG = 778899001;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 180_000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await User.deleteMany({}); await Company.deleteMany({}); });

/** routes/register.ts dagi tekshiruvning aynan o'zi (shu yerda yagona manba sifatida sinaladi). */
async function ownerGuard(telegramUserId: number | string): Promise<{ blocked: boolean; name?: string }> {
  // Modelda telegramUserId — STRING (Telegram son beradi, biz satr saqlaymiz).
  // Sonni to'g'ridan-to'g'ri so'rovga qo'yish turni buzardi.
  const owners = await User.find({ telegramUserId: String(telegramUserId), isOwner: true });
  for (const prev of owners) {
    const live = prev.companyId ? await Company.findById(prev.companyId).select('_id name').lean().catch(() => null) : null;
    if (live) return { blocked: true, name: (live as any).name };
    await User.updateOne({ _id: prev._id }, { $unset: { telegramUserId: 1, telegramChatId: 1 } });
  }
  return { blocked: false };
}

describe('ro\'yxatdan o\'tish — eski egalik yozuvi', () => {
  it("firmasi yo'q (o'chirilgan) eski egalik to'smaydi va bog'lanish tozalanadi", async () => {
    const u = await User.create({ firstName: 'Eski', phone: '+998900960890', role: 'direktor', isOwner: true, telegramUserId: TG, telegramChatId: '555' } as any);
    const r = await ownerGuard(TG);
    expect(r.blocked).toBe(false);
    const after: any = await User.findById(u._id).lean();
    expect(after.telegramUserId).toBeUndefined();
    expect(after.telegramChatId).toBeUndefined();
  });

  it('tirik firma egasi bo\'lsa — to\'siladi va firma nomi aytiladi', async () => {
    const c = await Company.create({ name: 'Jondor Iris Stroy', phone: '+998945440102', branchId: 'B-001' } as any);
    await User.create({ firstName: 'Ega', phone: '+998945440102', role: 'direktor', isOwner: true, telegramUserId: TG, companyId: String(c._id) } as any);
    const r = await ownerGuard(TG);
    expect(r).toEqual({ blocked: true, name: 'Jondor Iris Stroy' });
  });
});
