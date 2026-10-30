// Integratsion sinov: brigada reytingi (owner 2026-10-29 qarorlari).
// Asosiy tekshiruvlar:
//  • baho DOIM tasdiqdan o'tadi va tasdiqlanmaguncha reytingga ta'sir qilmaydi;
//  • manba havolasi shart;
//  • BOSHQA FIRMANING sharhini tasdiqlab bo'lmaydi (firmalararo izolyatsiya);
//  • rahbar bo'lmagan xodim tasdiqlay olmaydi;
//  • kelishuv summasi va shtraf serverda hisoblanadi;
//  • boshqa firmaga baho qoldirgan firmaning nomi ko'rinmaydi.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));
// Smena qulfi (requireAuth ichida): smenasi yopiq ishchi yozish amallarini bajarmaydi.
// Bu sinovning mavzusi emas, shuning uchun "smenada" deb qo'yiladi.
vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Brigade from '../models/Brigade';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import brigadeRoutes from './brigades';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/brigades', requireAuth, brigadeRoutes);

const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const A = new mongoose.Types.ObjectId().toString();
const B = new mongoose.Types.ObjectId().toString();
const LINK = 'https://t.me/qurilish_kanal/451';
let brigadeId = '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('dirA', { firstName: 'Direktor', phone: '+998905100001', role: 'direktor', isOwner: true, companyId: A });
  await mk('ishA', { firstName: 'Ishchi', phone: '+998905100002', role: 'ishchi', companyId: A });
  await mk('dirB', { firstName: 'DirektorB', phone: '+998905100003', role: 'direktor', isOwner: true, companyId: B });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('POST /api/brigades', () => {
  it('brigada qo‘shiladi', async () => {
    const r = await request(app).post('/api/brigades').set('Authorization', tok('dirA'))
      .send({ name: 'Olmazor brigadasi', phone: '+998 90 777 11 22', specializations: ['suvoq', 'beton'], region: 'Toshkent' });
    expect(r.status).toBe(201);
    brigadeId = r.body.id;
    expect(brigadeId).toBeTruthy();
  });

  it("bir xil raqam boshqa yozilishda kiritilsa — borini qaytaradi, takror yaratmaydi", async () => {
    const r = await request(app).post('/api/brigades').set('Authorization', tok('dirB'))
      .send({ name: 'Boshqa nom', phone: '907771122' });
    expect(r.status).toBe(200);
    expect(r.body.existed).toBe(true);
    expect(r.body.id).toBe(brigadeId);
    expect(await Brigade.countDocuments()).toBe(1);
  });

  it("nomsiz yoki raqamsiz qo'shib bo'lmaydi", async () => {
    expect((await request(app).post('/api/brigades').set('Authorization', tok('dirA')).send({ phone: '901112233' })).status).toBe(400);
    expect((await request(app).post('/api/brigades').set('Authorization', tok('dirA')).send({ name: 'Brigada' })).status).toBe(400);
  });
});

