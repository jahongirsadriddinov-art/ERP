// Integratsion sinov: oflayn navbatdan qayta yuborilgan amal ikki marta bajarilmaydi (X-Idempotency-Key).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { idempotency } from './idempotency';

let mongo: MongoMemoryServer;
let created = 0;
let failNext = false;
const app = express();
app.use(express.json());
app.use('/api', idempotency());
app.post('/api/items', (req, res) => {
  if (failNext) { failNext = false; return res.status(500).json({ error: 'boom' }); }
  created++;
  res.status(201).json({ id: `item${created}`, name: req.body?.name });
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const post = (key: string | null, auth = 'Bearer userA') => {
  const r = request(app).post('/api/items').set('Authorization', auth).send({ name: 'sement' });
  return key ? r.set('X-Idempotency-Key', key) : r;
};

describe('idempotency middleware', () => {
  it('replays the first successful response for the same key (no second create)', async () => {
    const a = await post('off_1_abcdef12');
    // javob saqlanishi (asinxron yozuv) tugashini kutamiz
    await new Promise((r) => setTimeout(r, 50));
    const b = await post('off_1_abcdef12');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(b.headers['x-idempotent-replay']).toBe('1');
    expect(created).toBe(1);
  });

  it('keys are per user — another token does not get the replay', async () => {
    const r = await post('off_1_abcdef12', 'Bearer userB');
    expect(r.headers['x-idempotent-replay']).toBeUndefined();
    expect(created).toBe(2);
  });

  it('a failed attempt frees the key so the retry runs', async () => {
    failNext = true;
    const a = await post('off_2_retry0001');
    expect(a.status).toBe(500);
    await new Promise((r) => setTimeout(r, 50));
    const b = await post('off_2_retry0001');
    expect(b.status).toBe(201);
    expect(created).toBe(3);
  });

  it('requests without a key are untouched', async () => {
    await post(null);
    await post(null);
    expect(created).toBe(5);
  });
});
