import { describe, it, expect } from 'vitest';
import { classifyMediaError, isUserMediaState, mediaErrorMessage, permissionHowTo } from './mediaErrors';

const err = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('mediaErrors', () => {
  it('classifies getUserMedia failures', () => {
    expect(classifyMediaError(err('NotAllowedError', 'The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.'))).toBe('denied');
    expect(classifyMediaError(err('NotFoundError'))).toBe('notfound');
    expect(classifyMediaError(err('NotReadableError', 'Could not start video source'))).toBe('busy');
    expect(classifyMediaError(err('TypeError', 'boom'))).toBe('other');
  });

  it('user states (denied / no device / busy) are not reported as bugs', () => {
    for (const n of ['NotAllowedError', 'NotFoundError', 'NotReadableError']) expect(isUserMediaState(err(n))).toBe(true);
    expect(isUserMediaState(err('TypeError', 'x is undefined'))).toBe(false);
  });

  it('gives a friendly Uzbek how-to per platform', () => {
    const m = mediaErrorMessage(err('NotAllowedError'), { video: true, platform: 'telegram-ios' });
    expect(m.title).toMatch(/ruxsat berilmagan/);
    expect(m.description).toMatch(/Sozlamalar → Telegram/);
    expect(permissionHowTo('telegram-android', 'camera')).toMatch(/Android.*Telegram.*Kamera/);
    expect(permissionHowTo('ios')).toMatch(/Safari/);
    expect(mediaErrorMessage(err('NotFoundError'), { platform: 'desktop' }).title).toMatch(/topilmadi/);
  });
});
