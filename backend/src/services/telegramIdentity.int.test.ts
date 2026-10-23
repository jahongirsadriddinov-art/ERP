// Integratsion sinov: telefon/Telegram almashganda eski identifikator unutiladi (owner 2026-10-23).
// "Raqamimni o'zgartirdim, yangi Telegram'dan /start bosdim — bot tanidi, lekin eski Telegram hamon tanilyapti,
// AI qo'ng'iroqlari eski akkauntga ketadi, yangi raqamdan qo'ng'iroq qilsam AI 'noma'lum' deydi."
// Yo'llar: rahbar tahriri / profil (PUT /api/auth/users/:id), AI amali (update_user), botda raqam ulashish
// (/start → kontakt → linkTelegram), bir Telegram'ni boshqa xodimga ko'chirish.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(), sendPhoto: vi.fn(), sendDocument: vi.fn() }, notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn(), kickUser: vi.fn() }));
vi.mock('../services/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Company from '../models/Company';
import Subscription from '../models/Subscription';
import AiEmployeeContact from '../models/AiEmployeeContact';
import { requireAuth, optionalAuth, JWT_SECRET } from '../middleware/auth';
import { setBotInstance } from '../aiVoice/bot/instance';
import { findEmployeeByTgId, ensureContactTgUserId } from '../aiVoice/telegram/tgLink';
import { linkTelegram, onPhoneChanged } from './telegramIdentity';
import authRoutes from '../routes/auth';
import aiRoutes from '../routes/ai';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/auth', optionalAuth, authRoutes);
app.use('/api/ai', requireAuth, aiRoutes);

const sent: { chatId: string; text: string; opts: any }[] = [];
const fakeBot = {
  sendMessage: vi.fn(async (chatId: number | string, text: string, opts?: any) => { sent.push({ chatId: String(chatId), text, opts }); return {}; }),
  answerCallbackQuery: vi.fn(async () => ({})),
};

const ids: Record<string, string> = {};
let A = '';
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const fresh = async (k: string) => (await User.findById(ids[k]).lean()) as any;
const contactTg = async (k: string) => ((await AiEmployeeContact.findOne({ employeeId: ids[k] }).lean()) as any)?.telegram?.tgUserId;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  setBotInstance(fakeBot as any);
  const c: any = await Company.create({ branchId: 'TG-1', name: 'Telegram Qurilish', phone: '+998901000001' } as any);
  A = String(c._id);
  await Subscription.create({ companyId: A, selectedPlan: 'custom', customFeatures: ['ai_assistant'], status: 'active' } as any);
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create({ companyId: A, ...d }))._id); };
  // Ega o'zini ro'yxatdan o'tkazgan: telegramUserId ham yozilgan (AI uni chat id'dan ustun qo'yadi)
  await mk('owner', { firstName: 'Ega', phone: '+998901000001', role: 'direktor', isOwner: true, telegramChatId: '1001', telegramUserId: '1001' });
  await mk('orin', { firstName: 'Orin', phone: '+998901000002', role: 'orinbosar', telegramChatId: '1002' });
  await mk('ish', { firstName: 'Ishchi', phone: '+998901000003', role: 'ishchi', telegramChatId: '1003' });
  await mk('ish2', { firstName: 'Ishchi2', phone: '+998901000004', role: 'ishchi' });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(() => { sent.length = 0; });