describe('POST /api/brigades/:id/reviews', () => {
  it('manba havolasisiz baho qabul qilinmaydi', async () => {
    const r = await request(app).post(`/api/brigades/${brigadeId}/reviews`).set('Authorization', tok('ishA'))
      .send({ score: 5, comment: 'Zo‘r ishladi' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('havola');
  });

  it("baho 'pending' bo'lib tushadi va reytingga ta'sir qilmaydi", async () => {
    const r = await request(app).post(`/api/brigades/${brigadeId}/reviews`).set('Authorization', tok('ishA'))
      .send({ score: 5, sourceUrl: LINK, workType: 'suvoq', unit: 'm2', volume: 120, ratePerUnit: 45_000, penalty: 400_000, penaltyReason: 'Kechikdi' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending');
    const b: any = await Brigade.findById(brigadeId).lean();
    expect(b.avgScore).toBe(0);
    expect(b.reviewCount).toBe(0);
  });

  it('kelishuv summasi va shtraf serverda hisoblanadi', async () => {
    const card = await request(app).get(`/api/brigades/${brigadeId}`).set('Authorization', tok('dirA'));
    expect(card.body.myReview).toMatchObject({ agreedTotal: 5_400_000, penalty: 400_000, payable: 5_000_000, status: 'pending' });
  });

  it('baho 1..5 oralig‘ida bo‘lishi shart', async () => {
    const r = await request(app).post(`/api/brigades/${brigadeId}/reviews`).set('Authorization', tok('dirB'))
      .send({ score: 9, sourceUrl: LINK });
    expect(r.status).toBe(400);
  });
});

describe('tasdiqlash', () => {
  it("rahbar bo'lmagan xodim tasdiqlay olmaydi", async () => {
    const pend = await request(app).get('/api/brigades/reviews/pending').set('Authorization', tok('ishA'));
    expect(pend.status).toBe(403);
  });

  it("boshqa firma sharhini tasdiqlab bo'lmaydi", async () => {
    const mine = await request(app).get('/api/brigades/reviews/pending').set('Authorization', tok('dirA'));
    expect(mine.body.reviews).toHaveLength(1);
    const revId = mine.body.reviews[0].id;
    // B firmasining direktori A firmasining sharhini tasdiqlashga urinadi
    const r = await request(app).post(`/api/brigades/reviews/${revId}/approve`).set('Authorization', tok('dirB')).send({});
    expect(r.status).toBe(404);
    const b: any = await Brigade.findById(brigadeId).lean();
    expect(b.reviewCount).toBe(0);
  });

  it('o‘z firmasining rahbari tasdiqlaydi — reyting shundan keyin paydo bo‘ladi', async () => {
    const mine = await request(app).get('/api/brigades/reviews/pending').set('Authorization', tok('dirA'));
    const revId = mine.body.reviews[0].id;
    const r = await request(app).post(`/api/brigades/reviews/${revId}/approve`).set('Authorization', tok('dirA')).send({ sourceVerified: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ avgScore: 5, reviewCount: 1, firmCount: 1 });
  });

  it("tasdiqlangan sharh boshqa firmaga ko'rinadi, lekin kim baholagani ko'rinmaydi", async () => {
    const card = await request(app).get(`/api/brigades/${brigadeId}`).set('Authorization', tok('dirB'));
    expect(card.body.reviews).toHaveLength(1);
    expect(card.body.reviews[0].sourceVerified).toBe(true);
    const text = JSON.stringify(card.body);
    expect(text).not.toContain(A);          // baho bergan firmaning id'si
    expect(text).not.toContain('companyId');
  });

  it("baho qayta yuborilsa yana tasdiq kutadi (tasdiqsiz o'zgarmaydi)", async () => {
    const r = await request(app).post(`/api/brigades/${brigadeId}/reviews`).set('Authorization', tok('ishA'))
      .send({ score: 2, sourceUrl: LINK });
    expect(r.status).toBe(201);
    const b: any = await Brigade.findById(brigadeId).lean();
    expect(b.reviewCount).toBe(0);          // eski tasdiq ham bekor bo'ldi
    expect(b.avgScore).toBe(0);
  });

  it('rad etishda sabab shart va sabab muallifga ko‘rinadi', async () => {
    const mine = await request(app).get('/api/brigades/reviews/pending').set('Authorization', tok('dirA'));
    const revId = mine.body.reviews[0].id;
    expect((await request(app).post(`/api/brigades/reviews/${revId}/reject`).set('Authorization', tok('dirA')).send({})).status).toBe(400);
    const r = await request(app).post(`/api/brigades/reviews/${revId}/reject`).set('Authorization', tok('dirA'))
      .send({ reason: 'Havola boshqa brigadaga tegishli' });
    expect(r.status).toBe(200);
    const card = await request(app).get(`/api/brigades/${brigadeId}`).set('Authorization', tok('dirA'));
    expect(card.body.myReview.status).toBe('rejected');
    expect(card.body.myReview.rejectReason).toContain('Havola');
  });
});

describe('GET /api/brigades', () => {
  it("ma'lumotnoma barcha firmalarga ko'rinadi va nom bo'yicha qidiriladi", async () => {
    const r = await request(app).get('/api/brigades?q=olmazor').set('Authorization', tok('dirB'));
    expect(r.status).toBe(200);
    expect(r.body.brigades).toHaveLength(1);
    expect(r.body.brigades[0].name).toBe('Olmazor brigadasi');
    const none = await request(app).get('/api/brigades?q=yoqnarsa').set('Authorization', tok('dirB'));
    expect(none.body.brigades).toHaveLength(0);
  });
});
