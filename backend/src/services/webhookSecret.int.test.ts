// Telegram webhook himoyasi: maxfiy sarlavhasiz/noto'g'ri sarlavhali so'rov 401, to'g'risi 200;
// webhook umumiy IP limitiga tushmaydi. Butun server/bot ishga tushirilmaydi — faqat kichik ilova.
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { deriveWebhookSecret, createBotWebhookHandler, BOT_WEBHOOK_PATH } from './botSecurity';
import { createApiRateLimiter, isApiRateLimitExempt } from '../middleware/apiRateLimit';

const SECRET = deriveWebhookSecret('123456:TEST-token');

function makeApp(processUpdate: (u: any) => void, limit = 3) {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRateLimiter(limit, 60_000, `wh-test-${Math.random()}`));
  app.get('/api/ping', (_req, res) => { res.json({ ok: true }); });
  app.post(BOT_WEBHOOK_PATH, createBotWebhookHandler(processUpdate, SECRET));
  return app;
}

describe('deriveWebhookSecret', () => {
  it('deterministik, faqat [A-Za-z0-9_-], 1..256 belgi, token bo\'yicha farqli', () => {
    expect(deriveWebhookSecret('123456:TEST-token')).toBe(SECRET);
    expect(SECRET).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(deriveWebhookSecret('other:token')).not.toBe(SECRET);
  });
});

describe('POST /api/bot/webhook', () => {
  const update = { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: 'hi' } };

  it('sarlavhasiz — 401, botga yetmaydi', async () => {
    const spy = vi.fn();
    const r = await request(makeApp(spy)).post(BOT_WEBHOOK_PATH).send(update);
    expect(r.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("noto'g'ri sarlavha (shu uzunlikda ham, boshqa uzunlikda ham) — 401", async () => {
    const spy = vi.fn();
    const app = makeApp(spy);
    const sameLen = SECRET.slice(0, -1) + (SECRET.endsWith('A') ? 'B' : 'A');
    for (const bad of [sameLen, 'x', SECRET + 'x']) {
      const r = await request(app).post(BOT_WEBHOOK_PATH).set('X-Telegram-Bot-Api-Secret-Token', bad).send(update);
      expect(r.status).toBe(401);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("to'g'ri sarlavha — 200 va update botga uzatiladi", async () => {
    const spy = vi.fn();
    const r = await request(makeApp(spy)).post(BOT_WEBHOOK_PATH).set('X-Telegram-Bot-Api-Secret-Token', SECRET).send(update);
    expect(r.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual(update);
  });

  it('processUpdate xato tashlasa ham 200 (Telegram qayta yubormasin)', async () => {
    const r = await request(makeApp(() => { throw new Error('boom'); }))
      .post(BOT_WEBHOOK_PATH).set('X-Telegram-Bot-Api-Secret-Token', SECRET).send(update);
    expect(r.status).toBe(200);
  });

  it("webhook umumiy IP limitiga tushmaydi, boshqa /api yo'llari esa tushadi", async () => {
    const spy = vi.fn();
    const app = makeApp(spy, 3);
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post(BOT_WEBHOOK_PATH).set('X-Telegram-Bot-Api-Secret-Token', SECRET).send(update);
      expect(r.status).toBe(200);
    }
    expect(spy).toHaveBeenCalledTimes(10);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await request(app).get('/api/ping')).status);
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it('istisno ro\'yxati', () => {
    expect(isApiRateLimitExempt('/bot/webhook')).toBe(true);
    expect(isApiRateLimitExempt('/health')).toBe(true);
    expect(isApiRateLimitExempt('/auth/login')).toBe(false);
    expect(isApiRateLimitExempt('/bot/webhookx')).toBe(false);
  });
});