describe("telefon o'zgarishi — eski Telegram unutiladi", () => {
  it("ega profilidan raqamini o'zgartiradi → bot chati, Telegram id, AI kontakti tozalanadi; eski chatga xabar (klaviaturasiz)", async () => {
    await ensureContactTgUserId(A, ids.owner);
    expect(await contactTg('owner')).toBe('1001');
    expect(await findEmployeeByTgId('1001')).toEqual({ companyId: A, employeeId: ids.owner });

    const r = await request(app).put(`/api/auth/users/${ids.owner}`).set('Authorization', tok('owner'))
      .send({ firstName: 'Ega', lastName: '', phone: '+998907777777', role: 'direktor' });
    expect(r.status).toBe(200);

    const u = await fresh('owner');
    expect(u.phone).toBe('+998907777777');
    expect(u.telegramChatId).toBeUndefined();
    expect(u.telegramUserId).toBeUndefined();
    expect(await contactTg('owner')).toBeUndefined();
    // AI eski Telegram'ni endi tanimaydi (kiruvchi qo'ng'iroq / AI akkaunt DM)
    expect(await findEmployeeByTgId('1001')).toBeNull();
    // AI chiquvchi qo'ng'iroq uchun ham id yo'q (eski akkauntga ketmaydi)
    expect(await ensureContactTgUserId(A, ids.owner)).toBeUndefined();
    // Eski chatga qisqa xabar, klaviatura olib tashlanadi
    const msg = sent.find((m) => m.chatId === '1001');
    expect(msg?.text).toMatch(/raqami o'zgardi/);
    expect(msg?.opts?.reply_markup?.remove_keyboard).toBe(true);
    // Firma egasining raqami firma kartasida ham yangilanadi
    expect(((await Company.findById(A).lean()) as any).phone).toBe('+998907777777');
  });

  it("yangi Telegram'dan /start + raqam ulashish → bot ham, AI ham faqat yangi akkauntni taniydi", async () => {
    await linkTelegram(ids.owner, '2001', '2001');
    const u = await fresh('owner');
    expect(u.telegramChatId).toBe('2001');
    expect(u.telegramUserId).toBe('2001');
    expect(await contactTg('owner')).toBe('2001');
    expect(await findEmployeeByTgId('2001')).toEqual({ companyId: A, employeeId: ids.owner });
    expect(await findEmployeeByTgId('1001')).toBeNull();
    expect(await User.countDocuments({ telegramChatId: '1001' })).toBe(0);
  });

  it("raqam o'zgarmasdan yangi Telegram'ga ulansa ham (eski chat bor) — eski chat uziladi va xabar oladi", async () => {
    // telegramUserId eski qolgan holat (avvalgi xato): chat yangilanib, user id eskisi qolardi
    await User.updateOne({ _id: ids.ish }, { $set: { telegramChatId: '3001', telegramUserId: '3001' } });
    await ensureContactTgUserId(A, ids.ish);
    expect(await contactTg('ish')).toBe('3001');
    await linkTelegram(ids.ish, '3002', '3002');
    const u = await fresh('ish');
    expect([u.telegramChatId, u.telegramUserId]).toEqual(['3002', '3002']);
    expect(await contactTg('ish')).toBe('3002');
    expect(await findEmployeeByTgId('3001')).toBeNull();
    expect(await findEmployeeByTgId('3002')).toEqual({ companyId: A, employeeId: ids.ish });
    const msg = sent.find((m) => m.chatId === '3001');
    expect(msg?.opts?.reply_markup?.remove_keyboard).toBe(true);
  });

  it("bir Telegram boshqa xodimga qayta ulansa — avvalgisidan toza ko'chadi (chat, user id, AI kontakti)", async () => {
    // ish2 ning telefonida ish ning Telegram'i edi: endi u o'z raqamini ulashdi
    await linkTelegram(ids.ish2, '3002', '3002');
    const a = await fresh('ish');
    const b = await fresh('ish2');
    expect(a.telegramChatId).toBeUndefined();
    expect(a.telegramUserId).toBeUndefined();
    expect(await contactTg('ish')).toBeUndefined();
    expect([b.telegramChatId, b.telegramUserId]).toEqual(['3002', '3002']);
    expect(await contactTg('ish2')).toBe('3002');
    expect(await findEmployeeByTgId('3002')).toEqual({ companyId: A, employeeId: ids.ish2 });
    // Bitta Telegram — bitta xodim
    expect(await User.countDocuments({ $or: [{ telegramChatId: '3002' }, { telegramUserId: '3002' }] })).toBe(1);
  });

  it("rahbar xodim raqamini o'zgartiradi (PUT) va band raqamga o'zgartirib bo'lmaydi", async () => {
    await linkTelegram(ids.ish, '4001', '4001');
    expect((await request(app).put(`/api/auth/users/${ids.ish}`).set('Authorization', tok('orin')).send({ phone: '+998901000004' })).status).toBe(400);
    expect((await fresh('ish')).telegramChatId).toBe('4001');
    const r = await request(app).put(`/api/auth/users/${ids.ish}`).set('Authorization', tok('orin')).send({ phone: '+998905555555' });
    expect(r.status).toBe(200);
    const u = await fresh('ish');
    expect(u.telegramChatId).toBeUndefined();
    expect(await findEmployeeByTgId('4001')).toBeNull();
    expect(sent.some((m) => m.chatId === '4001')).toBe(true);
    // Raqam o'zgarmasa (faqat ism) — Telegram tegilmaydi
    await linkTelegram(ids.ish, '4002', '4002');
    sent.length = 0;
    expect((await request(app).put(`/api/auth/users/${ids.ish}`).set('Authorization', tok('orin')).send({ firstName: 'Ishchi', phone: '+998905555555' })).status).toBe(200);
    expect((await fresh('ish')).telegramChatId).toBe('4002');
    expect(sent).toHaveLength(0);
  });

  it("AI amali (update_user) bilan raqam o'zgarsa ham eski Telegram unutiladi", async () => {
    const r = await request(app).post('/api/ai/execute').set('Authorization', tok('orin'))
      .send({ action: { type: 'update_user', userId: ids.ish, changes: { phone: '+998906666666' } } });
    expect(r.status).toBe(200);
    const u = await fresh('ish');
    expect(u.phone).toBe('+998906666666');
    expect(u.telegramChatId).toBeUndefined();
    expect(await findEmployeeByTgId('4002')).toBeNull();
  });

  it("onPhoneChanged — Telegram'i yo'q xodimda xatosiz ishlaydi", async () => {
    await expect(onPhoneChanged(ids.ish, '+998906666666', '+998906666667')).resolves.toBeUndefined();
    await expect(onPhoneChanged(new mongoose.Types.ObjectId().toString())).resolves.toBeUndefined();
  });
});
