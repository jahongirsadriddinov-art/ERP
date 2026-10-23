import { test, expect, Page } from '@playwright/test';

// Dasturchi paneli → "Bot dizayni" (owner 2026-10-22): emoji paketini qo'shish, tugma matni/rangi/premium emoji,
// jonli ko'rinish, "AI bilan bezash" → qoralama → qo'llash, saqlash (PUT tanasi). Backend soxta (mock).

test.use({ serviceWorkers: 'block' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

const catalog = [
  { key: 'kb_chat', group: 'main', kind: 'reply', meaning: 'chat', defaults: { uz: '💬 Chat', ru: '💬 Чат' } },
  { key: 'kb_addExpense', group: 'main', kind: 'reply', meaning: 'expense', defaults: { uz: "➕ Chiqim qo'shish", ru: '➕ Добавить расход' } },
  { key: 'kb_objects', group: 'admin', kind: 'reply', meaning: 'objects', defaults: { uz: '🏗 Obyektlar', ru: '🏗 Объекты' } },
  { key: 'confirmYes', group: 'inline', kind: 'inline', meaning: 'yes', defaults: { uz: '✅ Ha', ru: '✅ Да' } },
];
const commandsCatalog = [
  { command: 'start', meaning: 'start', defaults: { uz: 'Botni boshlash', ru: 'Запуск бота' } },
  { command: 'res', meaning: 'reset', defaults: { uz: 'Botni yangilash', ru: 'Обновить бота' } },
];
const pack = { name: 'BuildPack', title: 'Qurilish', count: 2, stickers: [{ id: '1001', emoji: '✅' }, { id: '1003', emoji: '💬' }] };
// 1x1 shaffof PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

type State = { config: any; packs: any[]; draft: any; puts: any[]; posts: string[] };

async function mockApi(page: Page, st: State) {
  const view = () => ({ catalog, commandsCatalog, messageEmojiCandidates: ['✅', '💬'], config: st.config, packs: st.packs, draft: st.draft, commandsError: null });
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (j: any, status = 200) => route.fulfill({ status, headers: CORS, json: j });
    if (url.includes('/api/bot-ui-sticker/')) return route.fulfill({ status: 200, headers: CORS, contentType: 'image/png', body: PNG });
    if (url.includes('/api/dev/bot-ui')) {
      const path = url.split('/api/dev/bot-ui')[1].split('?')[0];
      if (method === 'GET') return json(view());
      if (method === 'PUT') { const b = req.postDataJSON(); st.puts.push(b); st.config = { ...st.config, ...b }; return json(view()); }
      st.posts.push(`${method} ${path}`);
      if (path === '/packs' && method === 'POST') { st.packs = [pack]; return json(view()); }
      if (path === '/auto-decorate') {
        st.draft = { source: 'ai', createdAt: new Date().toISOString(), buttons: { confirmYes: { iconCustomEmojiId: '1001', style: 'success' }, kb_chat: { iconCustomEmojiId: '1003' } }, messageEmoji: { '✅': '1001' } };
        // fonda ishlaydi: POST darhol "decorating", qoralama keyingi GET'da keladi
        return json({ ...view(), draft: null, decorating: true });
      }
      if (path === '/draft/apply') {
        st.config = { ...st.config, buttons: { ...st.config.buttons, confirmYes: { iconCustomEmojiId: '1001', style: 'success' }, kb_chat: { ...(st.config.buttons.kb_chat || {}), iconCustomEmojiId: '1003' } }, messageEmoji: [{ emoji: '✅', id: '1001' }] };
        st.draft = null;
        return json(view());
      }
      return json(view());
    }
    if (url.includes('/api/status')) return json({ siteEnabled: true, appEnabled: true, botEnabled: true });
    if (url.includes('/api/deploy/latest')) return json({ available: false });
    if (method === 'GET') return json([]);
    return json({});
  });
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify({ id: 'd1', name: 'Dasturchi', role: 'dasturchi', phone: '+998900000009', projectIds: [], language: 'uz' }));
      localStorage.setItem('page', 'dashboard');
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  });
}

