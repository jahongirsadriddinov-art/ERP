import { test, expect, Page, Route } from '@playwright/test';

// AI yordamchi chatda va ovozli qo'ng'iroq (P7, egasi so'rovlari #1, #6, guruhdagi AI). Backend va Socket.IO
// SOXTA: REST page.route bilan, Socket.IO esa Engine.IO v4 "polling" protokolini shu yerda taqlid qiluvchi
// kichik server bilan (upgrades: [] — websocket'ga o'tilmaydi). Mikrofon — Chromium'ning soxta qurilmasi.
// HAQIQIY Gemini Live ovozi va server bu yerda tekshirilmaydi.

test.use({
  serviceWorkers: 'block',
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};
const SID = 'aiv-sess-1';
const CID = '123e4567-e89b-12d3-a456-426614174000';
const RS = '\x1e';

/** Engine.IO v4 polling + Socket.IO v5 paketlari — minimal soxta server. */
class FakeSio {
  private queue: string[] = [];
  private waiters: (() => void)[] = [];
  events: { name: string; data: any }[] = [];
  /** aiv:start javobi: ok — ulanadi; quota — server sababni aytib tugatadi; limit — ack rad etadi. */
  startMode: 'ok' | 'quota' | 'limit' = 'ok';

  push(packet: string) {
    this.queue.push(packet);
    for (const w of this.waiters.splice(0)) w();
  }
  emit(name: string, data: unknown) { this.push(`42${JSON.stringify([name, data])}`); }
  got(name: string) { return this.events.filter((e) => e.name === name); }

  private onClientPacket(p: string) {
    if (p === '40' || p.startsWith('40{')) { this.push('40{"sid":"sio-1"}'); return; }
    // Binar hodisa (mikrofon kadri): 451-["aiv:audio",{"_placeholder":true,"num":0}] + b64 ilova — faqat sanaymiz
    if (/^45\d+-\["aiv:audio"/.test(p)) { this.events.push({ name: 'aiv:audio', data: null }); return; }
    const m = /^42(\d*)(\[.*)$/s.exec(p);
    if (!m) return;
    let arr: any[];
    try { arr = JSON.parse(m[2]); } catch { return; }
    const [name, data] = arr;
    this.events.push({ name, data });
    const ackId = m[1];
    if (name === 'aiv:start' && ackId && this.startMode === 'limit') {
      this.push(`43${ackId}${JSON.stringify([{ ok: false, code: 'limit', message: "Soatlik ovozli qo'ng'iroqlar soni tugadi" }])}`);
    } else if (name === 'aiv:start' && ackId && this.startMode === 'quota') {
      this.push(`43${ackId}${JSON.stringify([{ ok: true, sessionId: SID, correlationId: CID }])}`);
      setTimeout(() => {
        this.emit('aiv:error', { code: 'ai_quota', message: 'Ovozli limit tugadi — matn bilan davom etamiz.' });
        this.emit('aiv:end', { sessionId: SID, reason: 'error' });
      }, 150);
    } else if ((name === 'aiv:start' || name === 'aiv:accept') && ackId) {
      this.push(`43${ackId}${JSON.stringify([{ ok: true, sessionId: SID, correlationId: CID }])}`);
      setTimeout(() => {
        this.emit('aiv:ready', { sessionId: SID, correlationId: CID, inputSampleRate: 16000, outputSampleRate: 24000, frameMs: 40, ptt: false });
        this.emit('aiv:transcript', { sessionId: SID, role: 'assistant', text: "Assalomu alaykum! Men AI yordamchiman.", final: true });
      }, 150);
    } else if (ackId) {
      this.push(`43${ackId}${JSON.stringify([{ ok: true }])}`);
    }
  }

  async handle(route: Route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const text = (body: string) => route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'text/plain; charset=UTF-8' }, body });
    if (req.method() === 'POST') {
      for (const p of (req.postData() || '').split(RS)) this.onClientPacket(p);
      return text('ok');
    }
    if (!url.searchParams.get('sid')) {
      return text(`0${JSON.stringify({ sid: 'eio-1', upgrades: [], pingInterval: 600000, pingTimeout: 600000, maxPayload: 1000000 })}`);
    }
    // Uzun so'rov (long-poll): paket bo'lguncha ≤ 800 ms kutamiz, bo'lmasa noop
    if (!this.queue.length) await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 800); });
    const out = this.queue.splice(0);
    return text(out.length ? out.join(RS) : '6');
  }
}

