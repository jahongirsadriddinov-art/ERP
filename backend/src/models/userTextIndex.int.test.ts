// Regressiya: User text indeksi `language` (interfeys tili 'uz') maydonini Mongo matn tili deb o'qimasin —
// aks holda indeks qurilgach har bir User yozuvi "language override unsupported: uz" bilan rad etiladi
// (dataSafety.int.test.ts'dagi vaqti-vaqti bilan yiqilish sababi shu edi).
import { it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from './User';

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it("indekslar qurilgandan keyin ham 'uz'/'uz-cyrl'/'ru' tilli foydalanuvchi yoziladi", async () => {
  await User.init(); // barcha indekslar (text ham) tayyor bo'lsin
  const text = (await User.collection.indexes()).find((i: any) => i.key?._fts === 'text') as any;
  expect(text?.language_override).toBe('textSearchLanguage');
  await User.create({ firstName: 'A', phone: '+998900000001', role: 'ishchi' } as any); // default 'uz'
  await User.create({ firstName: 'B', phone: '+998900000002', role: 'ishchi', language: 'uz-cyrl' } as any);
  await User.collection.insertOne({ firstName: 'C', phone: '+998900000003', role: 'ishchi', language: 'ru' } as any);
  expect(await User.countDocuments()).toBe(3);
}, 60_000);
