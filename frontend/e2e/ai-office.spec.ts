import { test, expect, Page } from '@playwright/test';

// Dasturchi paneli → AI platforma → "AI ofis" (owner 2026-10-22): 3D ofis (WebGL canvas) ochiladi, agentlar ro'yxati
// va ism yorliqlari ko'rinadi; agentni bosib buyruq beriladi (POST tanasi), natija (postlar) nusxa tugmasi bilan
// ko'rinadi; Boshliq rejasi tasdiqlanadi; code agentida sozlash ro'yxati. Backend soxta — telefon va kompyuter o'lchamida.
// Skrinshotlar: test-results/office/ (commit qilinmaydi).

// PWA service worker so'rovlarni o'zi yuborsa page.route ularni ushlamaydi — testda SW o'chiriladi
test.use({ serviceWorkers: 'block' });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
const iso = (agoSec: number) => new Date(Date.now() - agoSec * 1000).toISOString();

const PROFILES = [
  ['manager', 'Boshliq', 'content', 'lead', '#D97757'],
  ['backend', 'Backend', 'code', 'platform', '#6366f1'], ['frontend', 'Frontend', 'code', 'platform', '#06b6d4'], ['database', 'Database', 'code', 'platform', '#10b981'],
  ['designer', 'Dizayner', 'code', 'platform', '#ec4899'], ['devpanel', 'Dasturchi paneli', 'code', 'platform', '#3b82f6'], ['payments', "To'lovlar & obuna", 'code', 'platform', '#0d9488'],
  ['feature', 'Yangi funksiya', 'code', 'platform', '#7c3aed'],
  ['mobile', 'Mobil ilova & sayt', 'code', 'apps', '#f59e0b'], ['windows', 'Windows ilova', 'code', 'apps', '#2563eb'], ['android', 'Android ilova', 'code', 'apps', '#16a34a'],
  ['miniapp', 'Telegram Mini App', 'code', 'apps', '#0ea5e9'], ['landing', 'Landing & SEO', 'code', 'apps', '#f97316'],
  ['ai', 'AI agent', 'code', 'ai', '#a855f7'], ['erpbot', 'Telegram ERP bot', 'code', 'ai', '#38bdf8'], ['devbot', 'Dasturchi boti', 'code', 'ai', '#14b8a6'], ['tgworker', "Telegram qo'ng'iroq worker", 'code', 'ai', '#8b5cf6'],
  ['security', 'Xavfsizlik', 'code', 'ops', '#ef4444'], ['qa', 'Test (QA)', 'code', 'ops', '#84cc16'], ['perf', 'Tezlik & optimizatsiya', 'code', 'ops', '#facc15'],
  ['devops', 'DevOps & deploy', 'code', 'ops', '#64748b'], ['translator', 'Tarjimon', 'code', 'ops', '#d946ef'], ['analytics', "Ma'lumot tahlilchisi", 'code', 'ops', '#22c55e'],
  ['smm', 'SMM', 'content', 'growth', '#fb923c'], ['marketing', 'Marketing', 'content', 'growth', '#eab308'], ['support', "Mijozlarni qo'llab-quvvatlash", 'content', 'growth', '#06b6d4'],
  ['docs', "Hujjatlar & qo'llanma", 'content', 'growth', '#a3a3a3'], ['billing', 'Tariflar & obuna boshqaruvchisi', 'content', 'growth', '#14b8a6'], ['reporter', 'Hisobotchi', 'content', 'growth', '#f43f5e'],
  ['role-direktor', 'Direktor yordamchisi', 'role', 'assistants', '#0ea5e9'], ['role-orinbosar', "O'rinbosar yordamchisi", 'role', 'assistants', '#8b5cf6'],
  ['role-prorab', 'Prorab yordamchisi', 'role', 'assistants', '#22c55e'], ['role-brigadir', 'Brigadir yordamchisi', 'role', 'assistants', '#f43f5e'], ['role-ishchi', 'Ishchi yordamchisi', 'role', 'assistants', '#64748b'],
].map(([key, name, kind, team, color]) => ({ key, name, kind, team, color, description: `${name} tavsifi`, systemPrompt: `Sen ${name}`, enabled: true, builtIn: true }));

function officeAgents() {
  const busy: Record<string, any> = {
    backend: { busy: true, activity: 'task', since: iso(320), task: { id: 't-be', status: 'running', text: 'Login API tezlashtirish' } },
    frontend: { busy: true, activity: 'task', since: iso(120), task: { id: 't-fe', status: 'running', text: 'Tugmalar dizayni' } },
    'role-prorab': { busy: true, activity: 'call', since: iso(40) },
    'role-direktor': { busy: true, activity: 'chat', since: iso(20) },
    feature: { busy: false, activity: 'review', since: iso(60), task: { id: 't-ft', status: 'review', text: "Ombor qoldig'i" } },
    qa: { busy: false, activity: 'idle', task: { id: 't-qa', status: 'failed', text: 'e2e', finishedAt: iso(10) } },
    smm: { busy: false, activity: 'idle', task: { id: 't-smm', status: 'done', text: 'Postlar', finishedAt: iso(5) } },
  };
  return [
    ...PROFILES.map((p) => ({ id: p.key, name: p.name, kind: p.kind, team: p.team, color: p.color, busy: false, activity: 'idle', ...(p.kind === 'role' ? { role: p.key.slice(5) } : {}), ...(busy[p.key] || {}) })),
    { id: 'tg:aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Jasur', kind: 'tg', team: 'ai', color: '#D97757', busy: true, activity: 'call', since: iso(75), status: 'connected' },
    { id: 'tg:bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Sarvar', kind: 'tg', team: 'ai', color: '#D97757', busy: false, activity: 'idle', status: 'connected' },
  ];
}

