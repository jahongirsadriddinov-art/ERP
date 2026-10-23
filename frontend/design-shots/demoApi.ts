import type { Page } from '@playwright/test';

// Dizayn ko'rigi uchun skrinshotlar — backend soxta (to'liq demo ma'lumotlar bilan).
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
const d = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const users = [
  { _id: 'u1', name: 'Akmal Rasulov', firstName: 'Akmal', role: 'direktor', phone: '+998900000001', projectIds: ['p1', 'p2'] },
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

export async function setup(page: Page, opts: { pageKey: string; dark: boolean; sel?: string; lang?: string }) {
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
    if (url.includes('/api/gps/latest')) return ok(gpsDemo());
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
      localStorage.setItem('currentUser', JSON.stringify({ id: 'u1', name: 'Akmal Rasulov', role: 'direktor', phone: '+998900000001', projectIds: ['p1', 'p2'], companyId: 'c1', language: 'uz', isOwner: true }));
      localStorage.setItem('page', o.pageKey);
      if (o.sel) localStorage.setItem('selProjectId', o.sel);
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', o.lang || 'uz');
      localStorage.setItem('erp_themeMode', o.dark ? 'dark' : 'light');
      localStorage.setItem('erp_pinSalt', 'e2e'); localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60'); localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  }, opts);
}


/** GPS demo: Toshkent bo'ylab ishchilar (haqiqiy mijoz ma'lumoti emas). */
function gpsDemo() {
  const at = new Date(Date.now() - 4 * 60_000).toISOString();
  return [
    { userId: 'u2', lat: 41.3651, lng: 69.2873, accuracy: 12, timestamp: at, source: 'site', battery: 76 },
    { userId: 'u3', lat: 41.2856, lng: 69.2034, accuracy: 18, timestamp: at, source: 'bot_live', battery: 54 },
    { userId: 'u4', lat: 41.3623, lng: 69.2901, accuracy: 9, timestamp: at, source: 'site', battery: 91 },
  ];
}
