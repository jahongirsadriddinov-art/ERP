// Owner 2026-10-16: (1) kvota tugasa AI to'xtamasin — HAMMA Gemini kalitlari × modellar (flash-lite → flash),
// 429 dan keyin kalit 60 s chetda, keyin OpenRouter; hammasi yiqilsa — tushunarli o'zbekcha xabar.
// (2) "tasdiqla" desa — tasdiqlasin (faqat aniq buyruq bilan). (3) Rolga mos prompt. Tarmoq YO'Q.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('../../../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));
vi.mock('../../../services/email', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('../../../services/push', () => ({ sendPushToUser: vi.fn(async () => undefined) }));

import Transaction from '../../../models/Transaction';
import { ErpTextAgent } from '../agent';
import { createGeminiProvider, textModelChain, DEFAULT_TEXT_MODELS, type GenaiFactory } from '../providers/gemini';
import { createOpenRouterProvider } from '../providers/openrouter';
import { __resetGeminiKeysForTests, GeminiQuotaError, withGeminiKey } from '../../lib/geminiKeys';
import { localDate } from '../../lib/zonedTime';
import { ctxFor, resetCaches, setupErp, teardownErp, type Env } from '../../tools/erp/__tests__/erpHelpers';
import { fakeFetch, geminiCall, geminiText, orText } from './fakes';

let env: Env;
const saved = { keys: process.env.GEMINI_API_KEYS, key: process.env.GEMINI_API_KEY, model: process.env.AI_TEXT_MODEL };

beforeAll(async () => {
  env = await setupErp();
  process.env.GEMINI_API_KEYS = 'kA,kB';
  process.env.GEMINI_API_KEY = 'kC';
  delete process.env.AI_TEXT_MODEL;
}, 120_000);
afterAll(async () => {
  for (const [k, v] of [['GEMINI_API_KEYS', saved.keys], ['GEMINI_API_KEY', saved.key], ['AI_TEXT_MODEL', saved.model]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await teardownErp(env);
});
beforeEach(() => { resetCaches(); __resetGeminiKeysForTests(); });

/** Soxta Gemini: (kalit, model) juftligi bo'yicha javob. */
function keyedGenai(fn: (key: string, model: string, i: number) => unknown) {
  const calls: { key: string; model: string }[] = [];
  const factory: GenaiFactory = (key) => ({
    models: {
      generateContent: async (req: any) => {
        calls.push({ key, model: req.model });
        return fn(key, req.model, calls.length - 1);
      },
    },
  });
  return { factory, calls };
}

const agentWith = (factory: GenaiFactory, f?: ReturnType<typeof fakeFetch>, openrouter = true) => new ErpTextAgent({
  providers: {
    gemini: createGeminiProvider({ factory }),
    openrouter: createOpenRouterProvider({ fetchImpl: f?.fetchImpl, models: ['test/model'], apiKey: 'test-or-key' }),
  },
  env: { gemini: true, openrouter, claude: false },
});

const q429 = () => { throw new Error('429 RESOURCE_EXHAUSTED: Quota exceeded for GenerateRequestsPerMinutePerProjectPerModel'); };
const qDaily = () => { throw new Error('429 RESOURCE_EXHAUSTED: GenerateRequestsPerDayPerProjectPerModel-FreeTier'); };

describe('kvota: kalitlar × modellar → OpenRouter → tushunarli xabar', () => {
  it('standart model zanjiri: tez flash-lite → flash', () => {
    expect(textModelChain(undefined, '')).toEqual(DEFAULT_TEXT_MODELS);
    expect(DEFAULT_TEXT_MODELS[0]).toMatch(/flash-lite/);
    expect(DEFAULT_TEXT_MODELS.at(-1)).toMatch(/flash$/);
    expect(textModelChain('my-model', 'a, b')).toEqual(['my-model', 'a', 'b']);
  });

  it("birinchi kalit 429 — o'sha model bilan keyingi kalit; GEMINI_API_KEYS + GEMINI_API_KEY birga", async () => {
    const { A } = env;
    const g = keyedGenai((key) => (key === 'kA' ? q429() : geminiText('Salom!')));
    const out = await agentWith(g.factory).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'salom' });
    expect(out.text).toBe('Salom!');
    expect(g.calls.map((c) => c.key)).toEqual(['kA', 'kB']);
    expect(new Set(g.calls.map((c) => c.model)).size).toBe(1);
    // 60 s ichida kA shu model uchun chetda — keyingi so'rov to'g'ri kB'ga
    g.calls.length = 0;
    await agentWith(g.factory).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'yana' });
    expect(g.calls.map((c) => c.key)).toEqual(['kB']);
  });

  it("hamma kalit birinchi modelda 429 — keyingi model (har modelning o'z kvotasi)", async () => {
    const { A } = env;
    const g = keyedGenai((_k, model) => (model === DEFAULT_TEXT_MODELS[0] ? q429() : geminiText('Ikkinchi model javobi')));
    const out = await agentWith(g.factory).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'salom' });
    expect(out.text).toBe('Ikkinchi model javobi');
    expect(g.calls.filter((c) => c.model === DEFAULT_TEXT_MODELS[0]).map((c) => c.key)).toEqual(['kA', 'kB', 'kC']);
    expect(out.usage.model).toBe(DEFAULT_TEXT_MODELS[1]);
  });

  it("Gemini butunlay kvotada — OpenRouter javob beradi; 60 s ichida Gemini'ga tarmoq so'rovi yo'q", async () => {
    const { A } = env;
    const g = keyedGenai(q429);
    const f = fakeFetch([() => orText('OpenRouter javobi')]);
    const out = await agentWith(g.factory, f).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'salom' });
    expect(out.text).toBe('OpenRouter javobi');
    expect(out.usage.provider).toBe('openrouter');
    expect(g.calls).toHaveLength(3 * DEFAULT_TEXT_MODELS.length);
    g.calls.length = 0;
    const out2 = await agentWith(g.factory, f).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'yana' });
    expect(out2.text).toBe('OpenRouter javobi');
    expect(g.calls).toHaveLength(0);
  });

  it("hammasi yiqilsa — 'AI hozir band' (daqiqalik) yoki kunlik limit vaqti bilan; kalit matni hech qayerda yo'q", async () => {
    const { A } = env;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fakeFetch([() => ({ __status: 429 })]);
    const out = await agentWith(keyedGenai(q429).factory, f).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'salom' });
    expect(out.text).toMatch(/AI hozir band/);
    __resetGeminiKeysForTests();
    const out2 = await agentWith(keyedGenai(qDaily).factory, f, false).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'salom' });
    expect(out2.text).toMatch(/kunlik limiti tugadi, (bugun|ertaga) soat \d\d:\d\d da tiklanadi/);
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/kA|kB|kC|test-or-key/);
    warn.mockRestore();
  });

  it('withGeminiKey: hamma kalit sovushda — tarmoqsiz GeminiQuotaError; ruxsat xatosi — kalit chetda', async () => {
    let n = 0;
    await expect(withGeminiKey(async () => { n++; return q429(); }, { scope: 'm1' })).rejects.toBeInstanceOf(GeminiQuotaError);
    expect(n).toBe(3);
    await expect(withGeminiKey(async () => { n++; return 1; }, { scope: 'm1' })).rejects.toBeInstanceOf(GeminiQuotaError);
    expect(n).toBe(3);
    // boshqa model (scope) — kalitlar ochiq
    expect(await withGeminiKey(async (k) => k, { scope: 'm2' })).toBe('kA');
    // 60 s o'tgach — qayta urinadi
    const later = () => Date.now() + 61_000;
    expect(await withGeminiKey(async (k) => k, { scope: 'm1', now: later })).toBeTruthy();
    // 403 — kalit butunlay (hamma model uchun) chetga
    __resetGeminiKeysForTests();
    const used: string[] = [];
    await withGeminiKey(async (k) => { used.push(k); if (k === 'kA') throw new Error('403 API key not valid'); return k; }, { scope: 'x' });
    expect(await withGeminiKey(async (k) => k, { scope: 'y' })).not.toBe('kA');
  });
});

