import { test, expect, Page } from '@playwright/test';

// Chat ro'yxati: jildlar (rolga qarab), chat sozlamalari, "Hammasini o'qildi qilish", qadash, telefon/kompyuter
// joylashuvi. Backend SOXTA (page.route), Socket.IO ulanmaydi (so'rovlar bekor qilinadi).

test.use({ serviceWorkers: 'block' });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
const SHOTS = process.env.CHAT_SHOTS_DIR || '';

const me = { id: 'u1', name: 'Egasi Boss', role: 'direktor', phone: '+998900000001', projectIds: [], isOwner: true, companyId: 'c1', language: 'uz' };
const users = [
  me,
  { _id: 'u2', name: "O'rinbosar Aziz", role: 'orinbosar', phone: '+998900000002', companyId: 'c1' },
  { _id: 'u3', name: 'Prorab Vali', role: 'prorab', phone: '+998900000003', companyId: 'c1' },
  { _id: 'u4', name: 'Brigadir Soli', role: 'brigadir', phone: '+998900000004', companyId: 'c1' },
  { _id: 'u5', name: 'Ishchi Karim', role: 'ishchi', phone: '+998900000005', companyId: 'c1' },
  { _id: 'u6', name: 'Ishchi Jasur', role: 'ishchi', phone: '+998900000006', companyId: 'c1' },
];
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
function messages() {
  const list: any[] = [
    { _id: 'm1', fromUserId: 'u2', toUserId: 'u1', text: 'Hisobot tayyor', timestamp: ago(60 * 26), read: true },
    { _id: 'm2', fromUserId: 'u1', toUserId: 'u2', text: 'Rahmat!', timestamp: ago(60 * 25), read: true },
    { _id: 'm3', fromUserId: 'u3', toUserId: 'u1', text: 'Beton keldi', timestamp: ago(30), read: false },
    { _id: 'm4', fromUserId: 'u3', toUserId: 'u1', text: 'Qachon quyamiz?', timestamp: ago(29), read: false },
    { _id: 'm5', fromUserId: 'u5', toUserId: 'u1', text: 'Men keldim', timestamp: ago(10), read: false },
    { _id: 'm6', fromUserId: 'u3', toUserId: '', groupId: 'g1', text: 'Hammaga salom', timestamp: ago(5), read: false },
  ];
  // Uzun suhbat (skroll oxirigacha tekshiruvi) — Brigadir bilan
  for (let i = 0; i < 40; i++) list.push({ _id: `b${i}`, fromUserId: i % 2 ? 'u1' : 'u4', toUserId: i % 2 ? 'u4' : 'u1', text: `Xabar raqami ${i} — g'isht, sement, armatura`, timestamp: ago(600 - i * 5), read: true });
  return list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
const group = { _id: 'g1', name: 'Obyekt 1', memberIds: ['u1', 'u3', 'u5'], adminIds: ['u1'], createdBy: 'u1', companyId: 'c1' };

async function setup(page: Page, opts: { readAllStatus?: number; extraMsgs?: any[] } = {}) {
  const calls = { readAll: 0, markRead: [] as any[] };
  await page.route(/\/socket\.io\//, (r) => r.abort());
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (j: unknown, status = 200) => route.fulfill({ status, headers: CORS, json: j });
    if (url.includes('/api/status')) return json({ siteEnabled: true, appEnabled: true, botEnabled: true });
    if (url.includes('/api/deploy/latest')) return json({ available: false });
    if (url.includes('/api/admin/subscriptions/my')) return json({ status: 'active', daysLeft: 30, features: [] });
    if (url.includes('/api/messages/read-all') && method === 'POST') { calls.readAll++; return json({ ok: true }, opts.readAllStatus || 200); }
    if (url.includes('/api/messages/read') && method === 'PATCH') { calls.markRead.push(req.postDataJSON()); return json({ message: 'ok' }); }
    if (/\/api\/users(\?|$)/.test(url) && method === 'GET') return json(users);
    if (/\/api\/messages\?/.test(url) && method === 'GET') return json([...messages(), ...(opts.extraMsgs || [])]);
    if (/\/api\/groups\?/.test(url) && method === 'GET') return json([group]);
    if (url.includes('/api/ai-voice/')) return json({});
    if (method === 'GET') return json([]);
    return json({});
  });
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
      // Guruh o'qilmaganlari "birinchi ochilish"dan keyin sanaladi — sinov uchun boshlang'ich nuqta eski
      localStorage.setItem('erp_chatPrefs:u1', JSON.stringify({ v: 1, baseline: 1 }));
    } catch { /* */ }
  }, me);
  await page.goto('/');
  await expect(page.getByTestId('chat-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('chat-row-u:u3')).toBeVisible({ timeout: 20_000 });
  return calls;
}

const rowKeys = (page: Page) => page.locator('[data-testid^="chat-row-"]:not([data-testid^="chat-row-action"])').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('chat-row-', '')));
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png` }); };

test('jildlar rolga qarab ajratadi, sonlar va sozlamalar (yashirish, ixcham) saqlanadi', async ({ page }) => {
  await setup(page);
  const folders = page.getByTestId('chat-folders');
  for (const f of ['all', 'unread', 'bosses', 'prorabs', 'workers', 'groups']) await expect(folders.getByTestId(`chat-folder-${f}`)).toBeVisible();
  // "Hammasi" — 3 ta o'qilmagan suhbat (Prorab, Ishchi Karim, Obyekt 1)
  await expect(page.getByTestId('chat-folder-count-all')).toHaveText('3');
  await expect(page.getByTestId('chat-row-u:u3').getByTestId('chat-unread-badge')).toHaveText('2');
  await expect(page.getByTestId('chat-row-g:g1').getByTestId('chat-unread-badge')).toHaveText('1');
  await shot(page, 'list');
  expect(await noHorizontalScroll(page)).toBe(true);

  await page.getByTestId('chat-folder-prorabs').click();
  expect((await rowKeys(page)).sort()).toEqual(['u:u3', 'u:u4']);
  await page.getByTestId('chat-folder-workers').click();
  expect((await rowKeys(page)).sort()).toEqual(['u:u5', 'u:u6']);
  await page.getByTestId('chat-folder-bosses').click();
  expect(await rowKeys(page)).toEqual(['u:u2']);
  await page.getByTestId('chat-folder-groups').click();
  expect(await rowKeys(page)).toEqual(['g:g1']);
  await page.getByTestId('chat-folder-unread').click();
  expect((await rowKeys(page)).sort()).toEqual(['g:g1', 'u:u3', 'u:u5']);
  await shot(page, 'folder-unread');

  // Qidiruv
  await page.getByTestId('chat-folder-all').click();
  await page.getByTestId('chat-search').fill('jasur');
  expect(await rowKeys(page)).toEqual(['u:u6']);
  await page.getByTestId('chat-search').fill('');

  // Sozlamalar: "Ishchilar" jildini yashirish + ixcham ro'yxat → qayta yuklansa ham saqlanadi
  const rowH = async () => (await page.getByTestId('chat-row-u:u2').boundingBox())!.height;
  const before = await rowH();
  await page.getByTestId('chat-more').click();
  await page.getByTestId('chat-open-settings').click();
  const sheet = page.getByTestId('chat-settings-sheet');
  await expect(sheet).toBeVisible();
  await shot(page, 'settings');
  await sheet.getByTestId('chat-settings-folder-workers').click();
  await expect(sheet.getByTestId('chat-settings-folder-workers')).toHaveAttribute('aria-checked', 'false');
  await sheet.getByTestId('chat-settings-compact').click();
  await sheet.getByTestId('chat-settings-sort-unread').click();
  await sheet.getByRole('button', { name: 'Tayyor' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('chat-folder-workers')).toHaveCount(0);
  expect(await rowH()).toBeLessThan(before);
  // "Avval o'qilmaganlar": birinchi uchta — o'qilmaganlar
  expect((await rowKeys(page)).slice(0, 3).sort()).toEqual(['g:g1', 'u:u3', 'u:u5']);

  await page.reload();
  await expect(page.getByTestId('chat-row-u:u3')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('chat-folder-workers')).toHaveCount(0);
  await expect(page.getByTestId('chat-folder-prorabs')).toBeVisible();
});

test("Hammasini o'qildi qilish — bitta so'rov, belgilar yo'qoladi", async ({ page }) => {
  const calls = await setup(page);
  await page.getByTestId('chat-more').click();
  await shot(page, 'menu');
  await page.getByTestId('chat-mark-all-read').click();
  await expect.poll(() => calls.readAll).toBe(1);
  await expect(page.getByTestId('chat-unread-badge')).toHaveCount(0);
  await expect(page.getByTestId('chat-folder-count-all')).toHaveCount(0);
  await page.getByTestId('chat-folder-unread').click();
  await expect(page.getByTestId('chat-list-empty')).toHaveText("Hammasi o'qilgan");
  // Yangi so'rov kerak emas (hammasi o'qilgan) — menyu bandi o'chiq
  await page.getByTestId('chat-more').click();
  await expect(page.getByTestId('chat-mark-all-read')).toBeDisabled();
});

test("eski server (read-all yo'q) — har bir suhbat bo'yicha o'qildi qilinadi", async ({ page }) => {
  const calls = await setup(page, { readAllStatus: 404 });
  await page.getByTestId('chat-more').click();
  await page.getByTestId('chat-mark-all-read').click();
  await expect.poll(() => calls.markRead.map((b) => b.fromUserId).sort()).toEqual(['u3', 'u5']);
  await expect(page.getByTestId('chat-unread-badge')).toHaveCount(0);
});

test("qadash (o'ng tugma / surish) — suhbat tepaga chiqadi", async ({ page }) => {
  await setup(page);
  await page.getByTestId('chat-row-u:u6').click({ button: 'right' });
  await page.getByTestId('chat-row-u:u6').getByTestId('chat-row-action-pin').click();
  expect((await rowKeys(page))[0]).toBe('u:u6');
});

test("suhbat: sana ajratgichi, oxirigacha skroll, yuborish, 390px telefon", async ({ page }, info) => {
  if (info.project.name === 'telefon') await page.setViewportSize({ width: 390, height: 844 });
  const calls = await setup(page);
  await page.getByTestId('chat-row-u:u4').click();
  const scroller = page.getByTestId('chat-thread-scroll');
  await expect(scroller).toBeVisible();
  await expect(page.getByTestId('chat-day-sep').first()).toBeVisible();
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(4);
  await expect(scroller.getByText('Xabar raqami 39', { exact: false })).toBeInViewport();
  await shot(page, 'thread');
  expect(await noHorizontalScroll(page)).toBe(true);

  // Tepaga skroll → "pastga" tugmasi → oxiriga qaytadi
  await scroller.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await expect(page.getByTestId('chat-scroll-down')).toHaveCSS('opacity', '1');
  await page.getByTestId('chat-scroll-down').click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(4);

  // O'qilmagan suhbat ochilsa — serverga o'qildi yuboriladi
  if (info.project.name === 'telefon') await page.getByRole('button', { name: 'Orqaga' }).click();
  await page.getByTestId('chat-row-u:u3').click();
  await expect.poll(() => calls.markRead.map((b) => b.fromUserId)).toContain('u3');
  const input = page.getByTestId('chat-input');
  await input.fill('Ertaga ertalab');
  await expect(page.getByTestId('chat-send')).toBeVisible();
  const composer = await input.boundingBox();
  const vp = page.viewportSize()!;
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(vp.height);
  await shot(page, 'thread-unread');
});

test("Navbar chat belgisi O'qilmagan jildi bilan mos; modal ochilsa navbar yashirinadi va fon xiralashadi", async ({ page }, info) => {
  test.skip(info.project.name !== 'telefon', 'pastki navbar — faqat telefonda');
  await page.setViewportSize({ width: 390, height: 844 });
  // Ro'yxatda yo'q yuboruvchilar (o'chirilgan xodim, AI) va o'chirilgan xabar — belgiga tushmasligi kerak
  await setup(page, { extraMsgs: [
    { _id: 'x1', fromUserId: 'gone', toUserId: 'u1', text: 'eski', timestamp: ago(3), read: false },
    { _id: 'x2', fromUserId: 'ai-assistant', toUserId: 'u1', text: 'ai', timestamp: ago(2), read: false },
    { _id: 'x3', fromUserId: 'u6', toUserId: 'u1', text: 'del', timestamp: ago(1), read: false, deleted: true },
  ] });
  const listSum = await page.locator('[data-testid="chat-list"] [data-testid="chat-unread-badge"]').evaluateAll((els) => els.reduce((n, e) => n + Number(e.textContent || 0), 0));
  expect(listSum).toBe(4); // u3:2, u5:1, g1:1
  await expect(page.getByTestId('nav-badge-chat').first()).toHaveText('4');
  await page.getByTestId('chat-folder-unread').click();
  await expect(page.getByTestId('chat-list-empty')).toHaveCount(0);
  // Modal (chat sozlamalari) — navbar yashirinadi, body.modal-open, fon xira
  const nav = page.locator('nav.ios-bottom-bar');
  await expect(nav).not.toHaveClass(/ios-bottom-bar-hidden/);
  await page.getByTestId('chat-more').click();
  await page.getByTestId('chat-open-settings').click();
  await expect(nav).toHaveClass(/ios-bottom-bar-hidden/);
  await expect(page.locator('body')).toHaveClass(/modal-open/);
  const blur = await page.locator('.fixed.inset-0.modal-backdrop').first().evaluate((el) => getComputedStyle(el).backdropFilter || (getComputedStyle(el) as any).webkitBackdropFilter);
  expect(String(blur)).toContain('blur');
  await page.screenshot({ path: `test-results/modal-nav-hidden-${info.project.name}.png` });
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 10);
  await expect(nav).not.toHaveClass(/ios-bottom-bar-hidden/, { timeout: 5_000 });
  await expect(page.locator('body')).not.toHaveClass(/modal-open/);
});
