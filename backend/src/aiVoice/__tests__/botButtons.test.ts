import { describe, it, expect } from 'vitest';
import { aiBotCommandOf, aiBotButtonText } from '../bot/botHooks';

describe('AI klaviatura tugmalari', () => {
  it('tugma matni buyruq bilan bir xil ishlaydi (uz/ru)', () => {
    expect(aiBotCommandOf(aiBotButtonText('ai', 'uz'))).toBe('ai');
    expect(aiBotCommandOf(aiBotButtonText('ai', 'ru'))).toBe('ai');
    expect(aiBotCommandOf(aiBotButtonText('schedule', 'uz'))).toBe('schedule');
    expect(aiBotCommandOf('/ai')).toBe('ai');
    expect(aiBotCommandOf('/jadval')).toBe('schedule');
    expect(aiBotCommandOf('salom')).toBeNull();
  });
});
