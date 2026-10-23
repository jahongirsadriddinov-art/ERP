import { test, expect, Page } from '@playwright/test';

// AI ofis → SMM (owner 2026-10-23): rasmli post (brauzerda shablon / AI rasm — QURILMADA saqlanadi), Instagram'ga e'lon
// (multipart fayl, soxta backend → "e'lon qilindi" + havola), avtopilot sozlamalari (rejim, kunlar, vaqt, qo'llanma),
// tasdiq kutayotgan post, statistika (jadval + grafiklar). Backend soxta — telefon va kompyuter o'lchamida.
test.use({ serviceWorkers: 'block' });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
const iso = (agoSec: number) => new Date(Date.now() - agoSec * 1000).toISOString();
const PROFILES = [
  ['manager', 'Boshliq', 'content', 'lead', '#D97757'], ['backend', 'Backend', 'code', 'platform', '#6366f1'],
  ['smm', 'SMM', 'content', 'growth', '#fb923c'], ['reporter', 'Hisobotchi', 'content', 'growth', '#f43f5e'],
].map(([key, name, kind, team, color]) => ({ key, name, kind, team, color, description: `${name} tavsifi`, systemPrompt: '', enabled: true, builtIn: true }));
// 1×1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Calls = { media: any[]; publish: string[]; settings: any[]; approvals: any[]; images: any[]; channel?: any[] };

