import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// Owner 2026-10-22: "Excel'ga yuklangan hamma narsa tartibsiz", "Hisobotlar telefonda sig'maydi", kirim monitoringi.
// Backend soxta: chiqim/kirim/obyekt/xodim/davomat. Excel fayl haqiqatan yuklanadi va ichi o'qib tekshiriladi.
test.use({ serviceWorkers: 'block' });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
const day = (back: number) => { const d = new Date(Date.now() - back * 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

const USERS = [
  { _id: 'u1', firstName: 'Ali', name: 'Ali Valiyev', role: 'direktor', phone: '+998900000001', companyId: 'c1' },
  { _id: 'u2', firstName: 'Bobur', name: 'Bobur Karimov', role: 'prorab', phone: '+998900000002', companyId: 'c1' },
  { _id: 'u3', firstName: 'Sardor', name: 'Sardor Usmonov', role: 'ishchi', phone: '+998900000003', companyId: 'c1' },
];
const OBJECTS = [
  { _id: 'p1', name: 'Chilonzor 5-uy turar-joy majmuasi', status: 'active', budget: 50_000_000, location: 'Toshkent', foremanId: 'u2', companyId: 'c1' },
  { _id: 'p2', name: 'Olmazor maktab', status: 'active', budget: 0, location: 'Toshkent', foremanId: 'u2', companyId: 'c1' },
];
const tx = (id: string, d: Record<string, unknown>) => ({ _id: id, id, status: 'confirmed', createdById: 'u2', confirmedById: 'u1', projectId: 'p1', companyId: 'c1', ...d });
const TXS = [
  tx('e1', { type: 'material', amount: 12_500_000, description: 'Sement 300 qop', date: day(2), toUserId: 'u2' }),
  tx('e2', { type: 'oylik', amount: 4_000_000, description: 'Oylik', date: day(5), toUserId: 'u3' }),
  tx('e3', { type: 'transport', amount: 900_000, description: 'Kran ijarasi', date: day(8), projectId: 'p2', recipientName: 'Kamaz' }),
  tx('i1', { type: 'income', amount: 30_000_000, description: 'Buyurtmachi avansi', date: day(3), createdById: 'u1' }),
  tx('i2', { type: 'income', amount: 5_000_000, description: "Maktab to'lovi", date: day(6), projectId: 'p2', createdById: 'u2' }),
];

async function mock(page: Page) {
  await page.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const ok = (o: any) => route.fulfill({ ...o, headers: CORS });
    if (url.includes('/api/status')) return ok({ json: { siteEnabled: true, appEnabled: true, botEnabled: true } });
    if (url.includes('/api/deploy/latest')) return ok({ json: { available: false } });
    if (url.includes('/api/attendance/today')) return ok({ json: null });
    if (url.includes('/api/attendance?') && url.includes('all=1')) {
      return ok({ json: [{ id: 'a1', userId: 'u3', date: day(1), checkIn: new Date(Date.now() - 86400000).toISOString(), checkOut: new Date(Date.now() - 86400000 + 8 * 3600000).toISOString(), workHours: 8, status: 'present' }] });
    }
    if (url.includes('/api/admin/subscriptions/my')) return ok({ json: { status: 'active', daysLeft: 30, features: [] } });
    if (url.includes('/api/insights/summary')) {
      return ok({ json: {
        theft: [{ kind: 'over_smeta', objectName: 'Chilonzor 5-uy turar-joy majmuasi', text: "Sement smetadan 40% ko'p yuborilgan — tekshiring, bu juda uzun ogohlantirish matni bo'lishi mumkin", severity: 'critical' }],
        prices: [{ material: 'Armatura 12mm (A500C) uzun nomli material', unit: 'tonna', lastPrice: 9_800_000, recentAvg: 9_500_000, prevAvg: 9_000_000, changePct: 8.9, samples: 4, lastDate: day(1) }],
        docs: [{ id: 'd1', title: "Qurilish ruxsatnomasi — Chilonzor 5-uy turar-joy majmuasi", expiresAt: day(-5), stage: 'd7', days: 5 }],
        equipment: [{ id: 'q1', name: 'Ekskavator JCB 3CX (davlat raqami 01 A 123 BC)', nextServiceDate: day(-3), daysToService: 3, hoursToService: null }],
      } });
    }
    if (url.includes('/api/company/features')) return ok({ json: { briefing: true, theft: true, prices: true, docs: false, equipment: true, photoAi: false, piecework: false } });
    if (url.includes('/api/users')) return ok({ json: USERS });
    if (url.includes('/api/objects')) return ok({ json: OBJECTS });
    if (url.includes('/api/transactions')) return ok({ json: TXS });
    if (req.method() === 'GET') return ok({ json: [] });
    return ok({ json: {} });
  });
}
async function seed(page: Page, view: 'finance' | 'control' = 'finance') {
  await page.addInitScript((v) => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('token', 'e2e-token');
      localStorage.setItem('currentUser', JSON.stringify({ id: 'u1', name: 'Ali Valiyev', role: 'direktor', phone: '+998900000001', projectIds: [], companyId: 'c1', language: 'uz', isOwner: true }));
      localStorage.setItem('page', 'reports');
      localStorage.setItem('reports.view', JSON.stringify(v));
      localStorage.setItem('erp_companyName', 'Jondor Iris Stroy');
      localStorage.setItem('erp_visited', '1');
      localStorage.setItem('i18nextLng', 'uz');
      localStorage.setItem('erp_pinSalt', 'e2e');
      localStorage.setItem('erp_pinHash', 'e2e');
      localStorage.setItem('erp_lockTimeoutMin', '60');
      localStorage.setItem('erp_lastActiveAt', String(Date.now()));
    } catch { /* */ }
  }, view);
}

