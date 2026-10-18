import {
  WORKER_EVENTS, type WorkerRpcMethod, type WorkerRpcMethods, type WorkerRpcRequest, type WorkerRpcResponse,
} from '../contracts';
import { newRequestId } from '../lib/ids';
import { getActiveWorker } from './workerNamespace';

// Backend → worker RPC (contracts.ts WorkerRpcMethods). Har so'rov noyob requestId bilan (A5: nonce emas),
// javob ack orqali keladi va requestId mosligi tekshiriladi. Parametrlar (telefon, kod, 2FA parol)
// HECH QACHON log qilinmaydi va xato matniga qo'shilmaydi.

export class WorkerRpcFailure extends Error {
  constructor(public readonly code: string, message?: string, public readonly retryAfterSec?: number) {
    super(message || code);
    this.name = 'WorkerRpcFailure';
  }
}

const DEFAULT_TIMEOUT_MS: Record<WorkerRpcMethod, number> = {
  'auth.start': 30_000,
  'auth.code': 30_000,
  'auth.password': 30_000,
  'auth.logout': 15_000,
  status: 5_000,
  'contact.resolve': 15_000,
  'binding.expect': 5_000,
  'call.place': 10_000,
  'call.hangup': 5_000,
  'udp.probe': 10_000,
  'incoming.config': 5_000,
  'call.caption': 3_000,
  'call.video_rate': 3_000,
};

const CODE_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

export async function callWorker<M extends WorkerRpcMethod>(
  method: M,
  params: WorkerRpcMethods[M]['params'],
  opts: { timeoutMs?: number } = {},
): Promise<WorkerRpcMethods[M]['result']> {
  const w = getActiveWorker();
  if (!w) throw new WorkerRpcFailure('worker_offline');
  const timeoutMs = Math.min(120_000, Math.max(100, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS[method] ?? 10_000));
  const req: WorkerRpcRequest<M> = { requestId: newRequestId(), method, params, deadlineMs: Date.now() + timeoutMs };
  let resp: WorkerRpcResponse<M>;
  try {
    resp = await w.socket.timeout(timeoutMs).emitWithAck(WORKER_EVENTS.rpc, req);
  } catch {
    throw new WorkerRpcFailure('timeout');
  }
  if (!resp || typeof resp !== 'object' || resp.requestId !== req.requestId) throw new WorkerRpcFailure('bad_response');
  if (resp.ok !== true) {
    const e = (resp as any).error || {};
    const code = typeof e.code === 'string' && CODE_RE.test(e.code) ? e.code : 'error';
    const retry = Number(e.retryAfterSec);
    // message — faqat qisqa, xavfsiz matn (worker kodlarni xato matniga qo'ymaydi)
    throw new WorkerRpcFailure(code, typeof e.message === 'string' ? e.message.slice(0, 200) : code, Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  return resp.result;
}
