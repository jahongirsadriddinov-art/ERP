import { test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from './demoApi';

// SMM videolari uchun HAQIQIY mahsulot skrinshotlari (owner 2026-10-23) — faqat demo ma'lumotlar (mijoz ma'lumoti yo'q).
// Ishlatish: npx playwright test -c design-shots smm-shots  → test-results/smm-shots/*.png
// So'ng optimallashtirib: public/smm/shots/<nom>.jpg (720 px eni, JPEG) — commit qilinadi (SMM video/shablonlari ishlatadi).
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results/smm-shots');

const screens = [
  { name: 'dashboard', pageKey: 'dashboard' },
  { name: 'object', pageKey: 'dashboard', sel: 'p1' },
  { name: 'finance', pageKey: 'finance' },
  { name: 'reports', pageKey: 'reports' },
  { name: 'chat', pageKey: 'chat' },
  { name: 'gps', pageKey: 'gps' },
];

for (const s of screens) {
  test(`smm-${s.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'light', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await setup(page, { pageKey: s.pageKey, dark: false, sel: s.sel });
    await page.goto('/');
    await page.waitForTimeout(s.name === 'gps' ? 6000 : 3500);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    await ctx.close();
  });
}
