import { test, expect, Page } from '@playwright/test';

// AI yordamchi sozlamalari: firma egasi Profil → "AI ovozli yordamchi". Owner 2026-10-16 "soddalashtir": BITTA
// ekran, 3 blok (AI holati, Ish jadvali, Kimga va qanday) + yig'iladigan "Qo'shimcha sozlamalar". Tekshiriladi:
// Beta belgisi; AI miyasi / Limit va xarajat firma UI'da YO'Q; jadval + kanallarni saqlash (PUT tanasi); xodimga
// alohida jadval (PATCH tanasi); skroll — kontent oxirigacha tushadi, oxirgi element pastki menyu ostida qolmaydi. Dasturchi paneli → AI platforma: firma AI'sini yoqish.
// Holat ROST (server o'chiq ≠ firma o'chiq), saqlangandan keyin qayta so'raladi; rolga mos izoh (direktor /
// o'rinbosar / ishchi); shaxsiy sozlamalarda o'chiq tugma sababi. Backend soxta (mock) — telefon va kompyuter o'lchamida.

const shift = {
  id: 'main', name: 'Asosiy smena', objectIds: [], roles: ['ishchi', 'prorab', 'brigadir'], workStart: '08:00', callLeadMin: 0,
  callTime: '08:00', workdays: [1, 2, 3, 4, 5, 6], lateAfterMin: 15, absentCutoff: '12:00', buttonWaitMin: 10, maxLateMin: 60,
  skipDates: [], extraWorkDates: [],
};
const settings = {
  companyId: 'c1', enabled: true, language: 'uz', voiceName: 'Kore', timezone: 'Asia/Tashkent',
  attendance: { enabled: true, suppressLegacyMorningReminder: true, orinbosarCanEditSchedule: true, shifts: [shift] },
  calls: { maxAttemptsPerChannel: 2, backoffMin: [3, 10], ringTimeoutSec: 45, maxDurationSec: 120, assistantMaxDurationSec: 600, companyConcurrency: 3, minGapSec: 20, quietHours: { from: '21:00', to: '07:00' } },
  fallbackOrder: ['bot_message', 'telegram_call', 'inapp_call', 'push', 'notify_manager'],
  reminders: { defaultLeadMin: 0, defaultChannels: ['bot_message', 'push'], maxActivePerUser: 50 },
  tools: { byRole: {}, allowOffShiftAssistant: false },
  provider: { primary: 'gemini_live', fallback: 'gemini_cascade' },
  brain: { provider: 'gemini', fallback: 'openrouter', effort: 'low' },
  limits: { userSessionsPerHour: 6, companyMinutesPerDay: 120, monthlyBudgetUsd: 20, hardStop: true, botMsgsPer10Min: 20, toolCallsPerSession: 30 },
  privacy: { recordAudio: false, transcriptRetentionDays: 7, auditRetentionDays: 365 },
  version: 3,
};
const companyView = (s: any) => { const { brain: _b, provider: _p, limits: _l, ...rest } = s; return rest; };
type Opts = { serverOn?: boolean; boss?: boolean; me?: any; initial?: any };
const view = (s: any, o: Opts = {}) => ({
  settings: companyView(s), editor: { canEditSchedule: true, canEditBossRows: o.boss !== false, canDownloadArchives: o.boss !== false },
  status: { aiVoiceEnabled: o.serverOn !== false, planHasFeature: true, companyActive: true },
});
const employees = Array.from({ length: 45 }, (_, i) => ({
  userId: `u${i + 2}`, name: `Xodim ${i + 1}`, role: i % 5 === 0 ? 'prorab' : 'ishchi', telegramLinked: i % 2 === 0, resolveStatus: 'ok',
  callConsent: i % 3 === 0 ? 'granted' : 'none', optOut: { calls: false, reminders: false, all: false }, disabledChannels: [], scheduleOverride: null,
}));
// Server /platform/companies shakli (platformAdminRoutes.ts)
const companies = [
  { companyId: 'c1', name: 'Jondor Iris Stroy', status: 'ACTIVE', planHasFeature: true, aiEnabled: true, attendanceEnabled: true, monthCostUsdMicros: 4_200_000, monthlyBudgetUsd: 20 },
  { companyId: 'c2', name: 'Alfa Qurilish', status: 'ACTIVE', planHasFeature: true, aiEnabled: false, attendanceEnabled: false, monthCostUsdMicros: 0, monthlyBudgetUsd: 20 },
];
const platformView = (id: string, patch: any = {}) => {
  const c = companies.find((x) => x.companyId === id)!;
  return {
    companyId: id, name: c.name, status: { exists: true, active: true, planHasFeature: true, aiVoiceEnabled: true },
    settings: { ...settings, companyId: id, enabled: c.aiEnabled, ...patch },
    providers: { gemini: true, openrouter: false, claude: false },
    month: { costUsdMicros: c.monthCostUsdMicros, budgetUsd: 20, hardStop: true, exceeded: false },
  };
};