function unzip(buf: Buffer): Record<string, string> {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const body = buf.subarray(start, start + csize);
    out[name] = (method === 8 ? inflateRawSync(body) : body).toString('utf8');
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

async function noHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad: string[] = [];
    const root = document.querySelector('[data-testid="reports-header"]')?.parentElement;
    root?.querySelectorAll('*').forEach(el => {
      const b = (el as HTMLElement).getBoundingClientRect();
      if (b.width > 0 && b.height > 0 && (b.right > vw + 1 || b.left < -1)) {
        // gorizontal aylantiriladigan konteyner ichidagilar (masalan recharts surface) emas
        let p: HTMLElement | null = el.parentElement, scroller = false;
        while (p) { const s = getComputedStyle(p); if ((s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') && p.getBoundingClientRect().right <= vw + 1) { scroller = true; break; } p = p.parentElement; }
        if (!scroller) bad.push(`${el.tagName}.${String((el as HTMLElement).className).slice(0, 60)} → ${Math.round(b.right)}`);
      }
    });
    return { vw, sw: document.documentElement.scrollWidth, bad: bad.slice(0, 8) };
  });
  expect(r.sw, 'sahifa gorizontal aylanmasin').toBeLessThanOrEqual(r.vw + 1);
  expect(r.bad, r.bad.join('\n')).toEqual([]);
}

test('Hisobotlar: Excel yuklanadi — muqova + tartibli varaqlar, kirim ham bor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mock(page);
  await seed(page);
  await page.goto('/');
  await expect(page.getByTestId('reports-header')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reports-income-section')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('reports-export').click()]);
  expect(dl.suggestedFilename()).toMatch(/^hisobot_.*\.xlsx$/);
  const files = unzip(readFileSync((await dl.path())!));
  const names = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
  expect(names).toEqual(['Umumiy', 'Chiqimlar', 'Kirimlar', "Obyektlar bo'yicha", "Xodimlar bo'yicha", 'Davomat']);
  const cover = files['xl/worksheets/sheet1.xml'];
  expect(cover).toContain('Jondor Iris Stroy');
  expect(cover).toContain('<t>Jami kirim</t>');
  expect(cover).toContain('<v>35000000</v>'); // 30 mln + 5 mln
  expect(cover).toContain('<v>17400000</v>'); // chiqimlar jami
  const exp = files['xl/worksheets/sheet2.xml'];
  expect(exp).toContain('<t>Sement 300 qop</t>');
  expect(exp).toContain('<t>Bobur Karimov</t>');
  expect(exp).toContain('state="frozen"');
  expect(exp).toContain('<autoFilter ref="A4:N7"/>');
  expect(files['xl/worksheets/sheet3.xml']).toContain('<t>Buyurtmachi avansi</t>');
  expect(files['xl/worksheets/sheet6.xml']).toContain('<t>Sardor Usmonov</t>');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Hisobotlar (telefon 360/390/430): filtr yig\'iladi, hech narsa ekrandan chiqmaydi; Nazorat ham sig\'adi', async ({ page }, info) => {
  test.skip(info.project.name !== 'telefon', 'faqat telefon');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mock(page);
  await seed(page);
  for (const w of [360, 390, 430]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto('/');
    await expect(page.getByTestId('reports-header')).toBeVisible({ timeout: 20_000 });
    const toggle = page.getByTestId('reports-filter-toggle');
    await expect(toggle).toContainText('30 kun');
    await expect(page.getByTestId('reports-filter-panel')).toHaveCount(0); // yig'ilgan
    await expect(page.getByTestId('reports-export')).toBeInViewport();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`reports-${w}-closed.png`) });

    await toggle.click();
    const panel = page.getByTestId('reports-filter-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Tanlash' }).click(); // sana kiritish maydonlari
    await expect(panel.locator('input[type=date]')).toHaveCount(2);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`reports-${w}-open.png`) });
    // tashqariga bosish — yopiladi
    await page.getByTestId('reports-scroll').click({ position: { x: 20, y: 40 } });
    await expect(page.getByTestId('reports-filter-panel')).toHaveCount(0);
    await toggle.click();
    await page.getByTestId('reports-filter-panel').getByRole('button', { name: 'Bu oy' }).click(); // davr tanlansa yopiladi
    await expect(page.getByTestId('reports-filter-panel')).toHaveCount(0);
    await expect(toggle).toContainText('Bu oy');
    await page.getByTestId('reports-filter-toggle').click();
    await page.getByTestId('reports-filter-panel').getByRole('button', { name: '30 kun' }).click();

    await page.getByTestId('reports-scroll').evaluate(el => el.scrollTo(0, el.scrollHeight));
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`reports-${w}-bottom.png`) });

    await page.getByRole('tab', { name: 'Nazorat' }).click();
    await expect(page.getByTestId('reports-header')).toBeVisible();
    await expect(page.getByTestId('reports-control')).toContainText('Ekskavator');
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`reports-${w}-control.png`), fullPage: true });
    await page.getByRole('tab', { name: 'Moliya' }).click();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
