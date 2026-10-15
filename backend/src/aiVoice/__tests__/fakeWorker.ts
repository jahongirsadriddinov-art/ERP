// P6 testlari uchun soxta Telegram worker: haqiqiy socket.io server ("/aiv-worker" namespace) +
// socket.io-client orqali Python worker'ning protokolini takrorlaydi (Ed25519 challenge → auth → lease →
// RPC javoblari, voqealar, binary audio). Haqiqiy Telegram YO'Q.
import crypto from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import {
  AIV_WORKER_NAMESPACE, WORKER_EVENTS, workerChallengeMessage,
  type LeaseAck, type WorkerAuthAck, type WorkerChallenge, type WorkerEvent, type WorkerRpcRequest,
} from '../contracts';
import { __resetWorkerAuthCacheForTests } from '../lib/workerAuth';
import { __resetWorkerNamespaceForTests, closeWorkerNamespace, registerAiWorkerNamespace } from '../telegram/workerNamespace';

export const workerKeys = crypto.generateKeyPairSync('ed25519');
export const otherKeys = crypto.generateKeyPairSync('ed25519');

export function useWorkerPubkey(): void {
  process.env.AIV_WORKER_PUBKEY = workerKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  __resetWorkerAuthCacheForTests();
}

export interface WorkerServer { url: string; io: Server; close(): Promise<void> }

/** AI_VOICE_ENABLED=true va AIV_WORKER_PUBKEY o'rnatilgandan keyin chaqiring. */
export async function startWorkerServer(): Promise<WorkerServer> {
  __resetWorkerNamespaceForTests();
  const httpServer = http.createServer();
  const io = new Server(httpServer, { maxHttpBufferSize: 64 * 1024 });
  registerAiWorkerNamespace(io);
  await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', () => res()));
  const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  return {
    url, io,
    async close() {
      await closeWorkerNamespace();
      io.close();
      await new Promise<void>((res) => httpServer.close(() => res()));
      __resetWorkerNamespaceForTests();
    },
  };
}

export type RpcHandler = (params: any, req: WorkerRpcRequest) => unknown | Promise<unknown>;
export class RpcErr extends Error {
  constructor(public code: string, public retryAfterSec?: number) { super(code); }
}

const DEFAULT_HANDLERS: Record<string, RpcHandler> = {
  status: () => ({ version: 'fake-1', connected: true, activeCalls: 0 }),
  'binding.expect': () => ({ ok: true }),
  'contact.resolve': () => ({ status: 'resolved' }),
  'call.place': () => ({ accepted: true }),
  'call.hangup': () => ({ ok: true }),
  'udp.probe': () => ({ ok: true, details: 'fake' }),
  'auth.logout': () => ({ ok: true }),
};

export class FakeWorker {
  readonly socket: ClientSocket;
  readonly rpcs: WorkerRpcRequest[] = [];
  readonly audio: { at: number; buf: Buffer }[] = [];
  readonly revoked: unknown[] = [];
  handlers: Record<string, RpcHandler> = { ...DEFAULT_HANDLERS };
  /** true — RPC'ga javob berilmaydi (timeout sinovi). */
  silent = false;
  /** Javobdagi requestId'ni buzish (bad_response sinovi). */
  wrongRequestId = false;
  leaseId?: string;
  private challenge: Promise<WorkerChallenge>;

  private constructor(url: string, readonly workerId: string, transports: string[]) {
    this.socket = ioc(`${url}${AIV_WORKER_NAMESPACE}`, {
      transports, auth: { workerId, version: 'fake-1' }, forceNew: true, reconnection: false, autoConnect: false,
    });
    this.challenge = new Promise((res) => this.socket.once(WORKER_EVENTS.challenge, (ch: WorkerChallenge) => res(ch)));
    this.socket.on(WORKER_EVENTS.rpc, async (req: WorkerRpcRequest, ack: (r: unknown) => void) => {
      this.rpcs.push(req);
      if (this.silent) return;
      const requestId = this.wrongRequestId ? 'other-request-id' : req.requestId;
      const h = this.handlers[req.method];
      try {
        const result = h ? await h(req.params, req) : {};
        ack({ requestId, ok: true, result });
      } catch (e) {
        const err = e as RpcErr;
        ack({ requestId, ok: false, error: { code: err.code || 'error', message: 'fake', ...(err.retryAfterSec ? { retryAfterSec: err.retryAfterSec } : {}) } });
      }
    });
    this.socket.on(WORKER_EVENTS.audio, (buf: Buffer) => { this.audio.push({ at: Date.now(), buf: Buffer.from(buf) }); });
    this.socket.on(WORKER_EVENTS.leaseRevoked, (p: unknown) => { this.revoked.push(p); });
  }

