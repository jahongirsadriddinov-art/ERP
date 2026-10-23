import { describe, it, expect } from 'vitest';
import { classifyReplay, summarizeQueue, replayable, queueItemLabel, syncView, MAX_ATTEMPTS } from './syncQueue';

describe('offline queue replay rules', () => {
  it('2xx → done', () => {
    expect(classifyReplay(200, 1)).toEqual({ action: 'done' });
    expect(classifyReplay(201, 1)).toEqual({ action: 'done' });
  });

  it('a request that keeps failing with 4xx is marked failed with the reason (not retried forever)', () => {
    expect(classifyReplay(400, 1, 'Summa noto\'g\'ri')).toEqual({ action: 'failed', reason: "Server qabul qilmadi (400): Summa noto'g'ri" });
    expect(classifyReplay(403, 1).action).toBe('failed');
    expect(classifyReplay(404, 1).action).toBe('failed');
    expect(classifyReplay(401, 1).reason).toMatch(/qayta kiring/);
  });

  it('network / 5xx / 409 / 429 are retried, then marked failed after MAX_ATTEMPTS — never silently dropped', () => {
    for (const st of [0, 500, 503, 409, 429]) {
      expect(classifyReplay(st, 1).action).toBe('retry');
      const last = classifyReplay(st, MAX_ATTEMPTS);
      expect(last.action).toBe('failed');
      expect((last as any).reason).toMatch(new RegExp(`${MAX_ATTEMPTS} marta`));
    }
  });

  it('failed items are not replayed automatically and are counted separately', () => {
    const items = [{ id: 'a', ts: 2, failed: true }, { id: 'b', ts: 1 }, { id: 'c', ts: 3 }] as any[];
    expect(replayable(items).map((i) => i.id)).toEqual(['b', 'c']);
    expect(summarizeQueue(items)).toEqual({ pending: 2, failed: 1 });
  });

  it('labels items in plain Uzbek', () => {
    expect(queueItemLabel({ url: 'https://x/api/transactions', method: 'POST' })).toBe("Moliya yozuvi (chiqim/kirim/o'tkazma) — qo'shish");
    expect(queueItemLabel({ url: 'https://x/api/attendance/1', method: 'PATCH' })).toBe("Davomat — o'zgartirish");
  });
});

describe('sync bar state', () => {
  const app = (o: any = {}) => ({ count: 0, failed: 0, status: 'idle', ...o });
  const sw = (o: any = {}) => ({ count: 0, status: 'idle', ...o });
  it('offline wins, then syncing, error, pending, synced, hidden', () => {
    expect(syncView({ offline: true, app: app({ count: 2 }), sw: sw() })).toEqual({ view: 'offline', pending: 2, failed: 0 });
    expect(syncView({ offline: false, app: app({ status: 'syncing', count: 1 }), sw: sw() }).view).toBe('syncing');
    expect(syncView({ offline: false, app: app({ failed: 1, status: 'error' }), sw: sw() }).view).toBe('error');
    expect(syncView({ offline: false, app: app({ count: 1, status: 'pending' }), sw: sw({ count: 2 }) })).toEqual({ view: 'pending', pending: 3, failed: 0 });
    expect(syncView({ offline: false, app: app({ status: 'synced' }), sw: sw() }).view).toBe('synced');
    expect(syncView({ offline: false, app: app(), sw: sw() }).view).toBe('hidden');
  });
});
