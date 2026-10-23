import { test, expect, Page } from '@playwright/test';

// Dasturchi paneli → "🐞 Xatolar" (owner 2026-10-22): guruhlangan xatolar ro'yxati, manba/holat filtrlari,
// tafsilot (qayerda, kod joyi, ekran, oxirgi amal, stack, oxirgi holatlar) va "Hal qilindi". Backend soxta.
test.use({ serviceWorkers: 'block' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

const events = [
  { id: 'e1', source: 'server', kind: 'http', message: "Cannot read properties of undefined (reading 'name')", where: 'POST /api/transactions → 500', topFrame: 'src/routes/transactions.ts:120 (handler)', count: 7, users: 3, firstSeen: '2026-10-22T08:00:00Z', lastSeen: '2026-10-22T09:30:00Z', resolved: false },
  { id: 'e2', source: 'client', kind: 'react', message: 'x.map is not a function', page: 'finance · /', topFrame: 'assets/FinancePage.js:1', count: 2, users: 2, firstSeen: '2026-10-22T07:00:00Z', lastSeen: '2026-10-22T09:00:00Z', resolved: false },
];
const detail = {
  ...events[0], companies: 2, lastRole: 'prorab', platform: 'android', appVersion: '1.4.0', action: 'tugma «Saqlash» (2 s oldin)', page: 'finance',
  breadcrumbs: ['tab «Chiqimlar» −10s', 'tugma «Saqlash» −2s'],
  stack: "TypeError: Cannot read properties of undefined (reading 'name')\n    at handler (src/routes/transactions.ts:120:15)",
  occurrences: [{ at: '2026-10-22T09:30:00Z', where: 'POST /api/transactions → 500', action: 'tugma «Saqlash»', role: 'prorab', platform: 'android', appVersion: '1.4.0' }],
};

type Calls = { lists: string[]; patches: any[] };

async function mockApi(page: Page, calls: Calls) {
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (body: any, status = 200) => route.fulfill({ status, headers: CORS, json: body });
    if (url.includes('/api/status')) return json({ siteEnabled: true, appEnabled: true, botEnabled: true });
    if (url.includes('/api/deploy/latest')) return json({ available: false });
    if (url.includes('/api/errors/events/e1')) {
      if (method === 'PATCH') { calls.patches.push(req.postDataJSON()); return json({ ok: true, resolved: true }); }
      return json(detail);
    }
    if (url.includes('/api/errors/events')) {
      calls.lists.push(url);
      const u = new URL(url);
      const src = u.searchParams.get('source');
      const items = events.filter((e) => !src || e.source === src);
      return json({ items, total: items.length, open: calls.patches.length ? 1 : 2 });
    }
    if (url.includes('/api/errors/log')) return json({ ok: true });
    if (method === 'GET') return json([]);
    return json({});
  });
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify({ id: 'd1', name: 'Dasturchi', role: 'dasturchi', phone: '+998900000009', projectIds: [], language: 'uz' }));
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

test('Dasturchi paneli → Xatolar: ro\'yxat, filtr, tafsilot va "Hal qilindi"', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls: Calls = { lists: [], patches: [] };
  await mockApi(page, calls);
  await seed(page);
  await page.goto('/');

  const tab = page.getByTestId('dev-tab-errors');
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await expect(page.getByTestId('err-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('err-open-count')).toContainText('2 ta ochiq xato');
  await expect(page.getByTestId('err-row')).toHaveCount(2);
  await expect(page.getByTestId('err-row').first()).toContainText('POST /api/transactions');
  await expect(page.getByTestId('err-row').first()).toContainText('7 marta');
  expect(calls.lists[0]).toContain('status=open');

  // Manba filtri — so'rovga source qo'shiladi
  await page.getByTestId('err-source-client').click();
  await expect(page.getByTestId('err-row')).toHaveCount(1);
  await expect(page.getByTestId('err-row')).toContainText('x.map is not a function');
  expect(calls.lists.at(-1)).toContain('source=client');
  await page.getByTestId('err-source-all').click();
  await expect(page.getByTestId('err-row')).toHaveCount(2);

  // Tafsilot
  await page.getByTestId('err-row').first().click();
  const d = page.getByTestId('err-detail');
  await expect(d).toBeVisible();
  await expect(d).toContainText('src/routes/transactions.ts:120');
  await expect(d).toContainText('tugma «Saqlash»');
  await expect(d).toContainText('android');
  await expect(page.getByTestId('err-stack')).toContainText('at handler');
  await expect(page.getByTestId('err-occurrences').locator('li')).toHaveCount(1);

  // Hal qilindi
  await page.getByTestId('err-resolve').click();
  await expect.poll(() => calls.patches.length).toBe(1);
  expect(calls.patches[0]).toEqual({ resolved: true });
  await expect(page.getByTestId('err-reopen')).toBeVisible();

  // Orqaga — ro'yxat yangilangan
  await page.getByRole('button', { name: 'Orqaga' }).click();
  await expect(page.getByTestId('err-open-count')).toContainText('1 ta ochiq xato');

  // Refresh — tab o'z joyida qoladi
  await page.reload();
  await expect(page.getByTestId('err-panel')).toBeVisible({ timeout: 20_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test("Dasturchi paneli → Profil: xavfsizlik va sayt ko'rinishi bo'limlari ochiladi (panel yiqilmaydi)", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockApi(page, { lists: [], patches: [] } as Calls);
  await seed(page);
  await page.goto('/');
  const tab = page.getByTestId('dev-tab-profile');
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  const prof = page.getByTestId('dev-profile');
  await expect(prof.locator('[data-settings-group="app"]')).toBeVisible({ timeout: 15_000 });
  await expect(prof.locator('[data-settings-group="company"]')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
