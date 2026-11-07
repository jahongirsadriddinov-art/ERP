// Integratsion sinov: /api/dev/settings-reset — faqat dasturchi; AppSettings/BotUiConfig/
// AiAssistantSettings/Company.features standartga qaytariladi; User/Object/Transaction TEGILMAYDI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Company from '../models/Company';
import ObjectModel from '../models/Object';
import Transaction from '../models/Transaction';
import AppSettings from '../models/AppSettings';
import BotUiConfig from '../models/BotUiConfig';
import AiAssistantSettings from '../models/AiAssistantSettings';
import AuditLog from '../models/AuditLog';
import { requireAuth, requireDeveloper, JWT_SECRET } from '../middleware/auth';
import devSettingsResetRoutes from './devSettingsReset';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/dev/settings-reset', requireAuth, requireDeveloper, devSettingsResetRoutes);

const ids: Record<string, string> = {};
let companyId = '';
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const company: any = await Company.create({
    name: 'Sinov MChJ', branchId: 'BR-T-0001', phone: '+998900000001',
    features: { briefing: false, theft: false, prices: false, docs: false, equipment: false, photoAi: false, piecework: true },
  } as any);
  companyId = String(company._id);

  ids.dev = String((await User.create({ firstName: 'Dev', phone: '+998900000099', role: 'dasturchi' }))._id);
  ids.boss = String((await User.create({ firstName: 'Boss', phone: '+998900000002', role: 'direktor', isOwner: true, companyId }))._id);
  ids.worker = String((await User.create({ firstName: 'Ishchi', phone: '+998900000003', role: 'ishchi', companyId }))._id);

  await ObjectModel.create({ name: 'Obyekt-1', companyId, status: 'active' } as any);
  await Transaction.create({ type: 'material', amount: 1000, companyId, status: 'confirmed', date: '2026-11-01', createdById: ids.worker } as any);

  await AppSettings.create({
    // siteEnabled/appEnabled/botEnabled dastlab YOQILGAN — aks holda non-developer
    // so'rovlar (403 testi) requireAuth'ning "texnik ishlar" to'sig'iga (503) uchraydi.
    key: 'global', siteEnabled: true, appEnabled: true, botEnabled: true,
    priceChannels: ['@kanal1'], devButtonLabels: { kb_x: 'X' }, devButtonOrder: ['kb_x'],
    requiredChannels: [{ url: 't.me/x', title: 'X' }],
    subscribeGateMsg: 'Obuna bo\'ling',
    discoveredChats: [{ chatId: '-100123', title: 'Kashf qilingan', type: 'channel' }],
    communityChatId: '-100999',
  } as any);

  await BotUiConfig.create({
    key: 'global', buttons: { kb_x: { label: 'X' } }, messageEmoji: [{ emoji: '✅', customEmojiId: '1' }],
    commands: [{ command: 'x', description: 'X' }], messageEmojiEnabled: false, stripEmojiWhenIcon: false,
    packs: [{ name: 'Pack1', title: 'P1', stickers: [] }],
  } as any);

  await AiAssistantSettings.create({
    companyId, enabled: true, language: 'ru', voiceName: 'Custom', version: 5,
  } as any);
}, 120_000);

afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

