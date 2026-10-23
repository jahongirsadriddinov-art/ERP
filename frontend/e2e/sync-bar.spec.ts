import { test, expect, Page } from '@playwright/test';

// Aloqa/sinxronlash qatori (owner 2026-10-23): suzuvchi "pill" o'rniga sarlavha ostida to'liq enli yaxlit qator.
// Holatlar: oflayn → qizil; serverda doim rad etiladigan (4xx) yozuv → abadiy "kutmoqda" emas, "yuborilmadi"
// (xato) + "Qayta urinish" / "Batafsil" → bekor qilish.
test.use({ serviceWorkers: 'block' });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };

async function mock(page: Page, calls: string[]) {
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const ok = (o: any) => route.fulfill({ ...o, headers: CORS });
    if (url.includes('/api/status')) return ok({ json: { siteEnabled: true, appEnabled: true, botEnabled: true } });
    if (url.includes('/api/deploy/latest')) return ok({ json: { available: false } });
    if (url.includes('/api/attendance/today')) return ok({ json: { status: 'present', checkIn: new Date().toISOString() } });
    if (url.includes('/api/admin/subscriptions/my')) return ok({ json: { status: 'active', daysLeft: 30, features: [] } });
    if (url.includes('/api/materials') && method === 'POST') { calls.push('materials'); return ok({ status: 400, json: { error: "Miqdor noto'g'ri" } }); }
    if (method === 'GET') return ok({ json: [] });
    return ok({ json: {} });
  });
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify({ id: 'u1', name: 'Ali', role: 'direktor', phone: '+998900000001', projectIds: [], companyId: 'c1', language: 'uz' }));
      localStorage.setItem('page', 'dashboard');
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  });
}

test('offline → full-width red line under the header; back online → hidden', async ({ page, context }) => {
  await mock(page, []);
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 20_000 });
  await context.setOffline(true);
  const bar = page.getByTestId('sync-bar');
  await expect(bar).toHaveAttribute('data-state', 'offline');
  await expect(bar).toContainText("Internet yo'q");
  // To'liq enli, burchaksiz, xiralashtirishsiz
  const look = await bar.evaluate((el) => { const cs = getComputedStyle(el); return { w: el.getBoundingClientRect().width, vw: document.documentElement.clientWidth, r: cs.borderRadius, bf: (cs as any).backdropFilter || cs.getPropertyValue('-webkit-backdrop-filter') }; });
  expect(look.w).toBeGreaterThanOrEqual(look.vw - 1);
  expect(look.r).toBe('0px');
  expect(['none', '']).toContain(look.bf);
  await context.setOffline(false);
  await expect(bar).toHaveCount(0, { timeout: 10_000 });
});

test('a queued change rejected with 4xx becomes "failed" with Retry / Details and can be discarded', async ({ page }) => {
  const calls: string[] = [];
  await mock(page, calls);
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 20_000 });
  // Ilova ishlatadigan API manzili (build'dagi API_BASE) — yuklangan so'rovlardan
  const apiBase = await page.evaluate(() => {
    const e = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/api\//.test(n)) || '';
    return e.slice(0, e.indexOf('/api/'));
  });
  expect(apiBase).toMatch(/^https?:/);
  // Navbatga (IndexedDB) internetsiz qilingan bitta amal qo'yamiz
  await page.evaluate((b) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('erp-offline', 1);
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id' }); if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'key' }); };
    req.onsuccess = () => {
      const tx = req.result.transaction('queue', 'readwrite');
      tx.objectStore('queue').put({ id: 'off_e2e_1', url: b + '/api/materials', method: 'POST', body: { kind: 'json', text: '{"name":"Sement"}' }, ts: Date.now(), attempts: 0 });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), apiBase);
  await page.reload();
  const bar = page.getByTestId('sync-bar');
  await expect(bar).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
  await expect(bar).toContainText("1 ta o'zgarish yuborilmadi");
  expect(calls.length).toBe(1);
  await expect(page.getByTestId('sync-retry')).toBeVisible();
  // Avtomatik qayta yuborilmaydi (abadiy takror yo'q)
  await page.waitForTimeout(1500);
  expect(calls.length).toBe(1);
  await page.getByTestId('sync-details').click();
  const sheet = page.getByTestId('sync-details-sheet');
  await expect(sheet).toContainText('Material');
  await expect(sheet).toContainText("Miqdor noto'g'ri");
  await sheet.getByTestId('sync-item-discard').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Ha' }).click();
  await expect(sheet.getByTestId('sync-item')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0, { timeout: 10_000 });
});
