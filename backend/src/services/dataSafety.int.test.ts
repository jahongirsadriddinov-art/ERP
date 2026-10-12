// Integratsion sinov ("robot"): haqiqiy MongoDB (xotirada) bilan — zaxira nusxa, tozalash va tiklash,
// geozona va ish vaqti darvozasi oxirigacha ishlashini tekshiradi.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import ObjectModel from '../models/Object';
import Transaction from '../models/Transaction';
import Company from '../models/Company';
import Attendance from '../models/Attendance';
import { takeSnapshot, restoreSnapshot, RESET_SCOPES, CompanySnapshot } from './companySnapshot';
import { checkGeofence, distanceM } from './geofence';
import { isOnShift, invalidateShift, workGateBlocks } from '../middleware/workGate';
import { todayInTashkent } from '../utils/tz';

let mongo: MongoMemoryServer;
let cid = '';
let bossId = '';
let workerId = '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const c: any = await Company.create({ name: 'Test Qurilish', branchId: 'T1', phone: '+998900000009' } as any);
  cid = String(c._id);
  const boss: any = await User.create({ firstName: 'Bosh', phone: '+998900000001', role: 'direktor', companyId: cid, isOwner: true } as any);
  const worker: any = await User.create({ firstName: 'Ishchi', phone: '+998900000002', role: 'ishchi', companyId: cid } as any);
  bossId = String(boss._id); workerId = String(worker._id);
  await ObjectModel.create({ name: 'Sergeli 8A', companyId: cid, lat: 41.2215, lng: 69.2195, geofenceRadius: 300 } as any);
  await Transaction.create({ type: 'material', amount: 150000, description: 'Sement', companyId: cid, status: 'confirmed', date: '2026-10-01', createdById: workerId } as any);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('zaxira nusxa → tozalash → tiklash', () => {
  it("tozalashdan keyin nusxadan hamma narsa qaytadi, rahbar hisobi o'chmaydi", async () => {
    const snap = await takeSnapshot(cid, 'manual');
    expect(snap.counts.transactions).toBe(1);
    expect(snap.counts.users).toBe(2);

    await RESET_SCOPES.expenses.run(cid, [bossId]);
    await RESET_SCOPES.staff.run(cid, [bossId]);
    expect(await Transaction.countDocuments({ companyId: cid })).toBe(0);
    expect(await User.countDocuments({ companyId: cid })).toBe(1); // faqat rahbar qoldi

    const r = await restoreSnapshot(String(snap._id), cid, { userId: bossId, name: 'Bosh', role: 'direktor' }, bossId);
    expect(r.restored.transactions).toBe(1);
    expect(await Transaction.countDocuments({ companyId: cid })).toBe(1);
    expect(await User.countDocuments({ companyId: cid })).toBe(2);
    // tiklashdan oldin ham avtomatik nusxa olingan
    expect(await CompanySnapshot.countDocuments({ companyId: cid, reason: 'pre_restore' })).toBe(1);
  }, 60_000);
});

describe('geozona', () => {
  it('obyekt ichida ruxsat, uzoqda rad etiladi', async () => {
    expect((await checkGeofence(workerId, cid, 41.2216, 69.2196)).ok).toBe(true);
    const far = await checkGeofence(workerId, cid, 41.3111, 69.2797); // ~11 km
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.distance).toBeGreaterThan(5000);
  });
  it('masofa formulasi', () => {
    expect(Math.round(distanceM({ lat: 41, lng: 69 }, { lat: 41.001, lng: 69 }))).toBe(111);
  });
});

describe('ish vaqti darvozasi', () => {
  it("ishga kelmagan ishchi yopiq, kelgandan keyin ochiq, tugatgach yana yopiq", async () => {
    invalidateShift(workerId);
    expect(await isOnShift(workerId)).toBe(false);
    const a: any = await Attendance.create({ userId: workerId, companyId: cid, date: todayInTashkent(), checkIn: new Date().toISOString(), status: 'present' } as any);
    invalidateShift(workerId);
    expect(await isOnShift(workerId)).toBe(true);
    a.checkOut = new Date().toISOString(); await a.save();
    invalidateShift(workerId);
    expect(await isOnShift(workerId)).toBe(false);
  });
  it("faqat ishchi rollari va faqat yopiq yo'llar bloklanadi", () => {
    const req = (url: string, method = 'GET') => ({ originalUrl: url, method } as any);
    expect(workGateBlocks(req('/api/transactions', 'POST'), 'ishchi')).toBe(true);
    expect(workGateBlocks(req('/api/attendance/checkin', 'POST'), 'ishchi')).toBe(false);
    expect(workGateBlocks(req('/api/users'), 'ishchi')).toBe(false);
    expect(workGateBlocks(req('/api/transactions', 'POST'), 'direktor')).toBe(false);
  });
});
