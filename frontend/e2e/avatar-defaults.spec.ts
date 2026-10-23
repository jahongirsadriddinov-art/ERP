import { test, expect, Page } from '@playwright/test';

// Owner 2026-10-23: avatarni qo'lda tanlash YO'Q — rasmi yo'q har bir xodimga avtomatik, BARQAROR (user id'dan),
// jinsga mos 3D memoji (Fluent, bosh doirani to'ldiradi); rasm yuklagan xodimda — uning rasmi.
// Kuzatuv sahifasi: ro'yxat (UserAvatar) + xarita markerlari (memojiHtml). Backend soxta.
test.use({ serviceWorkers: 'block' });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
const PHOTO = 'https://res.cloudinary.com/demo/image/upload/sardor.png';
// 1x1 qizil PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

const USERS = [
  { id: 'u1', name: 'Ali Valiyev', role: 'direktor', phone: '+998900000001', companyId: 'c1', projectIds: [] },
  { id: 'w1', name: 'Sardor Usmonov', role: 'ishchi', phone: '+998900000011', companyId: 'c1', projectIds: [], avatar: PHOTO },
  { id: 'w2', name: 'Malika Karimova', role: 'prorab', phone: '+998900000012', companyId: 'c1', projectIds: [] },
  { id: 'w3', name: 'Jasur Toirov', role: 'ishchi', phone: '+998900000013', companyId: 'c1', projectIds: [] },
];

async function mock(page: Page) {
  await page.route(PHOTO, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const ok = (o: any) => route.fulfill({ ...o, headers: CORS });
    if (url.includes('/api/status')) return ok({ json: { siteEnabled: true, appEnabled: true, botEnabled: true } });
    if (url.includes('/api/deploy/latest')) return ok({ json: { available: false } });
    if (url.includes('/api/attendance/today')) return ok({ json: null });
    if (url.includes('/api/admin/subscriptions/my')) return ok({ json: { status: 'active', daysLeft: 30 } });
    if (url.includes('/api/gps/latest')) {
      return ok({ json: [
        { userId: 'w1', lat: 41.311, lng: 69.279, accuracy: 12, timestamp: ago(3), source: 'site', battery: 80 },
        { userId: 'w2', lat: 41.32, lng: 69.25, accuracy: 25, timestamp: ago(5), source: 'site', battery: 60 },
      ] });
    }
    if (/\/api\/gps\/user\//.test(url)) return ok({ json: url.includes('summary') ? { points: 0, distanceM: 0 } : [] });
    if (/\/api\/users(\?|$)/.test(url)) return ok({ json: USERS });
    if (req.method() === 'GET') return ok({ json: [] });
    return ok({ json: {} });
  });
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

const rowAvatar = (page: Page, name: string) => page.getByTestId('gps-worker-row').filter({ hasText: name }).locator('.user-avatar').first();

async function memojiIds(page: Page) {
  const out: Record<string, string | null> = {};
  for (const n of ['Malika Karimova', 'Jasur Toirov']) out[n] = await rowAvatar(page, n).getAttribute('data-memoji');
  return out;
}

test('Avatar: rasmsiz xodim — barqaror, jinsga mos memoji; rasmli — rasm (ro\'yxat va xarita)', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (info.project.name === 'telefon') await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await seed(page);
  await page.goto('/');
  await expect(page.getByTestId('gps-worker-row')).toHaveCount(3, { timeout: 20_000 });

  // Rasmli xodim — rasmi
  const photo = rowAvatar(page, 'Sardor Usmonov');
  await expect(photo).toHaveAttribute('src', PHOTO);
  expect(await photo.getAttribute('data-memoji')).toBeNull();

  // Rasmsizlar — manifest'dagi memoji, jinsga mos, rasm haqiqatan yuklangan
  const first = await memojiIds(page);
  expect(first['Malika Karimova']).toMatch(/^(woman|old-woman)-/);
  expect(first['Jasur Toirov']).toMatch(/^(man|old-man|person-wearing-turban)-/);
  for (const n of ['Malika Karimova', 'Jasur Toirov']) {
    const img = rowAvatar(page, n).locator('img');
    await expect(img).toHaveAttribute('src', `/avatars/${first[n]}.webp`);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(160);
  }
  // Header'dagi joriy foydalanuvchi ham memoji
  await expect(page.locator('header .user-avatar[data-memoji]').first()).toBeAttached();

  // Xarita markerlari: rasmli — rasm, rasmsiz — o'sha memoji
  await expect(page.locator('.wm-marker-inner img.memoji-avatar__photo[src="' + PHOTO + '"]')).toHaveCount(1);
  await expect(page.locator(`.wm-marker-inner img[src="/avatars/${first['Malika Karimova']}.webp"]`)).toHaveCount(1);

  await page.screenshot({ path: info.outputPath(`avatars-${info.project.name}.png`) });

  // Yangilangandan keyin ham AYNAN o'sha yuzlar (deterministik)
  await page.reload();
  await expect(page.getByTestId('gps-worker-row')).toHaveCount(3, { timeout: 20_000 });
  expect(await memojiIds(page)).toEqual(first);

  expect(errors, errors.join('\n')).toEqual([]);
});
