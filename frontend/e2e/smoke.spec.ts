import { test, expect, Page } from '@playwright/test';

// Backend so'rovlariga soxta javob: tizim ochiq, foydalanuvchi kirmagan.
async function mockApi(page: Page) {
  await page.route(/\/api\//, route => {
    const url = route.request().url();
    if (url.includes('/api/status')) return route.fulfill({ json: { siteEnabled: true, appEnabled: true, botEnabled: true } });
    if (url.includes('/api/deploy/latest')) return route.fulfill({ json: { available: false } });
    if (url.includes('/api/plans')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
  });
}

async function noHorizontalOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    // Ko'rinadigan o'ng chegara: overflow yashirilgan ota-elementlar kesib qo'ygan qism hisobga olinmaydi
    // (dekorativ fon dog'lari ataylab chetdan chiqib turadi va kesiladi).
    const visibleRight = (el: Element) => {
      let right = el.getBoundingClientRect().right;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflow !== 'visible') right = Math.min(right, p.getBoundingClientRect().right);
      }
      return right;
    };
    return [...document.querySelectorAll('body *')]
      .filter(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && cs.visibility !== 'hidden' && cs.position !== 'fixed' && cs.pointerEvents !== 'none' && visibleRight(el) > w + 2; })
      .slice(0, 5).map(el => `${el.tagName}.${String((el as HTMLElement).className).slice(0, 60)}`);
  });
  expect(over, `Ekrandan chiqib ketgan elementlar: ${over.join(', ')}`).toEqual([]);
}

test('sayt ochiladi, yuklash ekranida qotib qolmaydi va xatosiz', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('body')).not.toBeEmpty();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('kirish sahifasi: telefon raqam maydoni bor va sahifa yon tomonga siljimaydi', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  // Landing bo'lsa — "Kirish" tugmasi orqali login sahifasiga
  const loginBtn = page.getByRole('button', { name: /kirish|войти/i }).first();
  if (await loginBtn.isVisible().catch(() => false)) await loginBtn.click();
  await expect(page.locator('input[type="tel"], input[inputmode="tel"], input[placeholder*="998"]').first()).toBeVisible({ timeout: 15_000 });
  await noHorizontalOverflow(page);
});

test('ochiq imzolash sahifasi (/sign/...) skroll bo\'ladi va topilmasa xabar chiqaradi', async ({ page }) => {
  await page.route(/\/api\//, r => r.fulfill({ status: 404, json: { error: 'Topilmadi' } }));
  await page.goto('/sign/' + 'a'.repeat(48));
  await expect(page.getByText(/topilmadi|eskirgan/i)).toBeVisible({ timeout: 15_000 });
  await noHorizontalOverflow(page);
});