async function mockApi(page: Page, calls: Calls) {
  const settings: any = { mode: 'off', days: [1, 3, 5], times: ['10:00'], formats: ['post', 'carousel', 'reel', 'story'], language: 'uz', targets: { telegram: true, instagram: true }, dailyCap: 3, paused: false, perWeek: 3, envKill: false };
  const status = {
    telegram: { bot: true, botUsername: 'qurilish_erp_bot', channel: false, channelSource: 'none', siteButton: true, devChat: false, viewsAvailable: false } as any,
    instagram: { configured: true, userIdSet: true, via: 'instagram', appSet: false, username: 'qurilisherp', publicUrl: true, secretsKey: true },
    gemini: { configured: true, imageModel: 'gemini-2.5-flash-image' }, ffmpeg: true,
    items: [{ key: 'INSTAGRAM_ACCESS_TOKEN', ok: true, required: true, for: 'instagram' }, { key: 'AGENT_TG_CHANNEL_ID', ok: false, required: false, for: 'telegram' }],
  };
  const items: any[] = [
    { title: 'Smeta 5 daqiqada', text: "QurilishERP bilan smetani tez tuzing. Bepul sinab ko'ring!", hashtags: ['#qurilish', '#erp'], format: 'post', category: 'feature', topic: 'Smeta', scenes: [{ title: 'Muammo', text: 'Smeta 3 kun' }] },
    { title: 'Ishchilar qayerda?', text: 'GPS davomat bilan bilasiz.', format: 'story', category: 'tip', approval: 'pending' },
    { title: 'GPS davomat', text: "Ishchilar qayerda — xaritada. Sinab ko'ring!", format: 'reel', category: 'feature', scenes: [{ title: 'GPS xarita', text: 'Ishchilar jonli' }] },
  ];
  const task = { id: 'aaaaaaaaaaaaaaaaaaaaaa01', agentKey: 'smm', agentKind: 'content', text: 'Haftalik post', status: 'done', summary: '2 ta post', items, links: [], log: [{ at: iso(5), text: 'Tayyor' }], plan: [], createdAt: iso(60), finishedAt: iso(5) };
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (body: any, st = 200) => route.fulfill({ status: st, headers: CORS, json: body });
    if (url.includes('/api/status')) return json({ siteEnabled: true, appEnabled: true, botEnabled: true });
    if (url.includes('/api/deploy/latest')) return json({ available: false });
    if (url.includes('/platform/office/weather')) return json({ mode: 'sunny', code: 0, temp: 20, isDay: true, cloud: 0, precipitation: 0, snowfall: 0, at: new Date().toISOString(), source: 'open-meteo' });
    if (url.includes('/platform/office/scores')) return json({ ok: true, scores: {} });
    if (url.includes('/platform/office/media')) return json({ yandex: '', tracks: [], cinema: '' });
    if (url.includes('/platform/smm/settings')) {
      if (method === 'PUT') { const b = req.postDataJSON(); calls.settings.push(b); Object.assign(settings, b, { perWeek: b.days.length * b.times.length, next: new Date(Date.now() + 3600e3).toISOString() }); return json({ ok: true, settings }); }
      return json({ settings, status });
    }
    if (url.includes('/platform/smm/telegram/channel')) {
      const b = req.postDataJSON();
      (calls.channel ||= []).push(b);
      if (calls.channel.length === 1) return json({ error: 'tg_bot_not_admin', botUsername: 'qurilish_erp_bot' }, 400);
      Object.assign(status.telegram, { channel: true, channelSource: 'db', channelName: '@erp_kanal', channelTitle: 'QurilishERP yangiliklari' });
      return json({ ok: true, channel: { id: '-1001234567890', username: 'erp_kanal', title: 'QurilishERP yangiliklari' }, botUsername: 'qurilish_erp_bot' });
    }
    if (url.includes('/platform/smm/runs')) return json({ runs: [{ key: 'smm:2026-10-22:10:00', status: 'published', format: 'reel', note: "reel: Instagram: ok", at: iso(86400) }] });
    if (url.includes('/platform/smm/image')) { calls.images.push(req.postDataJSON()); return json({ mime: 'image/png', data: PNG, source: 'ai' }); }
    if (url.includes('/platform/smm/analytics')) {
      return json({
        configured: true, updatedAt: iso(600), totals: { posts: 2, reach: 1320, views: 2100, likes: 88, comments: 12, saved: 9, shares: 4 },
        posts: [{ taskId: 'x1', index: 0, title: 'GPS davomat', kind: 'reel', url: 'https://www.instagram.com/reel/AAA/', publishedAt: iso(86400 * 2), metrics: { reach: 1000, likes: 70, comments: 10, saved: 7 }, engagement: 91, reach: 1000, updatedAt: iso(600) },
          { taskId: 'x2', index: 0, title: 'Smeta', kind: 'post', publishedAt: iso(86400 * 4), metrics: { reach: 320, likes: 18, comments: 2, saved: 2 }, engagement: 22, reach: 320, updatedAt: iso(600) }],
        account: { history: [{ date: '2026-10-20', followers: 1480, reach: 500, profileViews: 20, views: null }, { date: '2026-10-21', followers: 1495, reach: 650, profileViews: 25, views: null }, { date: '2026-10-22', followers: 1520, reach: 900, profileViews: 33, views: null }], latest: { followers: 1520, reach: 900 } },
        byFormat: [{ key: 'reel', n: 1, avgEngagement: 91, avgReach: 1000 }, { key: 'post', n: 1, avgEngagement: 22, avgReach: 320 }], byHour: [{ key: 18, n: 1, avgEngagement: 91, avgReach: 1000 }],
        best: { format: 'reel', hour: 18 }, telegram: { sent: 3, viewsAvailable: false },
      });
    }
    const m = /\/platform\/agent-tasks\/[^/]+\/items\/(\d+)(\/[a-z]+)?/.exec(url);
    if (m) {
      const i = Number(m[1]);
      if (m[2] === '/media') { const b = req.postDataJSON(); calls.media.push(b); items[i].media = b.media; return json({ ok: true, item: items[i] }); }
      if (m[2] === '/publish') {
        const body = (req.postDataBuffer() || Buffer.alloc(0)).toString('latin1');
        calls.publish.push(body);
        if (body.includes('name="target"\r\n\r\ntelegram')) return json({ ok: true, sentTo: status.telegram.channel ? 'channel' : 'developer', ...(status.telegram.channel ? { url: 'https://t.me/erp_kanal/40' } : {}) });
        items[i].ig = { status: 'published', at: new Date().toISOString(), kind: 'post', url: 'https://www.instagram.com/p/XYZ/' };
        return json({ ok: true, pending: true }, 202);
      }
      if (m[2] === '/approval') { const b = req.postDataJSON(); calls.approvals.push(b); items[i].approval = b.decision; return json({ ok: true, item: items[i] }); }
      if (method === 'PATCH') { const b = req.postDataJSON(); Object.assign(items[i], b, typeof b.hashtags === 'string' ? { hashtags: b.hashtags.split(/\s+/).filter(Boolean) } : {}); return json({ ok: true, item: items[i] }); }
    }
    if (url.includes('/api/ai-voice/platform/office')) {
      return json({ agents: PROFILES.map((p) => ({ id: p.key, name: p.name, kind: p.kind, team: p.team, color: p.color, busy: false, activity: 'idle', ...(p.key === 'smm' ? { task: { id: task.id, status: 'done', text: task.text, finishedAt: iso(5) } } : {}) })), generatedAt: new Date().toISOString() });
    }
    if (url.includes('/api/ai-voice/platform/agents')) return json({ agents: PROFILES, setup: { codeReady: false, contentReady: true, items: [] } });
    if (url.includes('/platform/agent-tasks')) {
      const key = new URL(url).searchParams.get('agentKey');
      return json({ tasks: key === 'smm' || !key ? [task] : [] });
    }
    if (url.includes('/api/ai-voice/platform/overview')) return json({ aiVoiceEnabled: true, providers: {}, enabledCompanies: 0, month: { month: '2026-10', costUsdMicros: 0 }, archives: {}, queue: {} });
    if (url.includes('/api/ai-voice/platform/')) return json({ error: 'not_implemented' }, 501);
    if (url.includes('/api/ai-voice/')) return json({});
    if (method === 'GET') return json([]);
    return json({});
  });
}

