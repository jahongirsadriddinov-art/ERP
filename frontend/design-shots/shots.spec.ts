import { test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results/design');

import { setup } from './demoApi';

const screens = [
  { name: 'dashboard', pageKey: 'dashboard' },
  { name: 'object', pageKey: 'dashboard', sel: 'p1' },
  { name: 'finance', pageKey: 'finance' },
  { name: 'reports', pageKey: 'reports' },
  { name: 'chat', pageKey: 'chat' },
  { name: 'profile', pageKey: 'profile' },
];
const only = process.env.SHOTS?.split(',');
const onlySize = process.env.SIZES?.split(',');
const onlyTheme = process.env.THEMES?.split(',');
const sizes = [{ id: 'phone', w: 390, h: 844, mobile: true }, { id: 'small', w: 360, h: 760, mobile: true }, { id: 'desktop', w: 1366, h: 820, mobile: false }];
for (const s of screens) for (const z of sizes) for (const dark of [false, true]) {
  if (only && !only.includes(s.name)) continue;
  if (onlySize ? !onlySize.includes(z.id) : z.id === 'small') continue;
  if (onlyTheme && !onlyTheme.includes(dark ? 'dark' : 'light')) continue;
  const id = `${s.name}-${z.id}-${dark ? 'dark' : 'light'}`;
  test(id, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: z.w, height: z.h }, isMobile: z.mobile, hasTouch: z.mobile, deviceScaleFactor: z.mobile ? 2 : 1, colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await setup(page, { pageKey: s.pageKey, dark, sel: s.sel });
    await page.goto('/');
    await page.waitForTimeout(3500);
    const sw = await page.evaluate(() => Math.max(...[...document.querySelectorAll('main, body')].map(e => e.scrollWidth)));
    if (sw > z.w + 1) console.log(`!! horizontal overflow ${id}: ${sw}`);
    await page.screenshot({ path: `${OUT}/${id}.png` });
    for (let i = 2; i <= 4; i++) {
      const moved = await page.evaluate((k) => {
        const els = [...document.querySelectorAll('main, main *')].filter(e => e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== 'visible' && getComputedStyle(e).overflowY !== 'hidden');
        const m = els.sort((a, b) => b.clientHeight - a.clientHeight)[0];
        if (!m) return false;
        const before = m.scrollTop;
        m.scrollTop = (k - 1) * (m.clientHeight - 120);
        return m.scrollTop !== before;
      }, i);
      if (!moved) break;
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${id}-${i}.png` });
    }
    await ctx.close();
  });
}

// Sozlamalar bo'limlari (Profil → har bir qator) — 360px va 390px'da toshib chiqish tekshiruvi
for (const w of [360, 390]) for (const dark of [false]) {
  test(`settings-panels-${w}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await setup(page, { pageKey: 'profile', dark });
    await page.goto('/');
    await page.waitForTimeout(3000);
    const n = await page.locator('main .settings-row').count();
    for (let i = 0; i < n; i++) {
      const row = page.locator('main .settings-row').nth(i);
      const label = ((await row.textContent()) || '').trim().slice(0, 24).replace(/[^\w]+/g, '_');
      if (/chiqish|bloklash/i.test(label)) continue;
      await row.click();
      await page.waitForTimeout(900);
      const over = await page.evaluate((vw) => {
        const bad: string[] = [];
        document.querySelectorAll('main *').forEach(el => {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') {
            let p = el.parentElement, clipped = false;
            while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { const pr = p.getBoundingClientRect(); if (pr.right <= vw + 1) { clipped = true; break; } } p = p.parentElement; }
            if (!clipped) bad.push(`${el.tagName}.${String((el as HTMLElement).className).slice(0, 60)} r=${Math.round(r.right)}`);
          }
        });
        const tiny: string[] = [];
        document.querySelectorAll('main *').forEach(el => {
          if (!(el as HTMLElement).innerText || el.children.length) return;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 11 && (el as HTMLElement).getBoundingClientRect().width > 0) tiny.push(`${el.tagName} ${fs}px "${(el as HTMLElement).innerText.slice(0, 20)}"`);
        });
        return { bad: bad.slice(0, 8), tiny: tiny.slice(0, 5) };
      }, w);
      if (over.bad.length) console.log(`!! overflow ${w} ${label}:`, over.bad.join(' | '));
      if (over.tiny.length) console.log(`!! tiny ${w} ${label}:`, over.tiny.join(' | '));
      await page.screenshot({ path: `${OUT}/panel-${w}-${i}-${label}.png`, fullPage: false });
      if (process.env.PANEL_SCROLL && label.includes(process.env.PANEL_SCROLL)) for (let k = 1; k <= 8; k++) {
        const moved = await page.evaluate((kk) => {
          const els = [...document.querySelectorAll('main, main *')].filter(e => e.scrollHeight > e.clientHeight + 40 && !['visible', 'hidden'].includes(getComputedStyle(e).overflowY));
          const m = els.sort((a, b) => b.clientHeight - a.clientHeight)[0]; if (!m) return false;
          const b0 = m.scrollTop; m.scrollTop = kk * (m.clientHeight - 140); return m.scrollTop !== b0;
        }, k);
        if (!moved) break;
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/panel-${w}-${i}-${label}-s${k}.png` });
      }
      const back = page.getByRole('button', { name: /Orqaga|Назад/ }).first();
      if (await back.isVisible().catch(() => false)) await back.click(); else await page.goBack();
      await page.waitForTimeout(500);
    }
    await ctx.close();
  });
}
