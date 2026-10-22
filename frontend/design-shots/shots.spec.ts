import { test, Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results/design');

// Dizayn ko'rigi uchun skrinshotlar — backend soxta (to'liq demo ma'lumotlar bilan).
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
const d = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const users = [
  { _id: 'u1', name: 'Jahongir Sadriddinov', firstName: 'Jahongir', role: 'direktor', phone: '+998900000001', projectIds: ['p1', 'p2'] },
  { _id: 'u2', name: 'Bobur Karimov', firstName: 'Bobur', role: 'prorab', phone: '+998900000002', projectIds: ['p1'] },
  { _id: 'u3', name: 'Vali Aliyev', firstName: 'Vali', role: 'orinbosar', phone: '+998900000003', projectIds: ['p2'] },
  { _id: 'u4', name: 'Sardor Toshev', firstName: 'Sardor', role: 'ishchi', phone: '+998900000004', projectIds: ['p1'] },
];
const objects = [
  { _id: 'p1', name: 'Yunusobod 12-uy', location: 'Toshkent, Yunusobod', foremanId: 'u2', startDate: d(60), status: 'active', budget: 850_000_000, materials: [{ _id: 'm1', name: 'Sement M400', needed: 120, unit: 'qop', price: 65000 }, { _id: 'm2', name: 'Armatura 12mm', needed: 4, unit: 't', price: 9_800_000 }] },
  { _id: 'p2', name: 'Chilonzor savdo markazi', location: 'Toshkent, Chilonzor', foremanId: 'u3', startDate: d(120), status: 'active', budget: 2_400_000_000, materials: [] },
  { _id: 'p3', name: 'Samarqand villa', location: 'Samarqand', foremanId: 'u2', startDate: d(300), status: 'completed', budget: 600_000_000, materials: [] },
];
const tx = (id: string, o: Record<string, unknown>) => ({ _id: id, id, type: 'material', status: 'confirmed', date: d(1), amount: 1_200_000, description: 'Sement 20 qop', createdById: 'u2', projectId: 'p1', companyId: 'c1', ...o });
const txs = [
  tx('t1', { description: 'Sement M400 — 40 qop', amount: 2_600_000, status: 'pending', date: d(0) }),
  tx('t2', { type: 'oylik', description: 'Brigada oyligi — oktabr', amount: 18_500_000, toUserId: 'u4', date: d(1) }),
  tx('t3', { type: 'transport', description: 'Kamaz — qum tashish', amount: 950_000, date: d(2), projectId: 'p2' }),
  tx('t4', { type: 'jihozlar', description: 'Perforator Bosch', amount: 3_400_000, date: d(3), createdById: 'u3', projectId: 'p2' }),
  tx('t5', { type: 'boshqa', description: 'Elektr hisob', amount: 640_000, date: d(5) }),
  tx('i1', { type: 'income', description: 'Mijozdan avans', amount: 150_000_000, date: d(2), createdById: 'u1' }),
  tx('i2', { type: 'income', description: "2-bosqich to'lovi", amount: 90_000_000, date: d(9), createdById: 'u3' }),
];

const aiShift = { id: 'main', name: 'Asosiy smena', objectIds: [], roles: ['ishchi', 'prorab', 'brigadir'], workStart: '08:00', callLeadMin: 0, callTime: '08:00', workdays: [1, 2, 3, 4, 5, 6], lateAfterMin: 15, absentCutoff: '12:00', buttonWaitMin: 10, maxLateMin: 60, skipDates: [], extraWorkDates: [] };
const aiSettings = {
  companyId: 'c1', enabled: true, language: 'uz', voiceName: 'Kore', timezone: 'Asia/Tashkent',
  attendance: { enabled: true, suppressLegacyMorningReminder: true, orinbosarCanEditSchedule: true, shifts: [aiShift] },
  calls: { maxAttemptsPerChannel: 2, backoffMin: [3, 10], ringTimeoutSec: 45, maxDurationSec: 120, assistantMaxDurationSec: 600, companyConcurrency: 3, minGapSec: 20, quietHours: { from: '21:00', to: '07:00' }, companyConsent: true },
  fallbackOrder: ['bot_message', 'telegram_call', 'inapp_call', 'push', 'notify_manager'],
  reminders: { defaultLeadMin: 0, defaultChannels: ['bot_message', 'push'], maxActivePerUser: 50 },
  tools: { byRole: {}, allowOffShiftAssistant: false }, privacy: { recordAudio: false, transcriptRetentionDays: 7, auditRetentionDays: 365 }, version: 3,
};
const aiEmployees = users.slice(1).map((u) => ({ userId: u._id, name: u.name, role: u.role, telegramLinked: true, resolveStatus: 'ok', callConsent: 'granted', optOut: { calls: false, reminders: false, all: false }, disabledChannels: [], scheduleOverride: null, callsAllowed: true }));

async function setup(page: Page, opts: { pageKey: string; dark: boolean; sel?: string }) {
  await page.route(/\/api\//, async (route) => {
    const req = route.request(); const url = req.url(); const m = req.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const ok = (json: unknown) => route.fulfill({ json, headers: CORS });
    if (url.includes('/api/status')) return ok({ siteEnabled: true, appEnabled: true, botEnabled: true });
    if (url.includes('/api/deploy/latest')) return ok({ available: false });
    if (url.includes('/api/attendance/today')) return ok({ status: 'present', checkIn: new Date().toISOString() });
    if (url.includes('/api/admin/subscriptions/my')) return ok({ status: 'active', daysLeft: 30, features: ['multi_currency', 'ai_assistant', 'audit_log', 'reports', 'gps_tracking', 'backup', 'qr_tools'] });
    if (url.includes('/api/ai-voice/admin/settings')) return ok({ settings: aiSettings, editor: { canEditSchedule: true, canEditBossRows: true, canDownloadArchives: true }, status: { aiVoiceEnabled: true, planHasFeature: true, companyActive: true } });
    if (url.includes('/api/ai-voice/admin/employees')) return ok({ employees: aiEmployees });
    if (url.includes('/api/ai-voice/admin/channels/status')) return ok({ bot: { configured: true, webhookSecretConfigured: true }, telegramAccount: { status: 'connected', workerConnected: false, dailyCallCount: 0, dailyCap: 200 } });
    if (url.includes('/api/ai-voice/admin/archives')) return ok({ page: 1, limit: 60, total: 0, items: [] });
    if (url.includes('/api/ai-voice/me/reminders')) return ok({ reminders: [] });
    if (url.includes('/api/ai-voice/me')) return ok({ disabledChannels: [], callConsent: 'granted', optOut: { calls: false, reminders: false, all: false }, quietHours: null, status: { aiActive: true, attendanceEnabled: true, telegramLinked: true, planHasFeature: true } });
    if (url.includes('/api/ai-voice/')) return ok({});
    if (url.includes('/api/company/me')) return ok({ _id: 'c1', name: 'Iris Stroy', ownerId: 'u1' });
    if (/\/api\/users(\?|$)/.test(url)) return ok(users);
    if (/\/api\/objects(\?|$)/.test(url)) return ok(objects);
    if (/\/api\/transactions(\?|$)/.test(url)) return ok(txs);
    if (url.includes('/api/messages') && m === 'GET') return ok([
      { _id: 'msg1', fromUserId: 'u2', toUserId: 'u1', text: 'Sement yetib keldi, 40 qop', timestamp: new Date(Date.now() - 36e5).toISOString(), read: false },
      { _id: 'msg2', fromUserId: 'u3', toUserId: 'u1', text: "Ertaga soat 9 da obyektda bo'laman", timestamp: new Date(Date.now() - 72e5).toISOString(), read: true },
    ]);
    if (m === 'GET') return ok([]);
    return ok({});
  });
  await page.addInitScript((o) => {
    try {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify({ id: 'u1', name: 'Jahongir Sadriddinov', role: 'direktor', phone: '+998900000001', projectIds: ['p1', 'p2'], companyId: 'c1', language: 'uz', isOwner: true }));
      localStorage.setItem('page', o.pageKey);
      if (o.sel) localStorage.setItem('selProjectId', o.sel);
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      localStorage.setItem('erp_themeMode', o.dark ? 'dark' : 'light');
      localStorage.setItem('erp_pinSalt', 'e2e'); localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60'); localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  }, opts);
}

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