const SETUP = {
  codeReady: false, contentReady: true,
  items: [
    { key: 'AGENT_GITHUB_TOKEN', ok: false, where: 'backend', required: true, for: 'code' },
    { key: 'AGENT_GITHUB_REPO', ok: false, where: 'backend', required: true, for: 'code' },
    { key: 'AGENT_CALLBACK_SECRET', ok: false, where: 'backend', required: true, for: 'code' },
    { key: 'AGENT_CALLBACK_URL', ok: true, where: 'backend', required: true, for: 'code' },
    { key: 'ANTHROPIC_API_KEY', ok: null, where: 'github', required: true, for: 'code' },
    { key: 'AGENT_CALLBACK_SECRET (GitHub)', ok: null, where: 'github', required: true, for: 'code' },
    { key: 'GEMINI_API_KEY', ok: true, where: 'backend', required: true, for: 'content' },
  ],
};

type Calls = { tasks: any[]; approves: { id: string; body: any }[]; officeGets: number };

async function mockApi(page: Page, calls: Calls) {
  const smmTasks: any[] = [];
  const bossTask = {
    id: 'bbbbbbbbbbbbbbbbbbbbbb01', agentKey: 'manager', agentKind: 'content', text: 'Yangi mijozlar jalb qilish', status: 'review', items: [], links: [], log: [{ at: iso(30), text: 'Reja tayyor' }],
    plan: [{ agentKey: 'smm', text: '3 ta post yoz' }, { agentKey: 'landing', text: 'Bosh sahifaga taklif bloki' }], createdAt: iso(60),
  };
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (body: any, status = 200) => route.fulfill({ status, headers: CORS, json: body });
    if (url.includes('/api/status')) return json({ siteEnabled: true, appEnabled: true, botEnabled: true });
    if (url.includes('/api/deploy/latest')) return json({ available: false });
    if (url.includes('/api/ai-voice/platform/office')) { calls.officeGets++; return json({ agents: officeAgents(), generatedAt: new Date().toISOString() }); }
    if (url.includes('/api/ai-voice/platform/agents')) return json({ agents: PROFILES, setup: SETUP });
    if (url.match(/\/platform\/agent-tasks\/[^/]+\/approve/)) {
      const id = url.split('/agent-tasks/')[1].split('/')[0];
      const body = req.postDataJSON();
      calls.approves.push({ id, body });
      Object.assign(bossTask, { status: 'running', plan: body.plan.map((p: any, i: number) => ({ ...p, taskId: `child${i}` })) });
      return json({ ok: true, task: bossTask });
    }
    if (url.includes('/platform/agent-tasks') && method === 'POST') {
      const body = req.postDataJSON();
      calls.tasks.push(body);
      const t = {
        id: `cccccccccccccccccccccc${String(calls.tasks.length).padStart(2, '0')}`, agentKey: body.agentKey, agentKind: 'content', text: body.text, status: 'done',
        summary: '2 ta tayyor post', items: [{ title: 'Smeta 5 daqiqada', text: "QurilishERP bilan smetani 5 daqiqada tuzing.", hashtags: ['#qurilish', '#erp'] }, { title: 'Prorab uchun', text: 'Ishchilar davomati — bitta tugma.' }],
        links: [], log: [{ at: iso(1), text: 'Tayyor — 2 ta matn' }], plan: [], createdAt: iso(1), finishedAt: iso(0),
      };
      smmTasks.unshift(t);
      return json({ ok: true, task: t });
    }
    if (url.includes('/platform/agent-tasks')) {
      const u = new URL(url);
      const key = u.searchParams.get('agentKey');
      if (key === 'smm') return json({ tasks: smmTasks });
      if (key === 'manager') return json({ tasks: [bossTask] });
      if (!key) return json({ tasks: [bossTask, ...smmTasks] });
      return json({ tasks: [] });
    }
    if (url.includes('/api/ai-voice/platform/overview')) return json({ aiVoiceEnabled: true, providers: {}, enabledCompanies: 0, month: { month: '2026-10', costUsdMicros: 0 }, archives: {}, queue: {} });
    if (url.includes('/api/ai-voice/platform/')) return json({ error: 'not_implemented' }, 501);
    if (url.includes('/api/ai-voice/')) return json({});
    if (method === 'GET') return json([]);
    return json({});
  });
}

async function seed(page: Page) {
  const u = { id: 'd1', name: 'Dasturchi', role: 'dasturchi', phone: '+998900000009', projectIds: [], language: 'uz' };
  await page.addInitScript((user) => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify(user));
      localStorage.setItem('page', 'dashboard');
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  }, u);
}