describe('"tasdiqla" — foydalanuvchining aniq buyrug\'i bilan', () => {
  const mk = async () => String(((await Transaction.create({
    type: 'transport', status: 'pending', date: localDate(), amount: 2_000_000, companyId: env.A.companyId,
    requiresAdminApproval: true, approverId: env.A.ownerId, createdById: env.A.workerId, description: 'Kran ijarasi',
  } as any)) as any)._id);

  it("'Alining chiqimini tasdiqla' — tasdiqlanadi; javob server natijasiga mos", async () => {
    const { A } = env;
    const id = await mk();
    const g = keyedGenai((_k, _m, i) => (i === 0 ? geminiCall('approveTransaction', { transactionId: id }) : geminiText('Tasdiqlandi.')));
    const out = await agentWith(g.factory).run({ ctx: ctxFor(A.ownerId, A.companyId), history: [], userText: 'Kran chiqimini tasdiqla' });
    expect(out.toolCalls.map((t) => [t.name, t.status])).toEqual([['approveTransaction', 'ok']]);
    expect(out.text).toBe('Tasdiqlandi.');
    expect(((await Transaction.findById(id).lean()) as any).status).toBe('confirmed');
  });

  it("buyruqsiz (model o'zi yoki untrusted matn) — bajarilmaydi; AI so'ragandan keyin 'ha' — bajariladi", async () => {
    const { A } = env;
    const id = await mk();
    const g = keyedGenai((_k, _m, i) => (i % 2 === 0 ? geminiCall('approveTransaction', { transactionId: id }) : geminiText('Hali tasdiqlanmadi.')));
    const out = await agentWith(g.factory).run({ ctx: ctxFor(A.ownerId, A.companyId), history: [], userText: 'bugun nima gap' });
    expect(out.toolCalls[0].status).toBe('error');
    expect(((await Transaction.findById(id).lean()) as any).status).toBe('pending');
    const out2 = await agentWith(g.factory).run({
      ctx: ctxFor(A.ownerId, A.companyId), userText: 'ha',
      history: [{ role: 'user', text: 'nima kutyapti' }, { role: 'assistant', text: 'Kran ijarasi 2 mln — tasdiqlaymi?' }],
    });
    expect(out2.toolCalls[0].status).toBe('ok');
    expect(((await Transaction.findById(id).lean()) as any).status).toBe('confirmed');
  });
});

