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

const spawned: any[] = [];
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
    ...spawned.map((p) => ({ id: p.key, name: p.name, kind: p.kind, team: p.team, color: p.color, busy: false, activity: 'idle' })),
  ];
}

const SETUP = {
  codeReady: false, contentReady: true,
  items: [
    { key: 'AGENT_GITHUB_TOKEN', ok: false, where: 'backend', required: true, for: 'code' },
    { key: 'AGENT_GITHUB_REPO', ok: false, where: 'backend', required: true, for: 'code' },
    { key: 'AGENT_CALLBACK_SECRET', ok: false, where: 'backend', required: true, for: 'code' },
    { key: 'AGENT_CALLBACK_URL', ok: true, where: 'backend', required: true, for: 'code' },
    { key: 'CLAUDE_CODE_OAUTH_TOKEN', ok: null, where: 'github', required: true, for: 'code' },
    { key: 'AGENT_CALLBACK_SECRET (GitHub)', ok: null, where: 'github', required: true, for: 'code' },
    { key: 'GEMINI_API_KEY', ok: true, where: 'backend', required: true, for: 'content' },
  ],
};

type Calls = { tasks: any[]; approves: { id: string; body: any }[]; officeGets: number; media?: any[]; stt?: any[]; chats?: any[] };

async function mockApi(page: Page, calls: Calls) {
  const media: any = { yandex: '', tracks: [], cinema: '' };
  // Tashqi vidjetlar (Yandex/YouTube) testda tarmoqqa chiqmasin
  await page.route(/music\.yandex\.ru|youtube\.com|vk\.com|rutube\.ru/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>widget</body></html>' }));
  const smmTasks: any[] = [];
  const bossTasks: any[] = [];
  spawned.length = 0;
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
    if (url.includes('/platform/office/media')) {
      if (method === 'PUT') { const b = req.postDataJSON(); (calls.media ||= []).push(b); Object.assign(media, b); return json({ ok: true, media }); }
      return json(media);
    }
    if (url.includes('/platform/office/transcribe')) { (calls.stt ||= []).push(req.postDataJSON()); return json({ text: 'Nima qilyapsan?' }); }
    if (/\/platform\/agents\/[^/]+\/chat/.test(url)) { (calls.chats ||= []).push({ url, body: req.postDataJSON() }); return json({ reply: 'Haftalik postlar ustida ishlayapman.' }); }
    if (url.includes('/api/ai-voice/platform/office')) { calls.officeGets++; return json({ agents: officeAgents(), generatedAt: new Date().toISOString() }); }
    if (url.includes('/api/ai-voice/platform/agents')) return json({ agents: [...PROFILES, ...spawned], setup: SETUP });
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
      if (body.agentKey === 'manager') {
        const p = { key: 'custom-0a1b2c3d', name: 'Ombor nazorati', kind: 'code', team: 'platform', color: '#22c55e', description: 'Ombor', systemPrompt: 'Sen ombor agentisan', enabled: true, builtIn: false };
        spawned.push(p);
        const st = { id: 'bbbbbbbbbbbbbbbbbbbbbb02', agentKey: 'manager', agentKind: 'content', text: body.text, status: 'done', spawnedKey: p.key, summary: "Yangi agent qo'shildi: Ombor nazorati", items: [], links: [], log: [], plan: [], createdAt: iso(0) };
        bossTasks.unshift(st);
        return json({ ok: true, task: st });
      }
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
      if (key === 'manager') return json({ tasks: [...bossTasks, bossTask] });
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
  const tab = page.getByTestId('dev-tab-office');
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await expect(page.getByTestId('ai-office')).toBeVisible();
}

/** Ofis bitta ekranga sig'adi: sahifa skroli yo'q, ofis bloki ko'rinish oynasi ichida tugaydi. */
async function expectFitsViewport(page: Page) {
  const m = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="ai-office"]') as HTMLElement;
    const r = el.getBoundingClientRect();
    let scrollers = 0;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (p.scrollHeight > p.clientHeight + 2 && (oy === 'auto' || oy === 'scroll')) scrollers++;
    }
    return { sh: document.scrollingElement!.scrollHeight, ih: innerHeight, bottom: r.bottom, scrollers };
  });
  expect(m.sh).toBeLessThanOrEqual(m.ih + 2);
  expect(m.bottom).toBeLessThanOrEqual(m.ih + 1);
  expect(m.scrollers).toBe(0);
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
    await expect.poll(async () => { const b = await canvas.boundingBox(); return Math.min(b?.width || 0, b?.height || 0); }, { timeout: 10_000 }).toBeGreaterThan(260);
    // Band agentlarning ism yorliqlari sahnada
    // Tartib: ismlar odatda yashirin (faqat tanlangan / sichqoncha ustida); "Ismlar" tugmasi — hammasi
    await expect(page.getByTestId('ai-office-label-backend')).toHaveCount(0);
    await page.getByTestId('ai-office-labels').click();
    await expect(page.getByTestId('ai-office-label-backend')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('ai-office-label-tg:aaaaaaaaaaaaaaaaaaaaaaaa')).toContainText('Jasur');
    await page.getByTestId('ai-office-labels').click();
    await expect(page.getByTestId('ai-office-label-backend')).toHaveCount(0);
    // Qo'ng'iroq pufaklari — ko'pi bilan 3 ta
    expect(await page.locator('[data-testid^="ai-office-bubble-"]').count()).toBeLessThanOrEqual(3);
  }
  await expectFitsViewport(page);
  await expect(page.getByTestId('ai-office-reset')).toBeVisible();
  await page.getByTestId('ai-office-reset').click();
  // Yordam chipi — yopiladi va eslab qolinadi
  await expect(page.getByTestId('ai-office-hint')).toBeVisible();
  await page.getByTestId('ai-office-hint-close').click();
  await expect(page.getByTestId('ai-office-hint')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('aiOffice.hint.v2'))).toBe('1');
  // Agentlar ro'yxati (yon panel) — jamoalar bo'yicha, qidiruv bilan
  await expect(page.getByTestId('ai-office-agent-manager')).toContainText('Boshliq');
  await page.getByTestId('ai-office-search').fill('hisob');
  await expect(page.getByTestId('ai-office-agent-reporter')).toBeVisible();
  await expect(page.getByTestId('ai-office-agent-backend')).toHaveCount(0);
  await page.getByTestId('ai-office-search').fill('');
  await expect(page.getByTestId('ai-office-agent-backend')).toContainText('Login API tezlashtirish');
  await expect(page.getByTestId('ai-office-agent-role-prorab')).toContainText("Qo'ng'iroqda");
  await expect(page.getByTestId('ai-office-agent-reporter')).toBeVisible();
  await expect(page.getByTestId('ai-office-stats')).toContainText('Ishlayapti');
  await page.waitForTimeout(2500); // agentlar joylashib olsin, kadr chizilsin
  const scene = page.getByTestId('ai-office-canvas-wrap').or(nowebgl);
  await page.screenshot({ path: `test-results/office/office-${info.project.name}.png` });
  await scene.screenshot({ path: `test-results/office/office-scene-${info.project.name}.png` });

  // Polling — 5 s da qayta so'raladi
  await expect.poll(() => calls.officeGets, { timeout: 12_000 }).toBeGreaterThan(1);

  // SMM agentiga buyruq → natija (postlar, nusxa tugmasi)
  // Ro'yxatdagi qator: nima qilyapti (holat matni)
  await expect(page.getByTestId('ai-office-agent-backend')).toContainText('Kod yozyapti: Login API tezlashtirish');
  await page.getByTestId('ai-office-agent-smm').click();
  const panel = page.getByTestId('ai-office-panel');
  await expect(panel).toBeVisible();
  // Topildi: sahnada ism yorlig'i (ajratilgan) + tafsilotlar
  if (hasCanvas) await expect(page.getByTestId('ai-office-label-smm')).toBeVisible();
  await expect(page.getByTestId('ai-office-panel-status')).toBeVisible();
  await expect(page.getByTestId('ai-office-panel-name')).toHaveText('SMM');
  await page.getByTestId('ai-office-command').fill('Haftalik 2 ta post tayyorla');
  await page.getByTestId('ai-office-send').click();
  await expect.poll(() => calls.tasks.length).toBe(1);
  expect(calls.tasks[0]).toEqual({ agentKey: 'smm', text: 'Haftalik 2 ta post tayyorla' });
  await expect(panel.getByTestId('ai-office-item-0')).toContainText('Smeta 5 daqiqada');
  await expect(panel.getByTestId('ai-office-item-0').getByRole('button', { name: 'Nusxa' })).toBeVisible();
  await expectFitsViewport(page);
  await page.screenshot({ path: `test-results/office/office-smm-${info.project.name}.png` });

  // Boshliq: reja → bitta bandni olib tashlab tasdiqlash
  await page.getByTestId('ai-office-goal').click();
  await expect(page.getByTestId('ai-office-panel-name')).toHaveText('Boshliq');
  await expect(page.getByTestId('ai-office-plan-row-1')).toBeVisible();
  await page.getByTestId('ai-office-plan-row-1').getByRole('button', { name: 'Olib tashlash' }).click();
  await page.getByTestId('ai-office-approve-plan').click();
  await expect.poll(() => calls.approves.length).toBe(1);
  expect(calls.approves[0]).toEqual({ id: 'bbbbbbbbbbbbbbbbbbbbbb01', body: { plan: [{ agentKey: 'smm', text: '3 ta post yoz' }] } });

  // Boshliq yangi agent yonlaydi → ofisda paydo bo'ladi, ochiladi
  await page.getByTestId('ai-office-command').fill('Ombor ishi uchun agent yonla');
  await page.getByTestId('ai-office-send').click();
  await expect.poll(() => calls.tasks.at(-1)).toEqual({ agentKey: 'manager', text: 'Ombor ishi uchun agent yonla' });
  await page.getByTestId('ai-office-open-spawned').click();
  await expect(page.getByTestId('ai-office-panel-name')).toHaveText('Ombor nazorati');
  await page.getByTestId('ai-office-panel-close').click();
  await expect(page.getByTestId('ai-office-agent-custom-0a1b2c3d')).toBeVisible();

  // Code agenti — sozlanmagan: sozlash ro'yxati (sir nomlari) ko'rinadi
  await page.getByTestId('ai-office-agent-backend').click();
  await expect(page.getByTestId('ai-office-setup')).toContainText('AGENT_GITHUB_TOKEN');
  await expect(page.getByTestId('ai-office-setup')).toContainText('CLAUDE_CODE_OAUTH_TOKEN');
  await page.screenshot({ path: `test-results/office/office-backend-${info.project.name}.png` });

  // Rol yordamchisi buyruq olmaydi
  await page.getByTestId('ai-office-panel-close').click();
  await page.getByTestId('ai-office-agent-role-direktor').click();
  await expect(page.getByTestId('ai-office-command')).toHaveCount(0);

  // Gorizontal skroll yo'q
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('AI ofis: "Ofisga kirish" — yurish rejimi, agent oldiga borib buyruq, o\'z kompyuteridan Boshliqqa buyruq', async ({ page }, info) => {
  test.setTimeout(200_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls: Calls = { tasks: [], approves: [], officeGets: 0 };
  await mockApi(page, calls);
  await seed(page);
  await openOffice(page);
  const enter = page.getByTestId('ai-office-enter');
  if (!(await enter.isVisible().catch(() => false))) { test.skip(true, "WebGL yo'q — yurish rejimi mavjud emas"); return; }
  await enter.click();
  const walk = page.getByTestId('ai-office-walk');
  await expect(walk).toBeVisible();
  // To'liq ekran headless'da bo'lmasligi mumkin — baribir butun oynani egallaydi
  const box = await walk.boundingBox();
  const vp = page.viewportSize()!;
  expect(Math.round(box!.width)).toBe(vp.width);
  expect(Math.round(box!.height)).toBe(vp.height);
  await expect(page.locator('[data-testid="ai-office-walk"] canvas')).toBeVisible({ timeout: 30_000 });
  if (info.project.name === 'telefon') {
    // Telefon tik holatda — "yotqizing" oynasi (orientation.lock headless'da yo'q)
    await expect(page.getByTestId('ai-office-rotate')).toBeVisible();
    await page.getByTestId('ai-office-rotate-skip').click();
    await expect(page.getByTestId('ai-office-joystick')).toBeVisible();
  }

  // Agent oldiga borish (yo'l topib yuradi) → "Buyruq berish" → panel
  await page.getByTestId('ai-office-goto').click();
  await page.getByTestId('ai-office-goto-search').fill('SMM');
  await page.getByTestId('ai-office-goto-agent-smm').click();
  const act = page.getByTestId('ai-office-interact');
  await expect(act).toContainText('SMM', { timeout: 45_000 });
  await page.screenshot({ path: `test-results/office/office-walk-${info.project.name}.png` });
  await act.click();
  await expect(page.getByTestId('ai-office-walk-panel').getByTestId('ai-office-panel-name')).toHaveText('SMM');
  await page.getByTestId('ai-office-walk-panel').getByTestId('ai-office-panel-close').click();

  // O'z kompyuteriga o'tirish → Claude → Boshliqqa buyruq
  await page.getByTestId('ai-office-goto').click();
  await page.getByTestId('ai-office-goto-place-computer').click();
  await expect(act).toContainText('Kompyuter', { timeout: 45_000 });
  await act.click();
  const pc = page.getByTestId('ai-office-pc');
  await expect(pc).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `test-results/office/office-pc-${info.project.name}.png` });
  await page.getByTestId('ai-office-pc-input').fill('Yangi mijozlar uchun aksiya rejasi');
  await page.getByTestId('ai-office-pc-send').click();
  await expect.poll(() => calls.tasks.at(-1)).toEqual({ agentKey: 'manager', text: 'Yangi mijozlar uchun aksiya rejasi' });
  await expect(page.getByTestId('ai-office-pc-tasks')).toContainText('Yangi mijozlar jalb qilish');
  // O'yin ilovasi (Pong) — TV bilan bir xil canvas
  await page.getByTestId('ai-office-pc-app-game').click();
  await expect(page.getByTestId('ai-office-game').locator('canvas')).toBeVisible();
  await page.getByTestId('ai-office-pc-close').click();
  await expect(pc).toHaveCount(0);

  await page.getByTestId('ai-office-exit').click();
  await expect(walk).toHaveCount(0);
  await expect(page.getByTestId('ai-office')).toBeVisible();
  await expectFitsViewport(page);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('AI ofis: ovoz, musiqa (Yandex havola), kino havolasi va agent bilan ovozli suhbat (soxta mikrofon)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls: Calls = { tasks: [], approves: [], officeGets: 0 };
  await mockApi(page, calls);
  await seed(page);
  // Soxta mikrofon: MediaRecorder 0.4 s jim WAV qaytaradi
  await page.addInitScript(() => {
    const wav = () => {
      const n = 6400, b = new DataView(new ArrayBuffer(44 + n * 2));
      const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
      b.setUint32(24, 16000, true); b.setUint32(28, 32000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
      return new Blob([b.buffer], { type: 'audio/wav' });
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    (window as any).MediaRecorder = class {
      state = 'inactive'; mimeType = 'audio/wav'; ondataavailable: any; onstop: any;
      constructor(public stream: any) {}
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: wav() }); setTimeout(() => this.onstop?.(), 0); }
    };
  });
  await openOffice(page);

  // Ovoz: standart — o'chiq, eslab qolinadi
  const mute = page.getByTestId('ai-office-mute').first();
  await expect(mute).toHaveAttribute('aria-pressed', 'false');

  // Musiqa: noto'g'ri havola — xato; to'g'ri — saqlanadi (PUT), ovoz o'chiq — vidjet yuklanmaydi
  await page.getByTestId('ai-office-media-open').first().click();
  const mp = page.getByTestId('ai-office-media');
  await expect(mp).toBeVisible();
  await page.getByTestId('ai-office-yandex').fill('https://music.yandex.ru.evil.com/album/1');
  await expect(page.getByTestId('ai-office-yandex-invalid')).toBeVisible();
  await expect(page.getByTestId('ai-office-yandex-save')).toBeDisabled();
  await page.getByTestId('ai-office-yandex').fill('https://music.yandex.ru/album/123/track/456');
  await page.getByTestId('ai-office-yandex-save').click();
  await expect.poll(() => calls.media?.at(-1)).toEqual({ yandex: 'https://music.yandex.ru/album/123/track/456' });
  await expect(page.getByTestId('ai-office-yandex-frame')).toHaveCount(0);
  await mp.getByTestId('ai-office-mute').click();
  await expect(page.getByTestId('ai-office-yandex-frame')).toHaveAttribute('src', 'https://music.yandex.ru/iframe/#track/456/123');
  expect(await page.evaluate(() => localStorage.getItem('aiOffice.muted'))).toBe('0');
  await mp.getByTestId('ai-office-mute').click();
  expect(await page.evaluate(() => localStorage.getItem('aiOffice.muted'))).toBe('1');

  // Kino: Kinopoisk — faqat "ochish" (sababi bilan); YouTube — tayyor
  await page.getByTestId('ai-office-media-tab-cinema').click();
  await page.getByTestId('ai-office-cinema-url').fill('https://hd.kinopoisk.ru/film/abc');
  await page.getByTestId('ai-office-cinema-save').click();
  await expect(page.getByTestId('ai-office-kinopoisk')).toContainText('DRM');
  await page.getByTestId('ai-office-cinema-url').fill('https://youtu.be/dQw4w9WgXcQ');
  await page.getByTestId('ai-office-cinema-save').click();
  await expect(page.getByTestId('ai-office-cinema-ok')).toContainText('YouTube');
  expect(calls.media?.at(-1)).toEqual({ cinema: 'https://youtu.be/dQw4w9WgXcQ' });
  await mp.getByRole('button', { name: 'Yopish' }).click();

  // Agent bilan ovozli suhbat: 🎤 → yozish → to'xtatish → matn (transkripsiya) → javob
  await page.getByTestId('ai-office-agent-smm').click();
  await page.getByTestId('ai-office-mic').click();
  await expect(page.getByTestId('ai-office-mic')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('ai-office-mic').click();
  await expect(page.getByTestId('ai-office-chat-reply')).toHaveText('Haftalik postlar ustida ishlayapman.');
  expect(calls.stt?.[0].audio.length).toBeGreaterThan(1000);
  expect(calls.chats?.[0].url).toContain('/platform/agents/smm/chat');
  expect(calls.chats?.[0].body).toMatchObject({ text: 'Nima qilyapsan?', history: [] });
  // Yozib so'rash ham ishlaydi; "buyruq qilib yuborish" — vazifa
  await page.getByTestId('ai-office-chat-input').fill('2 ta post tayyorla');
  await page.getByTestId('ai-office-chat-to-task').click();
  await expect.poll(() => calls.tasks.at(-1)).toEqual({ agentKey: 'smm', text: '2 ta post tayyorla' });
  expect(errors, errors.join('\n')).toEqual([]);
});
