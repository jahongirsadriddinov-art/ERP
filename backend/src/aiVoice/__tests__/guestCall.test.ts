import { describe, it, expect } from 'vitest';
import { parseGuestTarget } from '../routes/platformRoutes';
import { buildGuestVoicePrompt } from '../voice/prompts';

// Mehmon sinov qo'ng'irog'i (owner 2026-10-19): dasturchi panelidan Telegram raqami/@username → oddiy AI suhbati.
describe('parseGuestTarget', () => {
  it('accepts @username, bare username and t.me links', () => {
    expect(parseGuestTarget('@test_user')).toEqual({ username: 'test_user' });
    expect(parseGuestTarget('test_user')).toEqual({ username: 'test_user' });
    expect(parseGuestTarget('https://t.me/test_user')).toEqual({ username: 'test_user' });
  });
  it('normalizes phone numbers (9 digits → +998)', () => {
    expect(parseGuestTarget('+998 90 123-45-67')).toEqual({ phone: '+998901234567' });
    expect(parseGuestTarget('901234567')).toEqual({ phone: '+998901234567' });
  });
  it('rejects junk', () => {
    for (const v of ['', 'ab', '@1abc', '+12', 'x'.repeat(50), 123, null]) expect(parseGuestTarget(v)).toBeNull();
  });
});

describe('buildGuestVoicePrompt', () => {
  it('is a plain assistant with no company/ERP context', () => {
    const p = buildGuestVoicePrompt({ lang: 'uz', name: 'Ali', today: '2026-10-19', time: '12:00' });
    expect(p).toMatch(/mehmon, ERP foydalanuvchisi EMAS/);
    expect(p).toMatch(/endCall/);
    expect(p).toMatch(/suhbatdosh — Ali/);
    expect(p).not.toMatch(/getTodayOverview|listEmployees|approveTransaction|firma egasi/);
    expect(buildGuestVoicePrompt({ lang: 'ru', today: '2026-10-19' })).toMatch(/гость, НЕ пользователь ERP/);
  });
});
