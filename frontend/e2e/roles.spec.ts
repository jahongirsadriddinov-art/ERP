import { test, expect, Page } from '@playwright/test';

// Rollar bo'yicha ko'rinish (owner 2026-10-22): har bir rol bilan kirilganda menyu bo'limlari va taqiqlangan
// tugmalar. Direktor/o'rinbosar — hamma bo'lim (Hisobotlar, Kuzatuv, Kirimlar, AI); prorab/brigadir/ishchi —
// faqat Bosh sahifa, Moliya, Xabarlar, Profil. Obyekt menyusi: tahrirlash/havola/o'chirish — faqat rahbar;
// smeta yuklash — rahbar yoki obyekt prorabi. Backend soxta (page.route).
test.use({ serviceWorkers: 'block' });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };

type Role = 'direktor' | 'orinbosar' | 'prorab' | 'brigadir' | 'ishchi';
const ROLES: Role[] = ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi'];
const isBoss = (r: Role) => r === 'direktor' || r === 'orinbosar';

async function mock(page: Page, role: Role) {
  // Prorab — shu obyektning prorabi (foremanId), brigadir/ishchi — yo'q
  const foremanId = role === 'prorab' ? 'u1' : 'u9';
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const ok = (o: any) => route.fulfill({ ...o, headers: CORS });
    if (url.includes('/api/status')) return ok({ json: { siteEnabled: true, appEnabled: true, botEnabled: true } });
    if (url.includes('/api/deploy/latest')) return ok({ json: { available: false } });
    if (url.includes('/api/attendance/today')) return ok({ json: { status: 'present', checkIn: new Date().toISOString() } });
    // features yo'q → tarifdagi barcha funksiyalar yoqilgan (reports, gps_tracking, ai_assistant) — farq faqat roldan
    if (url.includes('/api/admin/subscriptions/my')) return ok({ json: { status: 'active', daysLeft: 30 } });
    if (url.includes('/api/users') && method === 'GET') {
      return ok({ json: [
        { id: 'u1', name: 'Ali', role, phone: '+998900000001', projectIds: ['o1'] },
        { id: 'u9', name: 'Vali', role: 'direktor', phone: '+998900000009', projectIds: [] },
      ] });
    }
    if (/\/api\/objects\/?(\?|$)/.test(url) && method === 'GET') {
      return ok({ json: [{ _id: 'o1', name: 'Alfa uy', status: 'active', foremanId, budget: 100_000_000, materials: [] }] });
    }
    if (url.includes('/api/transactions') && method === 'GET') return ok({ json: [] });
    if (method === 'GET') return ok({ json: [] });
    return ok({ json: {} });
  });
}

async function seed(page: Page, role: Role) {
  await page.addInitScript((r) => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify({ id: 'u1', name: 'Ali', role: r, phone: '+998900000001', projectIds: ['o1'], companyId: 'c1', language: 'uz' }));
      localStorage.setItem('page', 'finance');
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  }, role);
}

const navBtn = (page: Page, label: string) => page.locator(`nav button[aria-label="${label}"]:visible`);

for (const role of ROLES) {
  test(`${role}: menyu bo'limlari va taqiqlangan tugmalar`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mock(page, role);
    await seed(page, role);
    await page.goto('/');

    // ── Menyu ──
    for (const label of ['Bosh sahifa', 'Moliya', 'Xabarlar', 'Profil']) await expect(navBtn(page, label)).toHaveCount(1, { timeout: 20_000 });
    for (const label of ['Hisobotlar', 'Kuzatuv']) await expect(navBtn(page, label)).toHaveCount(isBoss(role) ? 1 : 0);
    if (info.project.name === 'kompyuter') {
      await expect(page.getByRole('button', { name: 'AI Yordamchi' })).toHaveCount(isBoss(role) ? 1 : 0);
    }

    // ── Moliya: Kirimlar bo'limi HAMMA rolga (owner 2026-10-23); kim kiritgani bo'yicha guruh — faqat rahbarga ──
    const section = page.getByTestId('finance-section');
    await section.getByRole('tab', { name: 'Kirimlar' }).click({ timeout: 20_000 });
    await expect(page.getByTestId('income-add')).toBeVisible();
    await expect(page.getByTestId('income-panel')).toContainText(isBoss(role) ? 'Jami kirim (hamma)' : 'Siz kiritgan kirim');
    await section.getByRole('tab', { name: 'Chiqimlar' }).click();

    // ── Rahbar bo'limlari ochiladi (xatosiz) ──
    if (isBoss(role)) {
      await navBtn(page, 'Hisobotlar').click();
      await navBtn(page, 'Kuzatuv').click();
    }

    // ── Obyekt sahifasi: amallar menyusi ──
    await page.evaluate(() => { localStorage.setItem('selProjectId', 'o1'); localStorage.setItem('page', 'dashboard'); });
    await page.reload();
    const more = page.getByTestId('object-more');
    await expect(more).toBeVisible({ timeout: 20_000 });
    const statusSel = page.getByRole('combobox', { name: 'Holat' });
    if (isBoss(role)) await expect(statusSel).toBeEnabled(); else await expect(statusSel).toBeDisabled();
    await more.click();
    const sheet = page.getByRole('dialog');
    const action = (name: string) => sheet.getByRole('button', { name, exact: true });
    for (const name of ['Loyihani tahrirlash', 'Mijoz uchun havola', "Obyektni o'chirish"]) await expect(action(name)).toHaveCount(isBoss(role) ? 1 : 0);
    await expect(action('Smeta yuklash')).toHaveCount(isBoss(role) || role === 'prorab' ? 1 : 0);

    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test("dasturchi: firma ichki bo'limlari yo'q — faqat dasturchi paneli", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mock(page, 'direktor');
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify({ id: 'd1', name: 'Dev', role: 'dasturchi', phone: '+998900000099', projectIds: [], language: 'uz' }));
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  });
  await page.goto('/');
  await expect(page.locator('body')).not.toBeEmpty();
  await page.waitForTimeout(1500);
  for (const label of ['Moliya', 'Hisobotlar', 'Kuzatuv']) await expect(navBtn(page, label)).toHaveCount(0);
  await expect(page.getByTestId('finance-section')).toHaveCount(0);
  await expect(page.getByTestId('object-more')).toHaveCount(0);
  expect(errors, errors.join(', ')).toEqual([]);
});