// Service Worker so'rovlarni o'zi yuborsa page.route ularni ushlamaydi (haqiqiy serverga ketardi) — o'chiramiz
test.use({ serviceWorkers: 'block' });

// API boshqa domenda (VITE_API_URL) — token sarlavhasi tufayli brauzer CORS preflight yuboradi
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

type Calls = { puts: any[]; patches: { url: string; body: any }[]; platformPuts: { url: string; body: any }[]; settingsGets: number; saved?: any };
const newCalls = (): Calls => ({ puts: [], patches: [], platformPuts: [], settingsGets: 0 });

async function mockApi(page: Page, calls: Calls, o: Opts = {}) {
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const fulfill = route.fulfill.bind(route);
    route = { ...route, fulfill: (o: any) => fulfill({ ...o, headers: { ...CORS, ...(o.headers || {}) } }) } as any;
    if (url.includes('/api/status')) return route.fulfill({ json: { siteEnabled: true, appEnabled: true, botEnabled: true } });
    if (url.includes('/api/deploy/latest')) return route.fulfill({ json: { available: false } });
    // Ishchi/prorab uchun "Ishga keldim" darvozasi yopilsin — bugun kelgan
    if (url.includes('/api/attendance/today')) return route.fulfill({ json: { status: 'present', checkIn: new Date().toISOString() } });
    if (url.includes('/api/admin/subscriptions/my')) return route.fulfill({ json: { status: 'active', daysLeft: 30, features: ['ai_assistant'] } });
    if (url.includes('/api/ai-voice/admin/settings')) {
      if (method === 'PUT') {
        const body = req.postDataJSON();
        calls.puts.push(body);
        const sh = { ...shift, ...(body.patch?.attendance?.shifts?.[0] || {}) };
        const next = { ...settings, ...(body.patch?.enabled !== undefined ? { enabled: body.patch.enabled } : {}), attendance: { ...settings.attendance, shifts: [sh] }, version: settings.version + 1 };
        calls.saved = next;
        return route.fulfill({ json: view(next, o) });
      }
      calls.settingsGets++;
      return route.fulfill({ json: view(calls.saved || o.initial || settings, o) });
    }
    if (url.includes('/api/ai-voice/admin/employees')) {
      if (method === 'PATCH') {
        const body = req.postDataJSON();
        calls.patches.push({ url, body });
        const id = decodeURIComponent(url.split('/admin/employees/')[1].split('?')[0]);
        return route.fulfill({ json: { employee: { ...employees.find((e) => e.userId === id), ...body } } });
      }
      return route.fulfill({ json: { employees } });
    }
    if (url.includes('/api/ai-voice/admin/channels/status')) {
      return route.fulfill({ json: { bot: { configured: true, webhookSecretConfigured: true }, telegramAccount: { status: 'connected', workerConnected: false, dailyCallCount: 0, dailyCap: 200 } } });
    }
    if (url.includes('/api/ai-voice/admin/archives')) {
      if (o.boss === false) return route.fulfill({ status: 403, json: { error: 'forbidden' } });
      return route.fulfill({ json: { page: 1, limit: 60, total: 1, items: [{ id: 'a1', companyId: 'c1', period: '2026-10-07', part: 1, status: 'done', fileName: 'ai-transcripts-c1-2026-10-07-p1.jsonl.gz', size: 18432, counts: { conversations: 12, events: 140 }, createdAt: '2026-10-15T00:10:00Z' }] } });
    }
    if (url.includes('/api/ai-voice/platform/overview')) {
      return route.fulfill({ json: { aiVoiceEnabled: false, providers: { gemini: true, openrouter: false, claude: false }, enabledCompanies: 1, month: { month: '2026-10', costUsdMicros: 4_200_000 }, archives: { total: 3, pendingDelete: 0, keepInDbDays: 7 }, queue: { running: false } } });
    }
    if (url.includes('/api/ai-voice/platform/companies/')) {
      const id = decodeURIComponent(url.split('/platform/companies/')[1].split('?')[0]);
      if (method === 'PATCH') {
        const body = req.postDataJSON();
        calls.platformPuts.push({ url, body });
        const c = companies.find((x) => x.companyId === id)!;
        if (body.patch?.enabled !== undefined) c.aiEnabled = body.patch.enabled;
        return route.fulfill({ json: platformView(id, { ...body.patch, version: body.version + 1 }) });
      }
      return route.fulfill({ json: platformView(id) });
    }
    if (url.includes('/api/ai-voice/platform/companies')) return route.fulfill({ json: { page: 1, limit: 100, total: companies.length, items: companies } });
    if (url.includes('/api/ai-voice/platform/')) return route.fulfill({ status: 501, json: { error: 'not_implemented' } });
    if (url.includes('/api/ai-voice/me')) {
      if (!o.me) return route.fulfill({ status: 501, json: { error: 'not_implemented' } });
      if (url.includes('/me/reminders')) return route.fulfill({ json: { reminders: [] } });
      return route.fulfill({ json: o.me.prefs });
    }
    if (url.includes('/api/ai-voice/')) return route.fulfill({ json: {} });
    if (method === 'GET') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
}

