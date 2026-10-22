import { test, expect, Page } from '@playwright/test';

// Owner 2026-10-22: "Kuzatuvni yaxshila". Telefonda butun ekran xarita + pastki panel (qidiruv, filtr, oxirgi ko'rilgan,
// ishda/kelmagan, batareya); xodimni bosish — xarita unga suziladi va bugungi iz chiziladi. Backend soxta.
test.use({ serviceWorkers: 'block' });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

const USERS = [
  { _id: 'u1', name: 'Ali Valiyev', role: 'direktor', phone: '+998900000001', companyId: 'c1' },
  { _id: 'w1', name: 'Sardor Usmonov', role: 'ishchi', phone: '+998900000011', companyId: 'c1' },
  { _id: 'w2', name: 'Bobur Karimov', role: 'prorab', phone: '+998900000012', companyId: 'c1' },
  { _id: 'w3', name: 'Jasur Toirov', role: 'ishchi', phone: '+998900000013', companyId: 'c1' },
];
const LATEST = [
  { userId: 'w1', lat: 41.311, lng: 69.279, accuracy: 12, timestamp: ago(3), source: 'site', battery: 15, charging: false },
  { userId: 'w2', lat: 41.32, lng: 69.25, accuracy: 25, timestamp: ago(95), source: 'bot_live', battery: 80 },
];
const TRACK = [0, 1, 2, 3, 4].map(i => ({ lat: 41.30 + i * 0.002, lng: 69.27 + i * 0.002, accuracy: 10, timestamp: ago(240 - i * 50) }));

async function mock(page: Page, opts: { latest?: any[] } = {}) {
  const calls: string[] = [];
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const ok = (o: any) => route.fulfill({ ...o, headers: CORS });
    calls.push(url);
    if (url.includes('/api/status')) return ok({ json: { siteEnabled: true, appEnabled: true, botEnabled: true } });
    if (url.includes('/api/deploy/latest')) return ok({ json: { available: false } });
    if (url.includes('/api/attendance/today')) return ok({ json: null });
    if (url.includes('/api/attendance/list')) {
      return ok({ json: [
        { userId: 'w1', status: 'WORKING', checkIn: ago(200), checkOut: null, workHours: null, minutesWorking: 200 },
        { userId: 'w2', status: 'FINISHED', checkIn: ago(500), checkOut: ago(100), workHours: 6.7, minutesWorking: null },
        { userId: 'w3', status: 'NOT_STARTED', checkIn: null, checkOut: null, workHours: null, minutesWorking: null },
      ] });
    }
    if (url.includes('/api/admin/subscriptions/my')) return ok({ json: { status: 'active', daysLeft: 30 } });
    if (url.includes('/api/gps/latest')) return ok({ json: opts.latest ?? LATEST });
    if (/\/api\/gps\/user\/w1\/summary/.test(url)) return ok({ json: { points: 5, distanceM: 1260, firstAt: TRACK[0].timestamp, lastAt: TRACK[4].timestamp, lastBattery: 15 } });
    if (/\/api\/gps\/user\/w1\?/.test(url)) return ok({ json: TRACK });
    if (/\/api\/gps\/user\//.test(url)) return ok({ json: url.includes('summary') ? { points: 0, distanceM: 0 } : [] });
    if (url.includes('/api/users')) return ok({ json: USERS });
    if (req.method() === 'GET') return ok({ json: [] });
    return ok({ json: {} });
  });
  // Xarita plitalari — internet kerak emas
  await page.route(/tile\.openstreetmap\.org/, r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
  return calls;
}
async function seed(page: Page) {
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify({ id: 'u1', name: 'Ali Valiyev', role: 'direktor', phone: '+998900000001', projectIds: [], companyId: 'c1', language: 'uz', isOwner: true }));
      localStorage.setItem('page', 'gps');
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  });
}

test('Kuzatuv: ro\'yxat, qidiruv, filtr; xodimni bosish — bugungi iz', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls = await mock(page);
  await seed(page);
  await page.goto('/');
  const sheet = page.getByTestId('gps-sheet');
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('worker-map')).toBeVisible();
  const rows = page.getByTestId('gps-worker-row');
  await expect(rows).toHaveCount(3);
  // Ishdagi + jonli birinchi; batareya kam — ko'rinadi
  await expect(rows.first()).toContainText('Sardor Usmonov');
  await expect(rows.first()).toContainText('Ishda');
  await expect(rows.first()).toContainText('15%');
  await expect(rows.filter({ hasText: 'Jasur Toirov' })).toContainText('Kelmagan');
  await expect(rows.filter({ hasText: 'Bobur Karimov' })).toContainText('Ketgan');

  await page.getByTestId('gps-search').fill('bobur');
  await expect(rows).toHaveCount(1);
  await page.getByTestId('gps-search').fill('');
  await sheet.getByRole('button', { name: /Signal yo'q/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Jasur Toirov');
  await sheet.getByRole('button', { name: /Hammasi/ }).click();

  await rows.filter({ hasText: 'Sardor Usmonov' }).click();
  const sel = page.getByTestId('gps-selected');
  await expect(sel).toContainText('Sardor Usmonov');
  await expect(page.getByTestId('gps-track-info')).toContainText('1.3 km');
  await expect(page.getByTestId('gps-track-info')).toContainText('5 nuqta');
  expect(calls.some(u => /\/api\/gps\/user\/w1\?from=/.test(u))).toBe(true);
  await expect(page.locator('.leaflet-overlay-pane path')).not.toHaveCount(0); // iz chizildi
  if (info.project.name === 'telefon') {
    await expect(sheet).toHaveAttribute('data-snap', 'peek'); // xarita ko'rinsin
    const box = (await page.getByTestId('worker-map').boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.width).toBeGreaterThanOrEqual(vp.width - 1);
    expect(box.height).toBeGreaterThan(vp.height * 0.5);
    await page.getByTestId('gps-sheet-handle').click();
    await expect(sheet).toHaveAttribute('data-snap', 'half');
  }
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sw).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('gps.png') });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Kuzatuv: hech kimdan joylashuv kelmagan — tushuntirish chiqadi', async ({ page }) => {
  await mock(page, { latest: [] });
  await seed(page);
  await page.goto('/');
  await expect(page.getByTestId('gps-empty')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('gps-empty')).toContainText('Jonli joylashuv');
  await expect(page.getByTestId('gps-worker-row')).toHaveCount(3);
});