  /** Ulanadi va server challenge'ini kutadi (autentifikatsiyasiz). */
  static async connect(url: string, opts: { workerId?: string; transports?: string[] } = {}): Promise<FakeWorker> {
    const w = new FakeWorker(url, opts.workerId || 'tgw-fake', opts.transports || ['websocket']);
    await new Promise<void>((res, rej) => {
      w.socket.once('connect', () => res());
      w.socket.once('connect_error', (e) => rej(e));
      w.socket.connect();
    });
    return w;
  }

  /** To'liq tayyor worker: ulanish + auth + lease. */
  static async ready(url: string, workerId = 'tgw-fake'): Promise<FakeWorker> {
    const w = await FakeWorker.connect(url, { workerId });
    const a = await w.auth();
    if (!a.ok) throw new Error(`auth: ${a.error}`);
    const l = await w.acquire();
    if (!l.ok) throw new Error(`lease: ${l.reason}`);
    return w;
  }

  nonce(): Promise<WorkerChallenge> { return this.challenge; }

  async auth(opts: { key?: crypto.KeyObject; nonce?: string; workerId?: string } = {}): Promise<WorkerAuthAck> {
    const nonce = opts.nonce || (await this.challenge).nonce;
    const workerId = opts.workerId || this.workerId;
    const signature = crypto.sign(null, Buffer.from(workerChallengeMessage(workerId, nonce), 'utf8'), opts.key || workerKeys.privateKey).toString('base64');
    return this.socket.timeout(5_000).emitWithAck(WORKER_EVENTS.auth, { workerId, nonce, signature });
  }

  async acquire(): Promise<LeaseAck> {
    const r: LeaseAck = await this.socket.timeout(5_000).emitWithAck(WORKER_EVENTS.leaseAcquire, {});
    if (r.ok) this.leaseId = r.leaseId;
    return r;
  }

  renew(leaseId = this.leaseId): Promise<LeaseAck> {
    return this.socket.timeout(5_000).emitWithAck(WORKER_EVENTS.leaseRenew, { leaseId });
  }

  release(leaseId = this.leaseId): Promise<{ ok: boolean }> {
    return this.socket.timeout(5_000).emitWithAck(WORKER_EVENTS.leaseRelease, { leaseId });
  }

  event(ev: WorkerEvent): Promise<{ ok: boolean }> {
    return this.socket.timeout(5_000).emitWithAck(WORKER_EVENTS.event, ev);
  }

  callState(sessionId: string, state: 'dialing' | 'ringing' | 'connected' | 'ended', reason?: string): Promise<{ ok: boolean }> {
    return this.event({ type: 'call.state', sessionId, state, ...(reason ? { reason: reason as any } : {}), at: Date.now() });
  }

  sendAudio(frame: Buffer): void { this.socket.emit(WORKER_EVENTS.audio, frame); }

  rpcsOf(method: string): WorkerRpcRequest[] { return this.rpcs.filter((r) => r.method === method); }

  /** Server socket'ni uzdimi. */
  waitDisconnect(ms = 3_000): Promise<boolean> {
    if (!this.socket.connected) return Promise.resolve(true);
    return new Promise((res) => {
      const t = setTimeout(() => res(false), ms);
      this.socket.once('disconnect', () => { clearTimeout(t); res(true); });
    });
  }

  close(): void { this.socket.disconnect(); }
}
