import { describe, it, expect, vi } from 'vitest';
import { scanReceiptFile, SCAN_MAX_DIM, SCAN_QUALITY } from './receiptScan';

const file = {} as File;
const resize = vi.fn(async () => 'data:image/jpeg;base64,QUJD');
const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('scanReceiptFile', () => {
  it('compresses to ≤1600 px JPEG 0.8 and returns data, reporting stages', async () => {
    const stages: string[] = [];
    const f = vi.fn(async () => json(200, { amount: 5 }));
    const r = await scanReceiptFile(file, { resize, fetch: f as any, url: '/api/transactions/scan-receipt', isOnline: () => true }, { onStage: (s) => stages.push(s) });
    expect(r).toEqual({ ok: true, data: { amount: 5 } });
    expect(resize).toHaveBeenCalledWith(file, SCAN_MAX_DIM, SCAN_QUALITY);
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toEqual({ image: 'QUJD', mimeType: 'image/jpeg' });
    expect(stages).toEqual(['compress', 'upload', 'read']);
  });

  it('client timeout aborts the request with a clear retry message', async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
    const r = await scanReceiptFile(file, { resize, fetch: f as any, url: 'u', isOnline: () => true }, { timeoutMs: 30 });
    expect(r).toMatchObject({ ok: false, kind: 'timeout' });
    expect((r as any).message).toMatch(/Qayta urinib/);
  });

  it('user cancel → cancelled (silent); offline → offline without a request', async () => {
    const ac = new AbortController();
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
    const p = scanReceiptFile(file, { resize, fetch: f as any, url: 'u', isOnline: () => true }, { signal: ac.signal, timeoutMs: 5000 });
    setTimeout(() => ac.abort(), 10);
    expect(await p).toMatchObject({ ok: false, kind: 'cancelled', message: '' });
    const f2 = vi.fn();
    expect(await scanReceiptFile(file, { resize, fetch: f2 as any, url: 'u', isOnline: () => false })).toMatchObject({ kind: 'offline' });
    expect(f2).not.toHaveBeenCalled();
  });

  it('server 422 manual → "fill manually" with the server text', async () => {
    const f = vi.fn(async () => json(422, { error: "qo'lda to'ldiring", manual: true }));
    expect(await scanReceiptFile(file, { resize, fetch: f as any, url: 'u', isOnline: () => true })).toEqual({ ok: false, kind: 'manual', message: "qo'lda to'ldiring" });
  });
});
