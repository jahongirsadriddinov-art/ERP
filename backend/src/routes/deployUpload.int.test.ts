// Integratsion sinov (xavfsizlik audit 2026-10-22): POST /api/deploy/upload-artifact — kalitsiz so'rov faylni
// diskka YOZMASLIGI kerak. Avval multer 200 MB gacha faylni kalit tekshiruvidan OLDIN uploads/ ga saqlardi va
// 401'da o'chirmasdi — autentifikatsiyasiz istalgan kishi diskni to'ldira olardi.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined), sendDocument: vi.fn(async () => ({})) } }));
vi.mock('../services/durableFiles', () => ({ persistUploadedFile: vi.fn(async () => undefined) }));

import express from 'express';
import request from 'supertest';
import deployRoutes from './deploy';

const app = express();
app.use('/api/deploy', deployRoutes);
const dir = path.join(process.cwd(), 'uploads');
const list = () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

beforeAll(() => { process.env.DEPLOY_BROADCAST_SECRET = 'test-deploy-secret-123'; });

describe('upload-artifact', () => {
  it("noto'g'ri/yo'q kalit — 401 va diskda yangi fayl qolmaydi", async () => {
    const before = new Set(list());
    const r1 = await request(app).post('/api/deploy/upload-artifact').attach('file', Buffer.alloc(64 * 1024, 1), 'junk.bin');
    const r2 = await request(app).post('/api/deploy/upload-artifact').set('x-deploy-secret', 'wrong').attach('file', Buffer.alloc(1024, 1), 'junk.bin');
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    const added = list().filter((f) => !before.has(f));
    expect(added).toEqual([]);
  });
});