describe('POST /api/dev/settings-reset', () => {
  it('dasturchi bo\'lmagan foydalanuvchiga 403', async () => {
    const r = await request(app).post('/api/dev/settings-reset').set('Authorization', tok('boss')).send({});
    expect(r.status).toBe(403);
  });

  it('preview hech narsani o\'zgartirmaydi', async () => {
    const before = await AppSettings.findOne({ key: 'global' }).lean();
    const r = await request(app).get('/api/dev/settings-reset/preview').set('Authorization', tok('dev'));
    expect(r.status).toBe(200);
    expect(r.body.companiesAffected).toBe(1);
    const after = await AppSettings.findOne({ key: 'global' }).lean();
    expect(after!.siteEnabled).toBe(before!.siteEnabled);
  });

  it('dasturchi uchun: sozlamalar standartga qaytadi, userlar/malumotlar/Telegram holati tegilmaydi', async () => {
    // siteEnabled/appEnabled/botEnabled'ni to'g'ridan-to'g'ri bazada o'chiramiz (dev HTTP
    // orqali o'chirmaydi — surfaceEnabled to'sig'i faqat non-developer'larga ta'sir qiladi).
    await AppSettings.updateOne({ key: 'global' }, { $set: { siteEnabled: false, appEnabled: false, botEnabled: false } });

    const r = await request(app).post('/api/dev/settings-reset').set('Authorization', tok('dev')).send({});
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    const appSettings: any = await AppSettings.findOne({ key: 'global' }).lean();
    expect(appSettings.siteEnabled).toBe(true);
    expect(appSettings.appEnabled).toBe(true);
    expect(appSettings.botEnabled).toBe(true);
    expect(appSettings.priceChannels).toEqual([]);
    expect(appSettings.devButtonLabels).toEqual({});
    expect(appSettings.requiredChannels).toEqual([]);
    expect(appSettings.subscribeGateMsg).toBeUndefined();
    // Telegram'dan avtomatik kelgan holat — reset bilan tegilmaydi
    expect(appSettings.discoveredChats).toEqual([{ chatId: '-100123', title: 'Kashf qilingan', type: 'channel' }]);
    expect(appSettings.communityChatId).toBe('-100999');

    const botUi: any = await BotUiConfig.findOne({ key: 'global' }).lean();
    expect(botUi.buttons).toEqual({});
    expect(botUi.messageEmoji).toEqual([]);
    expect(botUi.commands).toEqual([]);
    expect(botUi.messageEmojiEnabled).toBe(true);
    expect(botUi.stripEmojiWhenIcon).toBe(true);
    // Stiker paketlar reset bilan o'chmaydi (mavjud naqsh: /bot-ui/reset bilan bir xil)
    expect(botUi.packs).toHaveLength(1);

    const ai: any = await AiAssistantSettings.findOne({ companyId }).lean();
    expect(ai.enabled).toBe(false);
    expect(ai.language).toBe('uz');
    expect(ai.voiceName).toBe('Kore');
    expect(ai.version).toBe(6); // $inc bilan oshdi, optimistik qulfni buzmaydi

    const comp: any = await Company.findById(companyId).lean();
    expect(comp.features).toEqual({ briefing: true, theft: true, prices: true, docs: true, equipment: true, photoAi: true, piecework: false });
    // Biznes maydonlar tegilmagan
    expect(comp.name).toBe('Sinov MChJ');
    expect(comp.phone).toBe('+998900000001');

    // Userlar, obyektlar, tranzaksiyalar — tegilmagan
    const users = await User.find({ companyId }).select('firstName phone role').lean();
    expect(users).toHaveLength(2);
    const objects = await ObjectModel.find({ companyId }).lean();
    expect(objects).toHaveLength(1);
    const txs = await Transaction.find({ companyId }).lean();
    expect(txs).toHaveLength(1);

    const audit = await AuditLog.findOne({ entity: 'settings-reset' }).lean();
    expect(audit).toBeTruthy();
  });

  it('qisman reset: faqat companyFeatures ko\'rsatilsa boshqa bo\'limlar o\'zgarmaydi', async () => {
    await Company.updateOne({ _id: companyId }, { $set: { 'features.docs': false } });
    await AppSettings.updateOne({ key: 'global' }, { $set: { siteEnabled: false } });

    const r = await request(app).post('/api/dev/settings-reset').set('Authorization', tok('dev')).send({ sections: ['companyFeatures'] });
    expect(r.status).toBe(200);
    expect(r.body.sections).toEqual(['companyFeatures']);

    const comp: any = await Company.findById(companyId).lean();
    expect(comp.features.docs).toBe(true);

    const appSettings: any = await AppSettings.findOne({ key: 'global' }).lean();
    expect(appSettings.siteEnabled).toBe(false); // bu bo'lim tanlanmagan — o'zgarmadi
  });
});
