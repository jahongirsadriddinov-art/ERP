// AI Telegram qo'ng'irog'i ulanmadi ("Ошибка соединения") — tuzilgan log, zaxira bot xabari (davomatdan tashqari).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ session: null as any, user: null as any }));
const chain = (v: () => any) => ({ select: () => ({ lean: () => ({ catch: () => Promise.resolve(v()) }) }) });
vi.mock('../../models/AiCallSession', () => ({ default: { updateOne: vi.fn(async () => ({})), findOne: vi.fn(), findById: vi.fn(() => chain(() => db.session)) } }));
vi.mock('../../models/User', () => ({ default: { findById: vi.fn(() => chain(() => db.user)) } }));
vi.mock('../../models/AiEmployeeContact', () => ({ default: { updateOne: vi.fn(async () => ({})) } }));
vi.mock('../sessions', () => ({ finishSession: vi.fn(async () => true), onSessionsEnded: vi.fn() }));
vi.mock('../telegram/accountService', () => ({ setFloodWait: vi.fn(async () => undefined) }));
vi.mock('../telegram/workerRpc', () => ({ callWorker: vi.fn(async () => ({})) }));
vi.mock('../telegram/workerNamespace', () => ({ sendWorkerAudio: vi.fn(), workerHub: { on: vi.fn() } }));

import { handleCallState, registerBridge, setCallFailureNotifier, __resetCallBridgeForTests } from '../telegram/callBridge';
import { makeCallFailureNotifier, callFailedText } from '../telegram/callFailureNotice';
import { finishSession } from '../sessions';

const SID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const EMP = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const handle = () => ({ sessionId: SID, end: vi.fn(async () => undefined), connected: vi.fn(async () => undefined), pushAudio: vi.fn() }) as any;
const ended = (extra: Record<string, unknown> = {}) => ({ type: 'call.state' as const, sessionId: SID, state: 'ended' as const, reason: 'network' as const, stage: 'p2p_connect', attempts: 2, errorClass: 'ConnectionError', at: 0, ...extra });

describe('Telegram call failed to connect', () => {
  beforeEach(() => { __resetCallBridgeForTests(); vi.mocked(finishSession).mockClear(); });

  it('logs a structured line with stage/attempts/error class and calls the fallback notifier', async () => {
    const notify = vi.fn(async () => undefined);
    setCallFailureNotifier(notify);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerBridge({ sessionId: SID, handle: handle(), employeeId: EMP, companyId: 'c1' });
    await handleCallState(ended() as any);
    expect(vi.mocked(finishSession).mock.calls[0][2]).toBe('tg:network@p2p_connect');
    expect(warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('call_event=failed'))).toMatch(/reason=network stage=p2p_connect attempts=2 err=ConnectionError/);
    await new Promise((r) => setTimeout(r, 0));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SID, employeeId: EMP, reason: 'network', stage: 'p2p_connect' }));
    warn.mockRestore();
  });

  it("'accepted' is recorded without changing the session; declined / answered calls get no fallback", async () => {
    const notify = vi.fn(async () => undefined);
    setCallFailureNotifier(notify);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    registerBridge({ sessionId: SID, handle: handle(), employeeId: EMP, companyId: 'c1' });
    await handleCallState({ type: 'call.state', sessionId: SID, state: 'accepted', at: 0 } as any);
    expect(info.mock.calls.some((c) => String(c[0]).includes('call_event=accepted'))).toBe(true);
    await handleCallState(ended({ reason: 'declined', stage: undefined }) as any);
    registerBridge({ sessionId: SID, handle: handle(), employeeId: EMP, companyId: 'c1' });
    await handleCallState({ type: 'call.state', sessionId: SID, state: 'connected', at: 0 } as any);
    await handleCallState(ended() as any);
    await new Promise((r) => setTimeout(r, 0));
    expect(notify).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('notifier: sends a bot text to the employee, but not for attendance calls or without a linked chat', async () => {
    const send = vi.fn(async () => undefined);
    const n = makeCallFailureNotifier(send);
    db.session = { purpose: 'assistant' }; db.user = { telegramChatId: '555', language: 'uz' };
    await n({ sessionId: SID, employeeId: EMP, companyId: 'c1', reason: 'network' });
    expect(send).toHaveBeenCalledWith('555', callFailedText('uz', 'network'));
    send.mockClear();
    db.session = { purpose: 'attendance' };
    await n({ sessionId: SID, employeeId: EMP, companyId: 'c1', reason: 'network' });
    db.session = { purpose: 'assistant' }; db.user = { language: 'ru' };
    await n({ sessionId: SID, employeeId: EMP, companyId: 'c1', reason: 'network' });
    expect(send).not.toHaveBeenCalled();
    expect(callFailedText('ru', 'network')).toMatch(/соединение не установилось/);
  });
});