type Calls = { chatPosts: any[]; groupPuts: any[]; asks: any[]; msgPosts: any[] };

async function mockApi(page: Page, sio: FakeSio, calls: Calls) {
  const group = { _id: 'g1', name: 'Obyekt 1', memberIds: ['u1', 'u2'], adminIds: [], createdBy: 'u1', companyId: 'c1' };
  let groupAi = false;
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (j: unknown, status = 200) => route.fulfill({ status, headers: CORS, json: j });
    if (url.includes('/api/status')) return json({ siteEnabled: true, appEnabled: true, botEnabled: true });
    if (url.includes('/api/deploy/latest')) return json({ available: false });
    if (url.includes('/api/admin/subscriptions/my')) return json({ status: 'active', daysLeft: 30, features: ['ai_assistant'] });
    if (url.includes('/api/ai-voice/me/chat/groups')) {
      if (url.endsWith('/ask')) {
        calls.asks.push(req.postDataJSON());
        setTimeout(() => sio.emit('message:new', { _id: 'ai-m1', fromUserId: 'ai-assistant', toUserId: '', groupId: 'g1', text: 'Salom! Qanday yordam bera olaman?', timestamp: new Date().toISOString(), type: 'text' }), 100);
        return json({ delivered: 'group', messageId: 'ai-m1' });
      }
      if (method === 'PUT') { calls.groupPuts.push(req.postDataJSON()); groupAi = !!req.postDataJSON().enabled; return json({ enabled: groupAi, canManage: true }); }
      if (/groups\/g1/.test(url)) return json({ enabled: groupAi, canManage: true, aiActive: true });
      return json({ groups: groupAi ? ['g1'] : [] });
    }
    if (url.includes('/api/ai-voice/me/chat/message')) {
      const body = req.postDataJSON();
      calls.chatPosts.push(body);
      if (/qo'ng'iroq qil/.test(body.text)) {
        // AI requestCallback'ni bajardi — server ~bir zumda ilova ichida qo'ng'iroq qiladi (aiv:incoming)
        setTimeout(() => sio.emit('aiv:incoming', { sessionId: SID, correlationId: CID, purpose: 'assistant', expiresAt: new Date(Date.now() + 30_000).toISOString(), companyName: 'Test' }), 600);
        return json({ reply: "Hozir ilova ichida qo'ng'iroq qilaman.", pendingActions: [], toolCalls: [{ name: 'requestCallback', status: 'ok' }] });
      }
      return json({ reply: `Bugun 12 ishchi keldi (savol: ${body.text})`, pendingActions: [], toolCalls: [] });
    }
    if (url.includes('/api/ai-voice/me/chat')) {
      return json({ aiActive: true, items: [{ id: 'h1', kind: 'msg', day: '2026-10-14', at: '2026-10-14T05:00:00Z', role: 'assistant', text: 'Kechagi javob' }] });
    }
    if (url.includes('/api/ai-voice/me/pending-call')) return json({ call: null });
    if (url.includes('/api/ai-voice/me')) return json({ status: { aiActive: true } });
    if (url.includes('/api/ai-voice/')) return json({});
    if (/\/api\/groups/.test(url) && method === 'GET') return json([group]);
    if (/\/api\/messages$/.test(url) && method === 'POST') {
      const body = req.postDataJSON();
      calls.msgPosts.push(body);
      return json({ ...body, _id: `m${calls.msgPosts.length}` });
    }
    if (method === 'GET') return json([]);
    return json({});
  });
  await page.route(/\/socket\.io\//, (route) => sio.handle(route));
}

