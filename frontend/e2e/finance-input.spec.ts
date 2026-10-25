import { test, expect, Page } from '@playwright/test';

// Owner 2026-10-23: "Boshqa" — oddiy (nomi + summa), summalar "1.000" ko'rinishida, klaviatura maydonni yopmasin
// (iPhone / Telegram), moliya raqamlari sanab chiqadi. Backend soxta.
test.use({ serviceWorkers: 'block' });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };

async function setup(page: Page, posted: any[]) {
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const ok = (o: any) => route.fulfill({ ...o, headers: CORS });
    if (url.includes('/api/status')) return ok({ json: { siteEnabled: true, appEnabled: true, botEnabled: true } });
    if (url.includes('/api/deploy/latest')) return ok({ json: { available: false } });
    if (url.includes('/api/attendance/today')) return ok({ json: { status: 'present', checkIn: new Date().toISOString() } });
    if (url.includes('/api/currency/rates')) return ok({ json: { UZS: 1, USD: 12_700, EUR: 13_800, source: 'Kapitalbank', date: '2026-10-23', kapital: { USD: { buy: 12_600, sell: 12_700 } } } });
    if (url.includes('/api/projects') && method === 'GET') return ok({ json: [{ _id: 'p1', id: 'p1', name: '12-maktab', status: 'active' }] });
    if (url.includes('/api/transactions') && method === 'POST') {
      const b = req.postDataJSON(); posted.push(b);
      return ok({ json: { ...b, _id: `n${posted.length}` } });
    }
    if (url.includes('/api/transactions') && method === 'GET') {
      return ok({ json: [{ _id: 't1', id: 't1', type: 'material', status: 'confirmed', date: '2026-10-20', amount: 1_250_000, description: 'Sement', createdById: 'u1', companyId: 'c1' }] });
    }
    if (method === 'GET') return ok({ json: [] });
    return ok({ json: {} });
  });
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify({ id: 'u1', name: 'Ali', role: 'direktor', phone: '+998900000001', projectIds: [], companyId: 'c1', language: 'uz' }));
      localStorage.setItem('page', 'finance');
      localStorage.setItem('finance.section', JSON.stringify('exp'));
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  });
}

test('Chiqim: summalar nuqta bilan (1.250.000), jami sanab chiqadi; "Boshqa" — faqat nomi + summa; materiallar faqat "Material"da', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const posted: any[] = [];
  await setup(page, posted);
  await page.goto('/');
  // Jami tasdiqlangan — oxirida aniq qiymat, nuqta bilan
  await expect(page.getByTestId('finance-total')).toHaveText("1.250.000 so'm", { timeout: 20_000 });
  await expect(page.getByTestId('finance-row').first()).toContainText('1.250.000');

  await page.getByRole('button', { name: 'Chiqim', exact: true }).click();
  const modal = page.getByTestId('add-expense');
  await expect(modal).toBeVisible();
  const type = modal.locator('select').first();

  // Material — ro'yxat (nomi + narxi), jami avtomatik
  await type.selectOption('material');
  await expect(modal.getByTestId('mat-name')).toHaveCount(1);
  await expect(modal.getByTestId('expense-amount')).toHaveCount(0);
  await modal.getByTestId('mat-price').fill('25000');
  await expect(modal.getByTestId('mat-price')).toHaveValue('25.000');

  // Boshqa — materiallar YO'Q, faqat nomi + summa
  await type.selectOption('boshqa');
  await expect(modal.getByTestId('mat-name')).toHaveCount(0);
  await expect(modal.getByText(/Materiallar va narxlar/i)).toHaveCount(0);
  await expect(modal.getByTestId('other-label')).toBeVisible();
  const amount = modal.getByTestId('expense-amount');
  await expect(amount).toHaveAttribute('inputmode', 'numeric');
  await amount.pressSequentially('1250000');
  await expect(amount).toHaveValue('1.250.000');
  // nuqta ustidan o'chirish — oldingi raqam o'chadi
  await amount.press('End');
  for (let i = 0; i < 3; i++) await amount.press('ArrowLeft');
  await amount.press('Backspace');
  await expect(amount).toHaveValue('125.000');
  await amount.fill('');
  await amount.fill('1000');
  await expect(amount).toHaveValue('1.000');
  await modal.getByTestId('other-label').fill('Ovqat');
  await modal.getByRole('button', { name: "Qo'shish", exact: true }).last().click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ type: 'boshqa', amount: 1000, description: 'Ovqat' });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Klaviatura (iPhone): visualViewport kichrayganda modal ko\'rinadigan qismga sig\'adi, fokusdagi maydon yopilmaydi', async ({ page }, info) => {
  test.skip(info.project.name !== 'telefon', 'faqat telefon');
  await page.addInitScript(() => {
    // iOS WebView'dagidek: klaviatura ochilganda window.innerHeight o'zgarmaydi, faqat visualViewport kichrayadi
    const listeners: Record<string, Set<() => void>> = { resize: new Set(), scroll: new Set() };
    const fake: any = {
      height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
      addEventListener: (t: string, f: () => void) => listeners[t]?.add(f),
      removeEventListener: (t: string, f: () => void) => listeners[t]?.delete(f),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
    (window as any).__setVV = (h: number) => { fake.height = h; listeners.resize.forEach((f) => f()); };
  });
  const posted: any[] = [];
  await setup(page, posted);
  await page.goto('/');
  await expect(page.getByTestId('finance-row').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Chiqim', exact: true }).click();
  const modal = page.getByTestId('add-expense');
  await modal.locator('select').first().selectOption('transport');
  const full = await page.evaluate(() => window.innerHeight);
  const visible = Math.round(full * 0.55); // klaviatura ekranning ~45% ini egallaydi
  const desc = modal.locator('input[placeholder*="maqsadi"]');
  await desc.focus();
  await page.evaluate((h) => (window as any).__setVV(h), visible);
  await expect(page.locator('html')).toHaveClass(/kb-open/);
  // modal ko'rinadigan balandlikdan oshmaydi va fokusdagi maydon klaviatura ustida
  await expect.poll(async () => { const b = (await modal.boundingBox())!; return Math.round(b.y + b.height); }).toBeLessThanOrEqual(visible);
  await expect.poll(async () => { const b = (await desc.boundingBox())!; return b.y + b.height; }).toBeLessThanOrEqual(visible);
  // pastdagi maydon (tasdiqlovchi/kimga) ham fokusda ko'rinadigan bo'ladi — modal ichida aylantiriladi
  const last = modal.locator('select').last();
  await last.focus();
  await expect.poll(async () => { const b = (await last.boundingBox())!; return b.y >= 0 && b.y + b.height <= visible; }).toBe(true);
  // klaviatura yopildi
  await page.evaluate((h) => (window as any).__setVV(h), full);
  await expect(page.locator('html')).not.toHaveClass(/kb-open/);
});

test('Sarlavha: "$1 = …" — Kapitalbank sotish kursi, nuqta bilan', async ({ page }, info) => {
  test.skip(info.project.name !== 'telefon', 'faqat telefon');
  await setup(page, []);
  await page.goto('/');
  await expect(page.getByTestId('header-day-rate')).toHaveText('$1 = 12.700', { timeout: 20_000 });
});
