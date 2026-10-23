import { test, expect, Page } from '@playwright/test';

// Telegram Mini App (iOS oq ekran): kichraytirib (minimize) qayta ochilganda ilova ko'rinishda qolishi,
// Telegram SDK'ga expand()/ranglar qayta yuborilishi va lifecycle hodisalari ishlashi.
const TG_STUB = `
  window.__tg = { calls: [], handlers: {} };
  window.Telegram = { WebApp: {
    initData: 'query_id=1&user=%7B%22id%22%3A1%7D&hash=x',
    ready: function () { __tg.calls.push('ready'); },
    expand: function () { __tg.calls.push('expand'); },
    isVersionAtLeast: function () { return true; },
    setHeaderColor: function (c) { __tg.calls.push('header:' + c); },
    setBackgroundColor: function (c) { __tg.calls.push('bg:' + c); },
    setBottomBarColor: function () {},
    onEvent: function (ev, fn) { __tg.handlers[ev] = fn; },
    offEvent: function () {},
    HapticFeedback: { impactOccurred: function () {}, selectionChanged: function () {}, notificationOccurred: function () {} },
  } };
`;

async function mock(page: Page) {
  await page.route(/telegram\.org\/js\/telegram-web-app\.js/, (r) => r.fulfill({ contentType: 'application/javascript', body: TG_STUB }));
  await page.route(/\/api\//, (route) => {
    const url = route.request().url();
    if (url.includes('/api/status')) return route.fulfill({ json: { siteEnabled: true, appEnabled: true, botEnabled: true } });
    if (url.includes('/api/deploy/latest')) return route.fulfill({ json: { available: false } });
    if (url.includes('/api/plans')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
  });
}

const setVisibility = (page: Page, state: 'hidden' | 'visible') => page.evaluate((s) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);

test('Mini App: hidden → visible keeps the app on screen and re-applies Telegram chrome', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mock(page);
  await page.goto('/#tgWebAppData=' + encodeURIComponent('query_id=1&user=%7B%22id%22%3A1%7D&hash=x') + '&tgWebAppVersion=8.0&tgWebAppPlatform=ios');
  await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__tg?.calls?.includes('ready')), { timeout: 10_000 }).toBe(true);
  const contentBefore = await page.locator('#root').innerText();
  expect(contentBefore.trim().length).toBeGreaterThan(0);

  await page.evaluate(() => { (window as any).__tg.calls = []; });
  await setVisibility(page, 'hidden');
  await page.waitForTimeout(300);
  await setVisibility(page, 'visible');
  await expect.poll(() => page.evaluate(() => (window as any).__tg.calls.filter((c: string) => c === 'expand').length)).toBeGreaterThan(0);
  const calls: string[] = await page.evaluate(() => (window as any).__tg.calls);
  expect(calls.some((c) => /^bg:#[0-9a-f]{6}$/.test(c))).toBe(true);

  // Telegram 'activated' (Bot API 8.0) — ham tiklaydi
  await page.waitForTimeout(300);
  await page.evaluate(() => { (window as any).__tg.calls = []; (window as any).__tg.handlers.activated?.(); });
  await expect.poll(() => page.evaluate(() => (window as any).__tg.calls.includes('expand'))).toBe(true);

  // Ilova hamon ko'rinadi (oq ekran emas) va body shaffof qolmadi
  await page.waitForTimeout(1800);
  await expect(page.locator('#root')).not.toBeEmpty();
  expect((await page.locator('#root').innerText()).trim().length).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.body.style.opacity)).toBe('');
  expect(errors, errors.join('\n')).toEqual([]);
});