async function seed(page: Page) {
  const user = { id: 'u1', name: 'Egasi', role: 'direktor', phone: '+998900000001', projectIds: [], isOwner: true, companyId: 'c1', language: 'uz' };
  await page.addInitScript((u) => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify(u));
      localStorage.setItem('page', 'chat');
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  }, user);
}

async function setup(page: Page) {
  const sio = new FakeSio();
  const calls: Calls = { chatPosts: [], groupPuts: [], asks: [], msgPosts: [] };
  await mockApi(page, sio, calls);
  await seed(page);
  await page.goto('/');
  return { sio, calls };
}

test('chatdagi AI kontakti: Beta belgisi, tarix, savol → javob, oxirigacha skroll', async ({ page }) => {
  const { calls } = await setup(page);
  const contact = page.getByTestId('ai-chat-contact');
  await expect(contact).toBeVisible({ timeout: 20_000 });
  await expect(contact.getByText('Beta')).toBeVisible();
  await contact.click();

  const thread = page.getByTestId('ai-chat-thread');
  await expect(thread).toBeVisible();
  await expect(thread.getByText('Kechagi javob')).toBeVisible();
  await page.getByTestId('ai-chat-input').fill('Bugun kim keldi?');
  await page.getByTestId('ai-chat-send').click();
  await expect(page.getByTestId('ai-chat-msg-user').last()).toHaveText('Bugun kim keldi?');
  await expect(page.getByTestId('ai-chat-msg-ai').last()).toContainText('Bugun 12 ishchi keldi');
  expect(calls.chatPosts[0]).toMatchObject({ text: 'Bugun kim keldi?', lang: 'uz' });

  // Ro'yxat oxirigacha tushgan (oxirgi javob ko'rinadi, pastki menyu ostida qolmaydi)
  const atEnd = await page.getByTestId('ai-chat-list').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 4);
  expect(atEnd).toBe(true);
  await expect(page.getByTestId('ai-chat-msg-ai').last()).toBeInViewport();
});