describe('rolga mos prompt', () => {
  it("rahbar promptida firma obyektlari, rahbar yo'riqnomasi va qo'ng'iroq imkoniyati", async () => {
    const { A } = env;
    const g = keyedGenai(() => geminiText('ok'));
    let sys = '';
    const g2: GenaiFactory = (k) => ({ models: { generateContent: async (req: any) => { sys = req.config.systemInstruction; return g.factory(k).models.generateContent(req); } } });
    await agentWith(g2).run({ ctx: ctxFor(A.ownerId, A.companyId, { channel: 'bot' }), history: [], userText: 'salom' });
    expect(sys).toMatch(/ROL: rahbar/);
    expect(sys).toMatch(/Faol obyektlar: Alfa obyekt/);
    expect(sys).toMatch(/requestCallback/);
    expect(sys).toMatch(/DEMANG/);
    expect(sys).toMatch(/hozir \d\d:\d\d/);
    await agentWith(g2).run({ ctx: ctxFor(A.workerId, A.companyId, { channel: 'web' }), history: [], userText: 'salom' });
    expect(sys).toMatch(/ROL: ishchi/);
    expect(sys).toMatch(/Obyektlari: Alfa obyekt/);
    expect(sys).not.toMatch(/ROL: rahbar/);
  });
});