async function seed(page: Page, user: Record<string, unknown>, pageKey = 'profile') {
  await page.addInitScript(([u, p]) => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify(u));
      localStorage.setItem('page', p as string);
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      // PIN o'rnatilgan va ilova hozirgina faol bo'lgan — qulf ekrani chiqmaydi
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  }, [user, pageKey] as const);
}

const owner = { id: 'u1', name: 'Egasi', role: 'direktor', phone: '+998900000001', projectIds: [], isOwner: true, companyId: 'c1', language: 'uz' };

/** Telefon loyihasida eng tor keng tarqalgan ekran — 390px (iPhone 12–15). */
async function phone390(page: Page, info: { project: { name: string } }) {
  if (info.project.name === 'telefon') await page.setViewportSize({ width: 390, height: 844 });
}

async function openAiSettings(page: Page) {
  await page.goto('/');
  const row = page.getByRole('button', { name: /AI ovozli yordamchi/ }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByTestId('ai-settings-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ai-power')).toBeVisible();
}

/** "Qo'shimcha sozlamalar"ni ochib, ichidagi bitta qatorni ochadi. */
async function openAdvanced(page: Page, key: string) {
  const toggle = page.getByTestId('ai-advanced-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByTestId(`ai-adv-${key}`).click();
  await expect(page.getByTestId(`ai-adv-body-${key}`)).toBeVisible();
}

/** Element turgan skroll konteynerini (yoki oynani) oxirigacha tushiradi. */
async function scrollToEnd(page: Page, testId: string) {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`)!;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) p.scrollTop = p.scrollHeight;
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
  }, testId);
  await page.waitForTimeout(250);
}

/** Element ekranda va ustini hech narsa (pastki menyu, saqlash paneli) yopmagan. */
async function expectReachable(page: Page, testId: string) {
  const ok = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    const r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight || r.top < 0) return `outside: ${Math.round(r.top)}..${Math.round(r.bottom)} / ${window.innerHeight}`;
    const hit = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
    return hit && (el === hit || el.contains(hit)) ? 'ok' : `covered by ${hit?.tagName}.${String((hit as HTMLElement)?.className).slice(0, 50)}`;
  }, testId);
  expect(ok).toBe('ok');
}

const noOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
};

test('AI sozlamalari: bitta ekran, 3 blok — jadval va kanallarni saqlash; AI miyasi/limit yo\'q', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls = newCalls();
  await phone390(page, info);
  await mockApi(page, calls);
  await seed(page, owner);
  await openAiSettings(page);

  // 3 ta asosiy blok + bitta "Qo'shimcha sozlamalar"; eski tablar yo'q
  for (const id of ['ai-power', 'ai-schedule', 'ai-quick-channels', 'ai-advanced-toggle']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId('ai-advanced-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-testid^="ai-tab-"]')).toHaveCount(0);
  await expect(page.getByTestId('ai-status-badge')).toHaveAttribute('data-state', 'on');
  await expect(page.getByTestId('ai-role-help-boss')).toBeVisible();
  // AI miyasi va limit/xarajat firma UI'da yo'q (faqat dasturchi panelida)
  await expect(page.getByText('AI miyasi', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Limit va xarajat', { exact: true })).toHaveCount(0);
  // Telegram qo'ng'irog'i — ROST holat: akkaunt ulangan, lekin qo'ng'iroq xizmati ishlamayapti
  await expect(page.getByTestId('ai-tg-ready')).toHaveAttribute('data-ok', '0');
  await page.screenshot({ path: `test-results/ai-main-${info.project.name}.png`, fullPage: true });

  // Beta belgisi: bosilganda qisqa izoh chiqadi, Esc bilan yopiladi
  const beta = page.getByTestId('ai-settings-panel').getByRole('button', { name: /beta/i }).first();
  await beta.click();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  // 2-blok: ish jadvali
  await page.getByTestId('ai-work-start').fill('07:30');
  await expect(page.getByTestId('ai-call-time')).toContainText('07:30');
  await page.getByTestId('ai-wd-6').click();                       // shanbani olib tashlash
  await expect(page.getByTestId('ai-wd-6')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('ai-date-input-skip').fill('2027-03-21');  // Navro'z
  await page.getByTestId('ai-date-add-skip').click();
  await expect(page.getByTestId('ai-date-skip-2027-03-21')).toBeVisible();

  // 3-blok: ilovada qo'ng'iroqni o'chirib-yoqish (joyi saqlanadi), Telegram qo'ng'irog'ini o'chirish
  await page.getByTestId('ai-ch-inapp_call').click();
  await expect(page.getByTestId('ai-ch-inapp_call')).toHaveAttribute('aria-checked', 'false');
  await page.waitForTimeout(450);                                   // ilova bo'ylab: bir tugmani 0.4 s ichida qayta bosish e'tiborsiz (tapGuard)
  await page.getByTestId('ai-ch-inapp_call').click();
  await expect(page.getByTestId('ai-ch-inapp_call')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('ai-ch-telegram_call').click();
  await expect(page.getByTestId('ai-ch-telegram_call')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('ai-order-line')).not.toContainText('Telegram qo\'ng\'iroq');
  await expect(page.getByTestId('ai-tg-ready')).toHaveCount(0);

  // Saqlash: faqat o'zgargan qismlar, versiya bilan
  await expect(page.getByTestId('ai-save-bar')).toBeVisible();
  await page.screenshot({ path: `test-results/ai-dirty-${info.project.name}.png` });
  await page.getByTestId('ai-save').click();
  await expect.poll(() => calls.puts.length).toBe(1);
  const body = calls.puts[0];
  expect(body.version).toBe(3);
  expect(Object.keys(body.patch).sort()).toEqual(['attendance', 'fallbackOrder']);
  expect(body.patch.fallbackOrder).toEqual(['bot_message', 'inapp_call', 'push', 'notify_manager']);
  expect(body.patch.attendance.shifts[0]).toMatchObject({
    id: 'main', workStart: '07:30', callTime: '07:30', workdays: [1, 2, 3, 4, 5], skipDates: ['2027-03-21'], extraWorkDates: [],
  });
  expect(body.patch.brain).toBeUndefined();
  expect(body.patch.limits).toBeUndefined();
  await expect(page.getByTestId('ai-save-bar')).toHaveCount(0);

  // Qo'shimcha sozlamalar → Tarix: arxiv ro'yxati (server shakli: bitta kun + qism, suhbatlar soni)
  await openAdvanced(page, 'history');
  await expect(page.getByTestId('ai-archive-a1')).toBeVisible();
  await expect(page.getByTestId('ai-archive-a1')).toContainText('12');
  await page.screenshot({ path: `test-results/ai-advanced-${info.project.name}.png`, fullPage: true });

  await noOverflow(page);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('AI sozlamalari: skroll oxirigacha; xodimga alohida jadval', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls = newCalls();
  await phone390(page, info);
  await mockApi(page, calls);
  await seed(page, owner);
  await openAiSettings(page);

  // Asosiy ekran: oxirgi element hech narsa ostida qolmaydi
  await scrollToEnd(page, 'ai-settings-end');
  await expectReachable(page, 'ai-advanced-toggle');

  await openAdvanced(page, 'employees');
  await expect(page.getByTestId('ai-emp-u2')).toBeVisible();
  await expect(page.getByTestId('ai-emp-more')).toBeVisible();          // 45 ta → 30 + "Yana ko'rsatish"
  await scrollToEnd(page, 'ai-emp-more');
  await expectReachable(page, 'ai-emp-more');
  await page.screenshot({ path: `test-results/ai-scroll-end-${info.project.name}.png` });

  await page.getByTestId('ai-emp-more').click();
  await expect(page.getByTestId('ai-emp-u46')).toBeAttached();
  await scrollToEnd(page, 'ai-settings-end');
  await expectReachable(page, 'ai-adv-test');                       // ochiq ro'yxatdan keyin ham oxirgi qatorgacha tushadi
  await page.getByTestId('ai-emp-u46').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expectReachable(page, 'ai-emp-u46');

  // Xodimga alohida jadval: Du, Se, Ch + 07:00
  await page.getByTestId('ai-emp-u2').scrollIntoViewIfNeeded();
  await page.getByTestId('ai-emp-toggle-u2').click();
  await page.getByTestId('ai-emp-default-u2').click();
  for (const d of [4, 5, 6]) await page.getByTestId(`ai-emp-wd-u2-${d}`).click();   // standart Du–Sh dan Pa, Ju, Sh olib tashlanadi
  await page.getByTestId('ai-emp-start-u2').fill('07:00');
  await page.screenshot({ path: `test-results/ai-emp-override-${info.project.name}.png` });
  await page.getByTestId('ai-emp-save-u2').click();
  await expect.poll(() => calls.patches.length).toBe(1);
  expect(calls.patches[0].url).toContain('/admin/employees/u2');
  expect(calls.patches[0].body).toEqual({ scheduleOverride: { weekdays: [1, 2, 3], workStart: '07:00' } });
  await expect(page.getByTestId('ai-emp-u2')).toContainText('07:00');

  // Boshqa qator ochilsa oldingisi yopiladi; "Jadval tafsilotlari" ham oxirigacha ko'rinadi
  await openAdvanced(page, 'schedule');
  await expect(page.getByTestId('ai-adv-body-employees')).toHaveCount(0);
  await scrollToEnd(page, 'ai-settings-end');
  await expectReachable(page, 'ai-max-late');
  await page.screenshot({ path: `test-results/ai-schedule-details-${info.project.name}.png`, fullPage: true });

  await noOverflow(page);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Dasturchi paneli → AI platforma: firma AI\'sini yoqish, limitni saqlash', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls = newCalls();
  await mockApi(page, calls);
  await seed(page, { id: 'd1', name: 'Dasturchi', role: 'dasturchi', phone: '+998900000009', projectIds: [], language: 'uz' }, 'dashboard');
  await page.goto('/');

  const tab = page.getByRole('button', { name: /AI platforma/ }).first();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await expect(page.getByTestId('ai-platform-panel')).toBeVisible();
  // Holat: serverda AI o'chiq — aniq sabab va keyingi qadam (AI_VOICE_ENABLED)
  await expect(page.getByTestId('ai-pf-server')).toContainText('AI_VOICE_ENABLED');
  await expect(page.getByTestId('ai-pf-worker')).toBeVisible();
  await page.screenshot({ path: `test-results/ai-platform-overview-${info.project.name}.png` });
  await page.getByTestId('ai-pf-tab-companies').click();
  await expect(page.getByTestId('ai-pf-company-c1')).toBeVisible();

  await page.getByTestId('ai-pf-enable-c2').click();
  await expect.poll(() => calls.platformPuts.length).toBe(1);
  expect(calls.platformPuts[0].url).toContain('/platform/companies/c2');
  expect(calls.platformPuts[0].body).toEqual({ version: 3, patch: { enabled: true } });
  await expect(page.getByTestId('ai-pf-enable-c2')).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId('ai-pf-edit-c1').click();
  await expect(page.getByTestId('ai-pf-editor-c1')).toBeVisible();
  await page.getByTestId('ai-pf-budget-c1').fill('50');
  await page.screenshot({ path: `test-results/ai-platform-${info.project.name}.png` });
  await page.getByTestId('ai-pf-save-c1').click();
  await expect.poll(() => calls.platformPuts.length).toBe(2);
  expect(calls.platformPuts[1].body).toEqual({ version: 3, patch: { limits: { ...settings.limits, monthlyBudgetUsd: 50 } } });

  // Backend hali tayyor bo'lmagan bo'limlar yumshoq xabar beradi (sahifa yiqilmaydi)
  await page.getByTestId('ai-pf-tab-usage').click();
  await expect(page.getByText(/hali tayyor emas/).first()).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});

test('Holat rost: firmada yoqilgan, server o\'chiq — "To\'xtagan" + sabab; saqlangach qayta so\'raladi', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls = newCalls();
  await phone390(page, info);
  await mockApi(page, calls, { serverOn: false, initial: { ...settings, enabled: false } });
  await seed(page, owner);
  await openAiSettings(page);

  // Firma kaliti o'chiq + server o'chiq — ikkala sabab, "O'chiq"
  await expect(page.getByTestId('ai-status-badge')).toHaveAttribute('data-state', 'off');
  await expect(page.getByTestId('ai-check-server')).toHaveAttribute('data-ok', '0');
  await expect(page.getByTestId('ai-check-company')).toHaveAttribute('data-ok', '0');

  // Yoqish — saqlanmaguncha ogohlantirish
  await page.getByTestId('ai-enabled').click();
  await expect(page.getByTestId('ai-status-pending')).toBeVisible();
  const getsBefore = calls.settingsGets;
  await page.getByTestId('ai-save').click();
  await expect.poll(() => calls.puts.length).toBe(1);
  expect(calls.puts[0].patch).toEqual({ enabled: true });
  await expect.poll(() => calls.settingsGets).toBeGreaterThan(getsBefore);   // saqlangach serverdan qayta o'qildi
  // Endi faqat server sababi qoldi: "O'chiq" emas — "To'xtagan"
  await expect(page.getByTestId('ai-status-badge')).toHaveAttribute('data-state', 'blocked');
  await expect(page.getByTestId('ai-check-company')).toHaveCount(0);
  await expect(page.getByTestId('ai-check-server')).toHaveAttribute('data-ok', '0');
  await expect(page.getByTestId('ai-status-pending')).toHaveCount(0);
  await page.screenshot({ path: `test-results/ai-status-${info.project.name}.png` });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('O\'rinbosar: o\'ziga mos izoh, arxiv faqat direktorda (sababi yozilgan)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls = newCalls();
  await mockApi(page, calls, { boss: false });
  await seed(page, { ...owner, id: 'u9', role: 'orinbosar', isOwner: false });
  await openAiSettings(page);
  await expect(page.getByTestId('ai-role-help-deputy')).toBeVisible();
  await openAdvanced(page, 'history');
  await expect(page.getByTestId('ai-archives-locked')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Mening AI sozlamalarim: ishchiga mos izoh; o\'chiq tugmalar sababini aytadi', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls = newCalls();
  const prefs = {
    disabledChannels: [], callConsent: 'none', optOut: { calls: false, reminders: false, all: true }, quietHours: null,
    status: { aiActive: true, attendanceEnabled: true, telegramLinked: false, planHasFeature: true },
  };
  await mockApi(page, calls, { me: { prefs } });
  await seed(page, { id: 'u5', name: 'Ishchi', role: 'ishchi', phone: '+998900000005', projectIds: [], companyId: 'c1', language: 'uz' });
  await page.goto('/');
  const row = page.getByRole('button', { name: /AI qo'ng'iroqlarim/ }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByTestId('ai-prefs-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ai-role-help-worker')).toBeVisible();
  // "Hammasidan" voz kechilgan — kanallar o'chiq va SABABI yonida yozilgan
  await expect(page.getByTestId('ai-my-ch-push')).toBeDisabled();
  await expect(page.getByTestId('ai-my-ch-push')).toHaveAttribute('title', /Hammasidan/);
  await expect(page.getByTestId('ai-why-channels')).toBeVisible();
  // Telegram ulanmagan — rozilik izohi
  await expect(page.getByTestId('ai-consent-note')).toBeVisible();
  await page.screenshot({ path: `test-results/ai-prefs-${info.project.name}.png`, fullPage: true });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Mening AI sozlamalarim: AI firmada o\'chiq — sabab va keyingi qadam', async ({ page }) => {
  const calls = newCalls();
  const prefs = {
    disabledChannels: [], callConsent: 'granted', optOut: { calls: false, reminders: false, all: false },
    status: { aiActive: false, attendanceEnabled: false, telegramLinked: true, planHasFeature: true },
  };
  await mockApi(page, calls, { me: { prefs } });
  await seed(page, { id: 'u6', name: 'Prorab', role: 'prorab', phone: '+998900000006', projectIds: [], companyId: 'c1', language: 'uz' });
  await page.goto('/');
  await page.getByRole('button', { name: /AI qo'ng'iroqlarim/ }).first().click({ timeout: 20_000 });
  await expect(page.getByTestId('ai-prefs-off')).toContainText('Rahbaringizdan');
  await expect(page.getByTestId('ai-role-help-foreman')).toBeVisible();
  await expect(page.getByTestId('ai-consent-btn')).toBeDisabled();
  await expect(page.getByTestId('ai-consent-btn')).toHaveAttribute('title', /ishlamayapti/);
});