test("AI bilan ovozli qo'ng'iroq: 📞 → oyna → ulandi, jonli matn → tugatish", async ({ page }) => {
  const { sio } = await setup(page);
  await page.getByTestId('ai-chat-contact').click({ timeout: 20_000 });
  // socket (polling) ulanib, presence yuborilguncha
  await expect.poll(() => sio.got('aiv:presence').length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByTestId('ai-chat-call').click();

  const overlay = page.getByTestId('ai-call-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText('Beta')).toBeVisible();
  await expect.poll(() => sio.got('aiv:start').length, { timeout: 15_000 }).toBe(1);
  await expect(page.getByTestId('ai-call-captions')).toContainText('Men AI yordamchiman', { timeout: 10_000 });
  await expect(page.getByTestId('ai-call-status')).toContainText(/\d\d:\d\d/);

  // Mikrofon (soxta qurilma) → AudioWorklet → 16 kHz kadrlar serverga ketadi. Android'da (telefon loyihasi) —
  // bosib gapirish standart: tugma bosilmaguncha kadr yo'q, bosilganda aiv:ptt {on:true} va kadrlar.
  const ptt = page.getByTestId('ai-call-ptt');
  if (await ptt.isVisible()) {
    await page.waitForTimeout(400);
    expect(sio.got('aiv:audio')).toHaveLength(0);
    const b = (await ptt.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await expect.poll(() => sio.got('aiv:ptt').map((e) => e.data?.on)).toEqual([true]);
    await expect.poll(() => sio.got('aiv:audio').length, { timeout: 5_000 }).toBeGreaterThan(2);
    await page.mouse.up();
    await expect.poll(() => sio.got('aiv:ptt').map((e) => e.data?.on)).toEqual([true, false]);
  } else {
    await expect.poll(() => sio.got('aiv:audio').length, { timeout: 5_000 }).toBeGreaterThan(2);
  }

  await page.getByTestId('ai-call-mute').click();
  await expect(page.getByTestId('ai-call-mute')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('ai-call-hangup').click();
  await expect.poll(() => sio.got('aiv:hangup').map((e) => e.data?.sessionId)).toEqual([SID]);
  await expect(overlay).toBeHidden({ timeout: 6_000 });
});

test("guruhga AI qo'shish va @AI bilan savol", async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByRole('button', { name: /Obyekt 1/ }).first().click({ timeout: 20_000 });
  await page.getByTestId('ai-group-btn').click();
  const dlg = page.getByTestId('ai-group-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText('Beta')).toBeVisible();
  await page.getByTestId('ai-group-toggle').click();
  await expect.poll(() => calls.groupPuts.length).toBe(1);
  expect(calls.groupPuts[0]).toMatchObject({ enabled: true });
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('ai-group-btn')).toHaveAttribute('aria-pressed', 'true');

  const box = page.locator('textarea').last();
  await box.fill('@AI salom');
  await box.press('Enter');
  await expect.poll(() => calls.asks.length, { timeout: 10_000 }).toBe(1);
  expect(calls.asks[0]).toMatchObject({ text: '@AI salom', lang: 'uz' });
  expect(calls.msgPosts[0]).toMatchObject({ groupId: 'g1', text: '@AI salom' });
  // AI javobi guruhda odatdagi xabar bo'lib, "🤖 AI yordamchi" nomi bilan ko'rinadi
  await expect(page.getByText('Salom! Qanday yordam bera olaman?').last()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('🤖 AI yordamchi', { exact: true }).last()).toBeVisible();
});

test("ovozli limit/kvota — qo'ng'iroq to'xtab qolmaydi: matnli AI chatiga o'tadi (sabab bilan)", async ({ page }) => {
  // ikki marta qo'ng'iroq + 15 s'lik kutishlar — parallel yuklamada 30 s'ga sig'masdi (beqaror edi)
  test.setTimeout(75_000);
  const { sio } = await setup(page);
  sio.startMode = 'quota';
  await page.getByTestId('ai-chat-contact').click({ timeout: 20_000 });
  await expect.poll(() => sio.got('aiv:presence').length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByTestId('ai-chat-call').click();
  await expect.poll(() => sio.got('aiv:start').length, { timeout: 15_000 }).toBe(1);
  const notice = page.getByTestId('ai-chat-notice').first();
  await expect(notice).toContainText('Ovozli limit tugadi — matn bilan davom etamiz', { timeout: 10_000 });
  await expect(page.getByTestId('ai-call-overlay')).toBeHidden();
  await expect(page.getByTestId('ai-chat-input').first()).toBeEnabled();

  // Soatlik limit (ack rad etadi) — xuddi shunday matnga o'tadi, "Limit tugadi" bilan to'xtamaydi
  sio.startMode = 'limit';
  await page.keyboard.press('Escape');
  await page.getByTestId('ai-chat-call').first().click();
  await expect.poll(() => sio.got('aiv:start').length, { timeout: 15_000 }).toBe(2);
  await expect(page.getByTestId('ai-chat-notice').first()).toContainText('matn bilan davom etamiz', { timeout: 10_000 });
  await expect(page.getByText("Limit tugadi — keyinroq urinib ko'ring")).toHaveCount(0);
});

test("chatda 'menga qo'ng'iroq qil' — AI qo'ng'irog'i jiringlamasdan darhol ulanadi", async ({ page }) => {
  const { sio } = await setup(page);
  await page.getByTestId('ai-chat-contact').click({ timeout: 20_000 });
  await expect.poll(() => sio.got('aiv:presence').length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByTestId('ai-chat-input').fill("menga qo'ng'iroq qil");
  await page.getByTestId('ai-chat-send').click();
  await expect(page.getByTestId('ai-chat-msg-ai').last()).toContainText("qo'ng'iroq qilaman");
  await expect.poll(() => sio.got('aiv:accept').map((e) => e.data?.sessionId), { timeout: 10_000 }).toEqual([SID]);
  const overlay = page.getByTestId('ai-call-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.getByTestId('ai-call-captions')).toContainText('Men AI yordamchiman', { timeout: 10_000 });
  await page.getByTestId('ai-call-hangup').click();
  await expect(overlay).toBeHidden({ timeout: 6_000 });
});
