import { test, expect, Page } from '@playwright/test';

// Owner 2026-10-22: telefonda boshqarish qiyin — har yozuvni o'zgartirib/o'chirib bo'lsin: qatorni bosganda pastdan
// amallar ro'yxati, telefonda chapga surganda (Telegramdagidek) o'zgartirish/o'chirish tugmalari. Backend soxta.
test.use({ serviceWorkers: 'block' });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };

const tx = (id: string, d: Record<string, unknown>) => ({ _id: id, id, type: 'material', status: 'pending', date: '2026-10-20', amount: 120_000, description: 'Sement', createdById: 'u2', companyId: 'c1', ...d });

async function mock(page: Page, calls: { patch: any[]; del: string[] }) {
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
    if (/\/api\/transactions\/t1$/.test(url) && method === 'PATCH') {
      const b = req.postDataJSON();
      calls.patch.push(b);
      return ok({ json: tx('t1', { ...b, createdById: 'u1' }) });
    }
    if (/\/api\/transactions\/t1$/.test(url) && method === 'DELETE') { calls.del.push('t1'); return ok({ json: { message: "O'chirildi" } }); }
    if (url.includes('/api/transactions') && method === 'GET') {
      return ok({ json: [tx('t1', { createdById: 'u1', description: 'Sement 3 qop' }), tx('t2', { description: 'Begona chiqim', status: 'confirmed' })] });
    }
    if (method === 'GET') return ok({ json: [] });
    return ok({ json: {} });
  });
}

async function seed(page: Page, role: string) {
  await page.addInitScript((r) => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify({ id: 'u1', name: 'Ali', role: r, phone: '+998900000001', projectIds: [], companyId: 'c1', language: 'uz' }));
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

test("Moliya: o'z chiqimini bosib → O'zgartirish → saqlash; begonasida amal yo'q (faqat batafsil)", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls = { patch: [] as any[], del: [] as string[] };
  await mock(page, calls);
  await seed(page, 'prorab');
  await page.goto('/');
  const rows = page.getByTestId('finance-row');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const mine = rows.filter({ hasText: 'Sement 3 qop' });
  await mine.click();
  await page.getByRole('button', { name: 'Tahrirlash' }).click();
  const modal = page.getByTestId('edit-expense');
  await expect(modal).toBeVisible();
  await modal.locator('input').nth(0).fill('150000');
  await modal.locator('input').nth(1).fill('Sement 4 qop');
  await page.getByTestId('edit-expense-save').click();
  await expect.poll(() => calls.patch.length).toBe(1);
  expect(calls.patch[0]).toEqual({ amount: 150000, description: 'Sement 4 qop' });
  await expect(mine.or(rows.filter({ hasText: 'Sement 4 qop' })).first()).toContainText('Sement 4 qop');

  // Boshqa xodimning tasdiqlangan chiqimi — bosilsa darhol batafsil (o'zgartirish yo'q)
  await rows.filter({ hasText: 'Begona chiqim' }).click();
  await expect(page.getByRole('button', { name: 'Tahrirlash' })).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test("Moliya (telefon): chapga surish — o'zgartirish/o'chirish tugmalari chiqadi", async ({ page }, info) => {
  test.skip(info.project.name !== 'telefon', 'faqat telefon');
  const calls = { patch: [] as any[], del: [] as string[] };
  await mock(page, calls);
  await seed(page, 'direktor');
  await page.goto('/');
  const row = page.getByTestId('finance-row').filter({ hasText: 'Sement 3 qop' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  // Sensorli surish (touch hodisalari)
  await row.evaluate((el, { x0, x1, yy }) => {
    const target = el.querySelector('[role="button"]') as HTMLElement;
    const mk = (type: string, x: number) => {
      const t = new Touch({ identifier: 1, target, clientX: x, clientY: yy });
      target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
    };
    mk('touchstart', x0);
    for (let i = 1; i <= 6; i++) mk('touchmove', x0 - ((x0 - x1) * i) / 6);
    mk('touchend', x1);
  }, { x0: box.x + box.width - 20, x1: box.x + 40, yy: y });
  const del = row.getByRole('button', { name: "O'chirish" });
  await expect(del).toBeVisible();
  await expect(row.getByRole('button', { name: 'Tahrirlash' })).toBeVisible();
});
