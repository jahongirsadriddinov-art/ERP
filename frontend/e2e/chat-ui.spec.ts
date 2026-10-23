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

async function setup(page: Page, opts: { readAllStatus?: number; extraMsgs?: any[]; asProrab?: boolean } = {}) {
  const self = opts.asProrab ? { ...me, role: 'prorab', isOwner: false } : me;
  const userList = users.map((u) => (u === me ? self : u));
  const calls = { readAll: 0, markRead: [] as any[], sent: [] as any[], edits: [] as { id: string; body: any }[], deletes: [] as string[] };
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
    const msgId = url.match(/\/api\/messages\/([^/?]+)$/)?.[1];
    if (msgId && method === 'PATCH') { const body = req.postDataJSON(); calls.edits.push({ id: msgId, body }); return json({ _id: msgId, ...body }); }
    if (msgId && method === 'DELETE') { calls.deletes.push(msgId); return json({ id: msgId, deleted: true }); }
    if (/\/api\/messages$/.test(url) && method === 'POST') { const body = req.postDataJSON(); calls.sent.push(body); return json({ ...body, _id: `srv${calls.sent.length}` }, 201); }
    if (/\/api\/users(\?|$)/.test(url) && method === 'GET') return json(userList);
    if (/\/api\/messages\?/.test(url) && method === 'GET') return json([...messages(), ...(opts.extraMsgs || [])]);
    if (/\/api\/groups\?/.test(url) && method === 'GET') return json([group]);
    if (url.includes('/api/attendance/today')) return json({ status: 'present', checkIn: new Date().toISOString() });
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
  }, self);
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

// ─── Xabar amallari (Telegram uslubi): telefon — uzoq bosish → ActionSheet, o'ngga surish → javob; kompyuter — o'ng tugma ───
const bubbleOf = (page: Page, text: string) => page.getByTestId('chat-msg').filter({ hasText: text }).getByTestId('chat-bubble');

/** Teginish hodisalari (Playwright'da "uzoq bosish"/"surish" yo'q) — React delegatsiyasi uchun bubbles: true. */
async function touchGesture(page: Page, text: string, kind: 'long' | 'swipe') {
  const el = bubbleOf(page, text);
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  await el.evaluate(async (node, a) => {
    const x0 = a.x, y0 = a.y;
    const mk = (type: string, x: number) => {
      const t = new Touch({ identifier: 1, target: node, clientX: x, clientY: y0 });
      node.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    mk('touchstart', x0);
    if (a.kind === 'long') { await wait(650); mk('touchend', x0); return; }
    for (let dx = 4; dx <= 90; dx += 6) { mk('touchmove', x0 + dx); await wait(12); }
    mk('touchend', x0 + 90);
  }, { x: box.x + 20, y: box.y + box.height / 2, kind });
}

test("xabar amallari: javob, nusxa, tahrirlash (faqat o'ziniki), o'chirish (rahbar — istalganini)", async ({ page }, info) => {
  const phone = info.project.name === 'telefon';
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  const calls = await setup(page);
  await page.getByTestId('chat-row-u:u4').click();
  await expect(page.getByTestId('chat-thread-scroll')).toBeVisible();

  const openActions = async (text: string) => {
    if (phone) {
      await touchGesture(page, text, 'long');
      await expect(page.getByTestId('chat-msg-actions')).toBeVisible();
      return page.getByTestId('chat-msg-actions');
    }
    await bubbleOf(page, text).click({ button: 'right' });
    await expect(page.getByTestId('chat-msg-menu')).toBeVisible();
    return page.getByTestId('chat-msg-menu');
  };

  if (phone) {
    // Telegram'dagidek butun ekran: ilova sarlavhasi yashirin, suhbat sarlavhasi eng tepada, pastki navbar yo'q
    await expect(page.locator('header.nav-blur-top')).toBeHidden();
    expect((await page.getByTestId('chat-thread-header').boundingBox())!.y).toBeLessThan(40);
    await expect(page.locator('nav.ios-bottom-bar')).toHaveClass(/ios-bottom-bar-hidden/);
  }

  // O'z xabari (39 — men yozganman): tahrirlash bor
  let menu = await openActions('Xabar raqami 39');
  await shot(page, 'msg-actions');
  for (const a of ['reply', 'copy', 'edit', 'pin', 'forward', 'select', 'delete']) await expect(menu.getByTestId(`msg-action-${a}`)).toBeVisible();
  await menu.getByTestId('msg-action-edit').click();
  await expect(menu).toBeHidden();
  const input = page.getByTestId('chat-input');
  await expect(input).toHaveValue(/Xabar raqami 39/);
  await input.fill('Tuzatilgan matn');
  await page.getByTestId('chat-send').click();
  await expect.poll(() => calls.edits).toEqual([{ id: 'b39', body: { text: 'Tuzatilgan matn' } }]);
  await expect(page.getByTestId('chat-thread-scroll').getByText('Tuzatilgan matn')).toBeVisible();

  // Boshqaning xabari (38 — Brigadir): tahrirlash YO'Q, o'chirish bor (direktor)
  menu = await openActions('Xabar raqami 38');
  await expect(menu.getByTestId('msg-action-edit')).toHaveCount(0);
  await menu.getByTestId('msg-action-delete').click();
  await expect.poll(() => calls.deletes).toEqual(['b38']);
  await expect(page.getByTestId('chat-thread-scroll').getByText('Xabar raqami 38', { exact: false })).toHaveCount(0);

  // Javob: telefonda — pufakchani o'ngga surish; kompyuterda — menyudan
  if (phone) await touchGesture(page, 'Xabar raqami 36', 'swipe');
  else { menu = await openActions('Xabar raqami 36'); await menu.getByTestId('msg-action-reply').click(); }
  await expect(page.getByRole('button', { name: 'Javobni bekor qilish' })).toBeVisible();
  await input.fill('Qabul qildim');
  await page.getByTestId('chat-send').click();
  await expect.poll(() => calls.sent.map((b) => [b.text, b.replyToId])).toEqual([['Qabul qildim', 'b36']]);

  // Iqtibosga bosish — asl xabarga o'tadi va u bir lahza yoritiladi
  const quote = page.getByTestId('chat-msg').filter({ hasText: 'Qabul qildim' }).getByTestId('chat-msg-quote');
  await expect(quote).toBeVisible();
  await quote.click();
  await expect(page.locator('[data-msg-id="b36"]')).toHaveClass(/chat-msg-flash/);
  await expect(page.locator('[data-msg-id="b36"]')).toBeInViewport();

  // Composer ekranda (klaviatura/safe-area ostida qolmaydi), gorizontal skroll yo'q
  const cb = (await input.boundingBox())!;
  expect(cb.y + cb.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, 'msg-reply');
});

test("oddiy xodim boshqaning xabarini o'chira olmaydi (menyuda yo'q)", async ({ page }) => {
  const calls = await setup(page, { asProrab: true });
  await page.getByTestId('chat-row-u:u4').click();
  await bubbleOf(page, 'Xabar raqami 38').click({ button: 'right' });
  const menu = page.getByTestId('chat-msg-menu');
  await expect(menu.getByTestId('msg-action-reply')).toBeVisible();
  await expect(menu.getByTestId('msg-action-delete')).toHaveCount(0);
  await expect(menu.getByTestId('msg-action-edit')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // O'ziniki — o'chirish bor
  await bubbleOf(page, 'Xabar raqami 37').click({ button: 'right' });
  await page.getByTestId('chat-msg-menu').getByTestId('msg-action-delete').click();
  await expect.poll(() => calls.deletes).toEqual(['b37']);
});

