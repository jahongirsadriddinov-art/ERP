import { Router, type NextFunction, type Request, type Response } from 'express';
import { hitRate } from '../lib/mongoRateLimit';
import {
  applyCallback, approveTask, callbackSecretOk, cancelTask, createProfile, createTask, getTask, listProfiles, listTasks,
  retryTask, sendTaskToTelegram, setupChecklist, updateProfile,
} from '../agents/service';

// AI ofis — boshqaruv markazi (owner 2026-10-22).
//  • /api/ai-voice/platform/agents/*  — faqat dasturchi (bootstrap: requireAuth + requireDeveloper);
//  • /api/ai-voice/agent-callback     — GitHub Actions workflow'idan; faqat X-Agent-Secret (AGENT_CALLBACK_SECRET,
//    constant-time) bilan. Sozlanmagan bo'lsa 503 — hech narsa o'zgarmaydi.

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((e) => {
      console.error('[aiVoice/agents] xato:', (e as Error)?.name || 'Error');
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
      else next();
    });
  };
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const uid = (req: Request) => String(req.user?.userId || '');

export const agentRoutes = Router();
agentRoutes.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

agentRoutes.get('/agents', wrap(async (_req, res) => {
  res.json({ agents: await listProfiles(), setup: setupChecklist() });
}));

agentRoutes.post('/agents', wrap(async (req, res) => {
  const r = await createProfile(isObj(req.body) ? req.body : {}, uid(req), { req });
  if (!r.ok) return res.status(r.error === 'too_many' || r.error === 'name_taken' ? 409 : 400).json({ error: r.error });
  res.json({ ok: true, agent: r.profile });
}));

agentRoutes.patch('/agents/:key', wrap(async (req, res) => {
  const p = await updateProfile(String(req.params.key || '').slice(0, 40), isObj(req.body) ? req.body : {}, uid(req), req);
  if (!p) return res.status(404).json({ error: 'agent_not_found' });
  res.json({ ok: true, agent: p });
}));

agentRoutes.get('/agent-tasks', wrap(async (req, res) => {
  const agentKey = typeof req.query.agentKey === 'string' ? req.query.agentKey.slice(0, 40) : undefined;
  const limit = Number(req.query.limit) || undefined;
  res.json({ tasks: await listTasks({ agentKey, limit }) });
}));

agentRoutes.post('/agent-tasks', wrap(async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  // Dasturchi uchun ham chegara: 60 ta buyruq / soat (xato tugma bosilishidan Gemini/GitHub sarfini himoya)
  const rl = await hitRate(`agents:task:${uid(req)}`, 60, 3_600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited' });
  const r = await createTask(typeof b.agentKey === 'string' ? b.agentKey.slice(0, 40) : '', b.text, uid(req));
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true, task: r.task });
}));

agentRoutes.get('/agent-tasks/:id', wrap(async (req, res) => {
  const t = await getTask(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'not_found' });
  res.json({ task: t });
}));

agentRoutes.post('/agent-tasks/:id/cancel', wrap(async (req, res) => {
  const t = await cancelTask(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'not_found' });
  if (t === 'not_active') return res.status(409).json({ error: 'not_active' });
  res.json({ ok: true, task: t });
}));

agentRoutes.post('/agent-tasks/:id/retry', wrap(async (req, res) => {
  const t = await retryTask(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'not_found' });
  if (t === 'not_retryable') return res.status(409).json({ error: 'not_retryable' });
  res.json({ ok: true, task: t });
}));

agentRoutes.post('/agent-tasks/:id/approve', wrap(async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  const t = await approveTask(String(req.params.id), { spec: b.spec, plan: b.plan }, uid(req));
  if (!t) return res.status(404).json({ error: 'not_found' });
  if (t === 'not_review') return res.status(409).json({ error: 'not_review' });
  if (t === 'invalid') return res.status(400).json({ error: 'invalid' });
  res.json({ ok: true, task: t });
}));

agentRoutes.post('/agent-tasks/:id/send', wrap(async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  const r = await sendTaskToTelegram(String(req.params.id), b.target, b.index);
  if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
  res.json({ ok: true });
}));

/** GitHub Actions qayta qo'ng'irog'i (auth yo'q — faqat umumiy sir). */
export const agentCallbackRoutes = Router();
agentCallbackRoutes.post('/', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ok = callbackSecretOk(req.get('x-agent-secret'));
  if (ok === 'unconfigured') return res.status(503).json({ error: 'not_configured' });
  if (ok === 'bad') return res.status(401).json({ error: 'unauthorized' });
  const r = await applyCallback(isObj(req.body) ? req.body : {});
  if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
  res.json({ ok: true, ...(r.error ? { note: r.error } : {}) });
}));