async function seed(page: Page) {
  const u = { id: 'd1', name: 'Dasturchi', role: 'dasturchi', phone: '+998900000009', projectIds: [], language: 'uz' };
  await page.addInitScript((user) => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify(user));
      localStorage.setItem('page', 'dashboard');
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
      localStorage.setItem('aiOffice.hint.v2', '1');
    } catch { /* */ }
  }, u);
}

async function openSmm(page: Page) {
  await page.goto('/');
  const tab = page.getByTestId('dev-tab-office');
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await expect(page.getByTestId('ai-office')).toBeVisible();
  await page.getByTestId('ai-office-agent-smm').click();
  await expect(page.getByTestId('ai-office-panel-name')).toHaveText('SMM');
}

test('SMM: rasmli post (shablon va AI), qurilmada saqlanadi, Instagram\'ga e\'lon (soxta)', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls: Calls = { media: [], publish: [], settings: [], approvals: [], images: [] };
  await mockApi(page, calls);
  await seed(page);
  await openSmm(page);
  const card = page.getByTestId('ai-office-item-0');
  await expect(card).toContainText('Smeta 5 daqiqada');
  // Shablon rasm — brauzerda (canvas) chiziladi va IndexedDB'da saqlanadi; serverga faqat metama'lumot
  await card.getByTestId('smm-gen-template').click();
  await expect.poll(() => calls.media.length, { timeout: 20_000 }).toBe(1);
  const meta = calls.media[0].media[0];
  expect(meta).toMatchObject({ kind: 'image', mime: 'image/jpeg', w: 1080, h: 1350, source: 'template' });
  expect(meta.id).toMatch(/^loc_/);
  await expect(card.getByTestId('smm-preview-img')).toBeVisible({ timeout: 10_000 });
  const nat = await card.getByTestId('smm-preview-img').evaluate((el: HTMLImageElement) => el.naturalWidth);
  expect(nat).toBe(1080);
  await page.screenshot({ path: `test-results/smm/post-${info.project.name}.png` });

  // AI rasm (soxta Gemini) — fon sifatida, yana qurilmada
  await card.getByTestId('smm-gen-ai').click();
  await expect.poll(() => calls.media.length, { timeout: 20_000 }).toBe(2);
  expect(calls.images[0]).toMatchObject({ taskId: 'aaaaaaaaaaaaaaaaaaaaaa01', index: 0, aspect: '4:5' });
  expect(calls.media[1].media[0].source).toBe('ai');

  // Instagram'ga e'lon — fayl multipart bilan (vaqtincha), so'ng holat + havola
  await card.getByTestId('smm-pub-ig').click();
  await expect.poll(() => calls.publish.length).toBe(1);
  expect(calls.publish[0]).toContain('name="target"\r\n\r\ninstagram');
  expect(calls.publish[0]).toContain('name="kind"\r\n\r\npost');
  expect(calls.publish[0]).toMatch(/filename="smm-0\.jpg"\r\nContent-Type: image\/jpeg/);
  await expect(card.getByTestId('smm-link-instagram')).toHaveAttribute('href', 'https://www.instagram.com/p/XYZ/', { timeout: 12_000 });

  // Tahrirlash
  await card.getByTestId('smm-edit').click();
  await card.getByTestId('smm-edit-text').fill('Yangi caption matni');
  await card.getByTestId('smm-edit-save').click();
  await expect(card).toContainText('Yangi caption matni');

  // Tasdiq kutayotgan (avtopilot) post — banner ko'rinadi
  await expect(page.getByTestId('ai-office-item-1').getByTestId('smm-approval')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('SMM: avtopilot sozlamalari saqlanadi; qo\'llanma; statistika', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls: Calls = { media: [], publish: [], settings: [], approvals: [], images: [] };
  await mockApi(page, calls);
  await seed(page);
  await openSmm(page);
  await page.getByTestId('smm-tab-autopilot').click();
  await expect(page.getByTestId('smm-settings')).toBeVisible();
  await expect(page.getByTestId('smm-conn-ig')).toContainText('@qurilisherp');
  await expect(page.getByTestId('smm-checklist')).toContainText('INSTAGRAM_ACCESS_TOKEN');
  await page.getByTestId('smm-guide-toggle').click();
  await expect(page.getByTestId('smm-guide')).toContainText('INSTAGRAM_ACCESS_TOKEN');
  await page.getByTestId('smm-mode-approve').check();
  await expect.poll(() => calls.settings.length).toBe(1);
  expect(calls.settings[0]).toMatchObject({ mode: 'approve', days: [1, 3, 5], times: ['10:00'] });
  await page.getByTestId('smm-day-6').click();
  await expect.poll(() => calls.settings.at(-1)?.days).toEqual([1, 3, 5, 6]);
  await page.getByTestId('smm-time-input').fill('18:30');
  await page.getByTestId('smm-time-add').click();
  await expect.poll(() => calls.settings.at(-1)?.times).toEqual(['10:00', '18:30']);
  await expect(page.getByTestId('smm-per-week')).toContainText('Haftasiga 8 ta post');
  await page.getByTestId('smm-paused').check();
  await expect.poll(() => calls.settings.at(-1)?.paused).toBe(true);
  await expect(page.getByTestId('smm-runs')).toContainText("e'lon qilindi");
  await page.screenshot({ path: `test-results/smm/autopilot-${info.project.name}.png` });

  await page.getByTestId('smm-tab-stats').click();
  await expect(page.getByTestId('smm-stats-table')).toContainText('GPS davomat', { timeout: 15_000 });
  await expect(page.getByTestId('smm-stats-tiles')).toContainText('1,320');
  await expect(page.getByTestId('smm-best')).toContainText('Reels');
  await expect(page.locator('[data-testid="smm-stats"] .recharts-surface').first()).toBeVisible();
  await page.screenshot({ path: `test-results/smm/stats-${info.project.name}.png` });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('SMM: Reels — kod bilan animatsion video (canvas + MediaRecorder, haqiqiy ERP skrinshoti), qurilmada saqlanadi', async ({ page }, info) => {
  test.skip(info.project.name !== 'kompyuter', "video yozish real vaqtda — bitta o'lchamda yetarli");
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls: Calls = { media: [], publish: [], settings: [], approvals: [], images: [] };
  await mockApi(page, calls);
  await seed(page);
  await openSmm(page);
  const card = page.getByTestId('ai-office-item-2');
  await card.getByTestId('smm-gen-template').click();
  await expect.poll(() => calls.media.length, { timeout: 60_000 }).toBe(1);
  const meta = calls.media[0].media[0];
  expect(meta).toMatchObject({ kind: 'video', source: 'code' });
  expect(meta.mime).toMatch(/^video\/(mp4|webm)$/);
  expect(meta.size).toBeGreaterThan(20_000);
  const v = card.getByTestId('smm-preview-video');
  await expect(v).toBeVisible();
  await expect.poll(() => v.evaluate((el: HTMLVideoElement) => el.videoWidth), { timeout: 10_000 }).toBeGreaterThan(600);
  expect(await v.evaluate((el: HTMLVideoElement) => el.videoHeight / el.videoWidth)).toBeCloseTo(16 / 9, 1);
  for (const at of [1.5, 4.5]) {
    await v.evaluate((el: HTMLVideoElement, t) => new Promise((r) => { el.onseeked = () => r(null); el.currentTime = t; }), at);
    await v.screenshot({ path: `test-results/smm/reel-${at}s.png` });
  }
  expect(errors, errors.join(' | ')).toEqual([]);
});

test("SMM: Telegram kanalni UI'dan ulash — bot admin emas xatosi (bot nomi bilan), so'ng ulanadi; tugma «Kanalga joylash»", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls: Calls = { media: [], publish: [], settings: [], approvals: [], images: [] };
  await mockApi(page, calls);
  await seed(page);
  await openSmm(page);
  const card = page.getByTestId('ai-office-item-0');
  // Kanal yo'q: tugma o'ziga yuborishini aytadi; yuborilgach — "Kanalni ulash" yorlig'i
  await expect(card.getByTestId('smm-pub-tg')).toHaveText("Botga (o'zimga) yuborish");
  await card.getByTestId('smm-pub-tg').click();
  await expect(page.getByText("Botga (o'zingizga) yuborildi — kanal ulanmagan")).toBeVisible();
  await page.getByRole('button', { name: 'Kanalni ulash' }).click();
  await expect(page.getByTestId('smm-settings')).toBeVisible();
  await expect(page.getByTestId('smm-tg-howto')).toContainText('@qurilish_erp_bot');
  await page.getByTestId('smm-tg-channel-input').fill('@erp_kanal');
  await page.getByTestId('smm-tg-channel-check').click();
  await expect(page.getByTestId('smm-tg-channel-error')).toContainText("Botni kanalga admin qiling: Kanal → Administratorlar → Admin qo'shish → @qurilish_erp_bot");
  await page.getByTestId('smm-tg-channel-check').click();
  await expect(page.getByTestId('smm-conn-tg')).toContainText('QurilishERP yangiliklari @erp_kanal');
  expect(calls.channel?.at(-1)).toEqual({ channel: '@erp_kanal' });
  await page.getByTestId('smm-tab-posts').click();
  await expect(page.getByTestId('ai-office-item-0').getByTestId('smm-pub-tg')).toHaveText('Kanalga joylash');
  await page.getByTestId('ai-office-item-0').getByTestId('smm-pub-tg').click();
  await expect(page.getByText('Kanalga joylandi')).toBeVisible();
  expect(errors, errors.join(' | ')).toEqual([]);
});
