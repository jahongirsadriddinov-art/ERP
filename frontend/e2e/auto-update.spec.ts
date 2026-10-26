import { test, expect, Page } from '@playwright/test';

// Yangi deploy ochiq oynada o'zi qo'llanadi (owner 2026-10-25) — /version.json'da boshqa build → xavfsiz paytda
// (ilovaga qaytganda, oyna ochiq bo'lmasa) bir marta qayta yuklanadi va "Yangilandi" xabari chiqadi.
test.use({ serviceWorkers: 'block' });

async function mock(page: Page, build: { v: string }) {
  await page.route(/\/version\.json/, (r) => r.fulfill({ json: { build: build.v, version: 'x' }, headers: { 'Cache-Control': 'no-store' } }));
  await page.route(/\/api\//, (route) => {
    const url = route.request().url();
    if (url.includes('/api/status')) return route.fulfill({ json: { siteEnabled: true, appEnabled: true, botEnabled: true } });
    if (url.includes('/api/deploy/latest')) return route.fulfill({ json: { available: false } });
    if (url.includes('/api/plans')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
  });
}
const returnToApp = (page: Page) => page.evaluate(() => {
  for (const s of ['hidden', 'visible'] as const) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }
});

test('new build is applied on return to the app, once, with a "Yangilandi" toast', async ({ page }) => {
  const build = { v: 'same' };
  await mock(page, build);
  await page.goto('/');
  await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 15_000 });
  // Hozirgi build bilan bir xil emas, lekin yangilanish faqat qaytishda/harakatsizlikda
  let loads = 0;
  page.on('load', () => { loads++; });
  build.v = 'brand-new-build';
  await returnToApp(page);
  await expect.poll(() => loads, { timeout: 10_000 }).toBe(1);
  await expect(page.getByText(/Yangilandi/)).toBeVisible({ timeout: 10_000 });
  // Aylanish yo'q: o'sha build uchun qayta yuklanmaydi
  await page.waitForTimeout(500);
  await returnToApp(page);
  await page.waitForTimeout(1500);
  expect(loads).toBe(1);
});

test('no reload while a dialog is open', async ({ page }) => {
  const build = { v: 'brand-new-build-2' };
  await mock(page, build);
  await page.goto('/');
  await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 15_000 });
  let loads = 0;
  page.on('load', () => { loads++; });
  await page.evaluate(() => { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.id = 'e2e-dialog'; document.body.append(d); });
  await returnToApp(page);
  await page.waitForTimeout(2500);
  expect(loads).toBe(0);
  await page.evaluate(() => document.getElementById('e2e-dialog')?.remove());
  await returnToApp(page);
  await expect.poll(() => loads, { timeout: 10_000 }).toBe(1);
});