test('Dasturchi paneli → Bot dizayni: paket, matn/rang/emoji, AI qoralama, saqlash', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const st: State = { config: { buttons: {}, messageEmoji: [], messageEmojiEnabled: true, stripEmojiWhenIcon: true, commands: [] }, packs: [], draft: null, puts: [], posts: [] };
  await mockApi(page, st);
  await seed(page);
  await page.goto('/');

  const tab = page.getByRole('button', { name: /Bot dizayni/ }).first();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await expect(page.getByTestId('botui-panel')).toBeVisible({ timeout: 15_000 });
  // Paket yo'q — AI tugmasi o'chiq
  await expect(page.getByTestId('botui-ai')).toBeDisabled();

  await page.getByTestId('botui-pack-input').fill('https://t.me/addemoji/BuildPack');
  await page.getByTestId('botui-packs').getByRole('button', { name: "Qo'shish" }).click();
  await expect(page.getByTestId('botui-pack-BuildPack')).toContainText('Qurilish');
  expect(st.posts).toContain('POST /packs');

  // Matn + rang + emoji → jonli ko'rinish
  await page.getByTestId('botui-text-uz-kb_chat').fill('💬 Suhbat');
  await page.getByTestId('botui-style-kb_chat').selectOption('primary');
  await page.getByTestId('botui-pick-kb_chat').click();
  await page.getByTestId('botui-sticker-1003').click();
  const preview = page.getByTestId('botui-preview');
  await expect(preview).toContainText('Suhbat');
  await expect(preview).not.toContainText('💬 Suhbat'); // ikonka bor → oddiy emoji olib tashlanadi
  await expect(preview.locator('img').first()).toBeVisible();

  // AI bilan bezash → qoralama → qo'llash (matn tahriri saqlanib qoladi)
  await page.getByTestId('botui-ai').click();
  await expect(page.getByTestId('botui-decorating')).toBeVisible();
  await expect(page.getByTestId('botui-draft')).toContainText('2 ta tugma');
  await page.getByTestId('botui-draft-apply').click();
  await expect(page.getByTestId('botui-draft')).toHaveCount(0);
  expect(st.posts).toEqual(expect.arrayContaining(['POST /auto-decorate', 'POST /draft/apply']));
  // saqlanmagan tahrirlar qoralamadan oldin saqlandi
  expect(st.puts[0].buttons.kb_chat).toEqual({ text: { uz: '💬 Suhbat' }, iconCustomEmojiId: '1003', style: 'primary' });
  await expect(page.getByTestId('botui-style-kb_chat')).toHaveValue('primary');

  // Saqlash
  await page.getByTestId('botui-text-uz-kb_chat').fill('Suhbat');
  await page.getByTestId('botui-cmd-res').getByRole('checkbox').uncheck();
  await page.screenshot({ path: `test-results/bot-ui-${info.project.name}.png` });
  await page.getByTestId('botui-save').click();
  await expect.poll(() => st.puts.length).toBe(2);
  const body = st.puts[1];
  expect(body.buttons.kb_chat).toEqual({ text: { uz: 'Suhbat' }, iconCustomEmojiId: '1003', style: 'primary' });
  expect(body.buttons.confirmYes).toEqual({ iconCustomEmojiId: '1001', style: 'success' });
  expect(body.messageEmoji).toEqual([{ emoji: '✅', id: '1001' }]);
  expect(body.commands).toEqual([{ command: 'start', enabled: true, description: {} }, { command: 'res', enabled: false, description: {} }]);
  expect(body.stripEmojiWhenIcon).toBe(true);

  // Telefonda gorizontal skroll yo'q
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors, errors.join('\n')).toEqual([]);
});
