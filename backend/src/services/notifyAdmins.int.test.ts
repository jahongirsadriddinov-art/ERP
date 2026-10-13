// notifyAdmins firma izolyatsiyasi: xabar FAQAT shu firmaning direktor/o'rinbosarlariga ketadi.
// Haqiqiy MongoDB (xotirada); Telegram yuborish soxta funksiya bilan almashtiriladi.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import { sendToCompanyAdmins } from './botSecurity';

let mongo: MongoMemoryServer;
const A = new mongoose.Types.ObjectId().toString();
const B = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await User.create([
    { firstName: 'A-direktor', phone: '+998900000101', role: 'direktor', companyId: A, telegramChatId: '1001' },
    { firstName: 'A-orinbosar', phone: '+998900000102', role: 'orinbosar', companyId: A, telegramChatId: '1002' },
    { firstName: 'A-ishchi', phone: '+998900000103', role: 'ishchi', companyId: A, telegramChatId: '1003' },
    { firstName: 'A-direktor-botsiz', phone: '+998900000104', role: 'direktor', companyId: A },
    { firstName: 'B-direktor', phone: '+998900000201', role: 'direktor', companyId: B, telegramChatId: '2001' },
    { firstName: 'B-orinbosar', phone: '+998900000202', role: 'orinbosar', companyId: B, telegramChatId: '2002' },
  ] as any[]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('sendToCompanyAdmins (notifyAdmins yadrosi)', () => {
  it("faqat A firmaning rahbarlariga yuboriladi, B'ga hech narsa ketmaydi", async () => {
    const send = vi.fn().mockResolvedValue({});
    const n = await sendToCompanyAdmins(send, A, "💰 *Yangi to'lov so'rovi*");
    const chats = send.mock.calls.map(c => c[0]).sort();
    expect(chats).toEqual(['1001', '1002']);
    expect(n).toBe(2);
    expect(send.mock.calls[0][2]).toMatchObject({ parse_mode: 'Markdown' });
  });

  it('B firma uchun — faqat B rahbarlari', async () => {
    const send = vi.fn().mockResolvedValue({});
    await sendToCompanyAdmins(send, B, 'x', [[{ text: 'ok', callback_data: 'noop' }]]);
    expect(send.mock.calls.map(c => c[0]).sort()).toEqual(['2001', '2002']);
    expect(send.mock.calls[0][2].reply_markup).toEqual({ inline_keyboard: [[{ text: 'ok', callback_data: 'noop' }]] });
  });

  it("companyId bo'sh bo'lsa — hech kimga yuborilmaydi (barcha firmalarga emas!)", async () => {
    const send = vi.fn().mockResolvedValue({});
    expect(await sendToCompanyAdmins(send, '', 'x')).toBe(0);
    expect(await sendToCompanyAdmins(send, undefined as any, 'x')).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('bitta yuborish xatosi qolganlarini to\'xtatmaydi', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValue({});
    const n = await sendToCompanyAdmins(send, A, 'x');
    expect(send).toHaveBeenCalledTimes(2);
    expect(n).toBe(1);
    err.mockRestore();
  });
});
