import { describe, it, expect } from 'vitest';
import { mapMonitors } from './uptime';

describe('mapMonitors (UptimeRobot v2)', () => {
  it('maps status codes, uptime ratios and response time', () => {
    const out = mapMonitors({ monitors: [
      { id: 1, friendly_name: 'Backend', url: 'https://x/health', status: 2, custom_uptime_ratio: '100.000-99.981-99.5', average_response_time: '412.7' },
      { id: 2, friendly_name: 'Sayt', url: 'https://www', status: 9, custom_uptime_ratio: '' },
      { id: 3, url: 'https://p', status: 0 },
    ] });
    expect(out[0]).toEqual({ id: 1, name: 'Backend', url: 'https://x/health', status: 'up', uptime: { d1: 100, d7: 99.98, d30: 99.5 }, responseMs: 413 });
    expect(out[1].status).toBe('down');
    expect(out[1].uptime).toEqual({ d1: null, d7: null, d30: null });
    expect(out[2]).toMatchObject({ name: 'https://p', status: 'paused' });
    expect(mapMonitors(null)).toEqual([]);
  });
});