async function openOffice(page: Page) {
  await page.goto('/');
  const tab = page.getByRole('button', { name: /AI platforma/ }).first();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await page.getByTestId('ai-pf-tab-office').click();
  await expect(page.getByTestId('ai-office')).toBeVisible();
}

test('AI ofis: 3D sahna, agentlar, buyruq va natija (owner 2026-10-22)', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls: Calls = { tasks: [], approves: [], officeGets: 0 };
  await mockApi(page, calls);
  await seed(page);
  await openOffice(page);

  // Canvas chiziladi (WebGL) yoki — WebGL bo'lmasa — tushunarli xabar
  const canvas = page.locator('[data-testid="ai-office-canvas-wrap"] canvas');
  const nowebgl = page.getByTestId('ai-office-nowebgl');
  await expect(canvas.or(nowebgl)).toBeVisible({ timeout: 30_000 });
  const hasCanvas = await canvas.isVisible();
  if (hasCanvas) {
    // r3f o'lchamni ResizeObserver bilan beradi — biroz kutiladi
    await expect.poll(async () => { const b = await canvas.boundingBox(); return Math.min(b?.width || 0, b?.height || 0); }, { timeout: 10_000 }).toBeGreaterThan(330);
    // Band agentlarning ism yorliqlari sahnada
    await expect(page.getByTestId('ai-office-label-backend')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('ai-office-label-tg:aaaaaaaaaaaaaaaaaaaaaaaa')).toContainText('Jasur');
  }
  // Agentlar ro'yxati (kartalar) — jamoalar bo'yicha
  await expect(page.getByTestId('ai-office-agent-manager')).toContainText('Boshliq');
  await expect(page.getByTestId('ai-office-agent-backend')).toContainText('Login API tezlashtirish');
  await expect(page.getByTestId('ai-office-agent-role-prorab')).toContainText("Qo'ng'iroqda");
  await expect(page.getByTestId('ai-office-agent-reporter')).toBeVisible();
  await expect(page.getByTestId('ai-office-stats')).toContainText('Ishlayapti');
  await page.waitForTimeout(2500); // agentlar joylashib olsin, kadr chizilsin
  const scene = page.getByTestId('ai-office-canvas-wrap').or(nowebgl);
  await scene.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/office/office-${info.project.name}.png` });
  await scene.screenshot({ path: `test-results/office/office-scene-${info.project.name}.png` });

  // Polling — 5 s da qayta so'raladi
  await expect.poll(() => calls.officeGets, { timeout: 12_000 }).toBeGreaterThan(1);

  // SMM agentiga buyruq → natija (postlar, nusxa tugmasi)
  await page.getByTestId('ai-office-agent-smm').click();
  const panel = page.getByTestId('ai-office-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('ai-office-panel-name')).toHaveText('SMM');
  await page.getByTestId('ai-office-command').fill('Haftalik 2 ta post tayyorla');
  await page.getByTestId('ai-office-send').click();
  await expect.poll(() => calls.tasks.length).toBe(1);
  expect(calls.tasks[0]).toEqual({ agentKey: 'smm', text: 'Haftalik 2 ta post tayyorla' });
  await expect(panel.getByTestId('ai-office-item-0')).toContainText('Smeta 5 daqiqada');
  await expect(panel.getByTestId('ai-office-item-0').getByRole('button', { name: 'Nusxa' })).toBeVisible();
  await page.screenshot({ path: `test-results/office/office-smm-${info.project.name}.png` });

  // Boshliq: reja → bitta bandni olib tashlab tasdiqlash
  await page.getByTestId('ai-office-goal').click();
  await expect(page.getByTestId('ai-office-panel-name')).toHaveText('Boshliq');
  await expect(page.getByTestId('ai-office-plan-row-1')).toBeVisible();
  await page.getByTestId('ai-office-plan-row-1').getByRole('button', { name: 'Olib tashlash' }).click();
  await page.getByTestId('ai-office-approve-plan').click();
  await expect.poll(() => calls.approves.length).toBe(1);
  expect(calls.approves[0]).toEqual({ id: 'bbbbbbbbbbbbbbbbbbbbbb01', body: { plan: [{ agentKey: 'smm', text: '3 ta post yoz' }] } });

  // Code agenti — sozlanmagan: sozlash ro'yxati (sir nomlari) ko'rinadi
  await page.getByTestId('ai-office-agent-backend').click();
  await expect(page.getByTestId('ai-office-setup')).toContainText('AGENT_GITHUB_TOKEN');
  await expect(page.getByTestId('ai-office-setup')).toContainText('ANTHROPIC_API_KEY');
  await page.screenshot({ path: `test-results/office/office-backend-${info.project.name}.png` });

  // Rol yordamchisi buyruq olmaydi
  await page.getByTestId('ai-office-agent-role-direktor').click();
  await expect(page.getByTestId('ai-office-command')).toHaveCount(0);

  // Gorizontal skroll yo'q
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors, errors.join('\n')).toEqual([]);
});
