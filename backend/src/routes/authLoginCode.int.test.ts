// Kirish kodi xavfsizligi: kriptografik 4 xonali kod (owner 2026-10-28: "yana 4 xonaga o'zgartir"),
// himoya kod uzunligida emas — urinishlar cheklovida. Bazada faqat
// xeshi, 5 ta noto'g'ri urinishdan keyin kod bekor bo'ladi; to'g'ri kod bir marta ishlaydi.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const sent: string[] = [];
vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async (_id: any, text: string) => { sent.push(text); }) } }));
vi.mock('../services/eskizService', () => ({ sendOtpSms: vi.fn(async () => ({ ok: true })) }));
vi.mock('../services/sessions', () => ({ issueTokenWithSession: vi.fn(async () => 'TOKEN') }));

import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import authRoutes from './auth';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
const PHONE = '+998901112233';
const codeFromBot = () => (/<code>(\d+)<\/code>/.exec(sent[sent.length - 1]) || [])[1];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await User.create({ firstName: 'Ali', phone: PHONE, role: 'direktor', isOwner: true, telegramChatId: '555', companyId: new mongoose.Types.ObjectId().toString() });
}, 120_000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

describe('Telegram kirish kodi', () => {
  it("4 xonali, bazada ochiq saqlanmaydi; 5 noto'g'ri urinishdan keyin bekor; to'g'ri kod bir marta", async () => {
    const r = await request(app).post('/api/auth/send-code').send({ phone: PHONE });
    expect(r.status).toBe(200);
    expect(r.body.codeLength).toBe(4);
    const code = codeFromBot();
    expect(code).toMatch(/^\d{4}$/);
    const u: any = await User.findOne({ phone: PHONE }).lean();
    expect(u.telegramVerificationCode).not.toBe(code);
    expect(u.telegramVerificationCode).toMatch(/^[a-f0-9]{64}$/);

    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 1; i <= 4; i++) {
      const w = await request(app).post('/api/auth/login').send({ phone: PHONE, code: wrong });
      expect(w.status).toBe(400);
      expect(w.body.error).toContain(`${5 - i} ta urinish qoldi`);
    }
    const last = await request(app).post('/api/auth/login').send({ phone: PHONE, code: wrong });
    expect(last.body.error).toMatch(/Urinishlar tugadi/);
    // to'g'ri kod ham endi ishlamaydi — kod bekor qilingan
    expect((await request(app).post('/api/auth/login').send({ phone: PHONE, code })).status).toBe(400);
  });

  it("to'g'ri kod bilan kiradi va kod qayta ishlamaydi", async () => {
    const c = '246810';
    const crypto = await import('crypto');
    const u: any = await User.findOne({ phone: PHONE });
    u.telegramVerificationCode = crypto.createHash('sha256').update(`login:${u._id}:${c}`).digest('hex');
    u.telegramVerificationCodeExpires = new Date(Date.now() + 60_000);
    u.telegramVerificationAttempts = 0;
    await u.save();
    const ok = await request(app).post('/api/auth/login').send({ phone: PHONE, code: c });
    expect(ok.status).toBeLessThan(300);
    expect((await request(app).post('/api/auth/login').send({ phone: PHONE, code: c })).status).toBe(400);
  });
});
