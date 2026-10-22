// AI Telegram akkauntiga yozilgan xabar (owner 2026-10-22): bog'langan xodim — AI javob beradi va bajaradi;
// tasdiq talab qilinsa matn bilan so'raladi; notanishga kuniga bir marta tushuntirish.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: any[] = [];
const runs: any[] = [];
let agentOut: any = { text: 'Bu oy 48 500 000 so\'m chiqim.' };
let who: any = { companyId: 'c1', employeeId: 'u1' };
let rateAllowed = true;

vi.mock('../telegram/workerRpc', () => ({ callWorker: vi.fn(async (m: string, p: any) => { if (m === 'dm.send') sent.push(p); return { ok: true }; }) }));
vi.mock('../telegram/tgLink', () => ({ findEmployeeByTgId: vi.fn(async () => who) }));
vi.mock('../brain/textAgent', () => ({ createTextAgent: () => ({ run: vi.fn(async (i: any) => { runs.push(i); return agentOut; }) }) }));
vi.mock('../settings', () => ({ isAiActive: vi.fn(async () => true), getSettings: vi.fn(async () => ({ limits: { botMsgsPer10Min: 20 } })) }));
vi.mock('../actor', () => ({ checkActor: vi.fn(async () => ({ ok: true, actor: { role: 'prorab', isOwner: false } })) }));
vi.mock('../lib/mongoRateLimit', () => ({ hitRate: vi.fn(async () => ({ allowed: rateAllowed })) }));
vi.mock('../../models/User', () => ({ default: { findById: () => ({ select: () => ({ lean: () => ({ catch: async () => ({ language: 'uz', role: 'prorab' }) }) }) }) } }));

import { handleDm, __resetDmChatForTests } from '../telegram/dmChat';

beforeEach(() => { sent.length = 0; runs.length = 0; __resetDmChatForTests(); who = { companyId: 'c1', employeeId: 'u1' }; rateAllowed = true; agentOut = { text: "Bu oy 48 500 000 so'm chiqim." }; });

describe('AI akkauntiga yozilgan xabar', () => {
  it("bog'langan xodim: agent xodim sifatida ishlaydi, javob shu akkauntdan qaytadi, tarix saqlanadi", async () => {
    await handleDm({ account: 'a'.repeat(24), tgUserId: '777', text: 'bu oy qancha chiqim' });
    expect(runs[0]).toMatchObject({ userText: 'bu oy qancha chiqim', ctx: { companyId: 'c1', userId: 'u1', role: 'prorab', channel: 'bot' } });
    expect(sent).toEqual([{ account: 'a'.repeat(24), tgUserId: '777', text: "Bu oy 48 500 000 so'm chiqim." }]);
    await handleDm({ account: 'a'.repeat(24), tgUserId: '777', text: 'rahmat' });
    expect(runs[1].history).toHaveLength(2);
  });
  it('tasdiq talab qilinsa — matn bilan so\'raladi', async () => {
    agentOut = { text: 'Eslatma tayyor.', pendingActions: [{ summary: 'ertaga 8:00 eslatma' }] };
    await handleDm({ tgUserId: '777', text: 'ertaga 8 da eslat' });
    expect(sent[0].text).toMatch(/Tasdiqlaysizmi: ertaga 8:00 eslatma\? «ha» yoki «yo'q»/);
    expect(sent[0].account).toBeUndefined();
  });
  it("notanish odam — qisqa tushuntirish (kuniga bir marta), agent ishlamaydi", async () => {
    who = null;
    await handleDm({ tgUserId: '999', text: 'salom' });
    expect(runs).toHaveLength(0);
    expect(sent[0].text).toMatch(/ERP botida \/start/);
    rateAllowed = false;
    await handleDm({ tgUserId: '999', text: 'salom' });
    expect(sent).toHaveLength(1);
  });
});
