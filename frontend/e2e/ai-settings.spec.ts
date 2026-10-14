import { test, expect, Page } from '@playwright/test';

// AI ovozli yordamchi sozlamalari (P8): firma egasi Profil → "AI ovozli yordamchi" → Ish jadvali bo'limida
// ish boshlanishi, hafta kunlari va bayram sanasini o'zgartiradi → Saqlash. Backend soxta (mock):
// PUT /api/ai-voice/admin/settings tanasi to'g'ri ekani tekshiriladi (telefon va kompyuter o'lchamida).

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
  privacy: { recordAudio: false, transcriptRetentionDays: 30, auditRetentionDays: 365 },
  version: 3,
};
const view = (s: any) => ({
  settings: s, editor: { canEditSchedule: true, canEditBossRows: true },
  providers: { gemini: true, openrouter: true, claude: false },
  status: { aiVoiceEnabled: true, planHasFeature: true, companyActive: true },
});

// Service Worker so'rovlarni o'zi yuborsa page.route ularni ushlamaydi (haqiqiy serverga ketardi) — o'chiramiz
test.use({ serviceWorkers: 'block' });

// API boshqa domenda (VITE_API_URL) — token sarlavhasi tufayli brauzer CORS preflight yuboradi
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

async function mockApi(page: Page, puts: any[]) {
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const fulfill = route.fulfill.bind(route);
    route = { ...route, fulfill: (o: any) => fulfill({ ...o, headers: { ...CORS, ...(o.headers || {}) } }) } as any;
    if (url.includes('/api/status')) return route.fulfill({ json: { siteEnabled: true, appEnabled: true, botEnabled: true } });
    if (url.includes('/api/deploy/latest')) return route.fulfill({ json: { available: false } });
    if (url.includes('/api/admin/subscriptions/my')) return route.fulfill({ json: { status: 'active', daysLeft: 30, features: ['ai_assistant'] } });
    if (url.includes('/api/ai-voice/admin/settings')) {
      if (method === 'PUT') {
        const body = req.postDataJSON();
        puts.push(body);
        const sh = { ...shift, ...(body.patch?.attendance?.shifts?.[0] || {}) };
        return route.fulfill({ json: view({ ...settings, attendance: { ...settings.attendance, shifts: [sh] }, version: settings.version + 1 }) });
      }
      return route.fulfill({ json: view(settings) });
    }
    if (url.includes('/api/ai-voice/me')) return route.fulfill({ status: 501, json: { error: 'not_implemented' } });
    if (url.includes('/api/ai-voice/')) return route.fulfill({ json: {} });
    if (method === 'GET') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
}

test('AI sozlamalari: ish jadvalini o\'zgartirib saqlash — PUT tanasi to\'g\'ri', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const puts: any[] = [];
  await mockApi(page, puts);
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify({ id: 'u1', name: 'Egasi', role: 'direktor', phone: '+998900000001', projectIds: [], isOwner: true, companyId: 'c1', language: 'uz' }));
      localStorage.setItem('page', 'profile');
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      // PIN o'rnatilgan va ilova hozirgina faol bo'lgan — qulf ekrani chiqmaydi
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  });
  await page.goto('/');

  // Profil → AI ovozli yordamchi
  const row = page.getByRole('button', { name: /AI ovozli yordamchi/ }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  const panel = page.getByTestId('ai-settings-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Ish jadvali
  await page.getByTestId('ai-tab-schedule').click();
  await expect(page.getByTestId('ai-schedule')).toBeVisible();
  await page.getByTestId('ai-work-start').fill('07:30');
  await expect(page.getByTestId('ai-call-time')).toContainText('07:30');
  await page.getByTestId('ai-wd-6').click();                       // shanbani olib tashlash
  await expect(page.getByTestId('ai-wd-6')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('ai-date-input-skip').fill('2027-03-21');  // Navro'z
  await page.getByTestId('ai-date-add-skip').click();
  await expect(page.getByTestId('ai-date-skip-2027-03-21')).toBeVisible();

  // Saqlash
  await expect(page.getByTestId('ai-save-bar')).toBeVisible();
  await page.getByTestId('ai-save').click();
  await expect.poll(() => puts.length).toBe(1);
  const body = puts[0];
  expect(body.version).toBe(3);
  expect(Object.keys(body.patch)).toEqual(['attendance']);
  expect(Object.keys(body.patch.attendance)).toEqual(['shifts']);
  expect(body.patch.attendance.shifts).toHaveLength(1);
  expect(body.patch.attendance.shifts[0]).toMatchObject({
    id: 'main', workStart: '07:30', callTime: '07:30', workdays: [1, 2, 3, 4, 5], skipDates: ['2027-03-21'], extraWorkDates: [],
  });
  expect(body.patch.timezone).toBeUndefined();
  // Saqlangach o'zgarish paneli yo'qoladi
  await expect(page.getByTestId('ai-save-bar')).toHaveCount(0);

  // Sahifa yon tomonga siljimaydi
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  expect(errors, errors.join('\n')).toEqual([]);
});
