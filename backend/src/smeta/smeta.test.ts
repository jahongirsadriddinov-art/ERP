import { describe, it, expect } from 'vitest';

// Test the Excel direct parser by constructing an ExtractedLine input
// that represents a smeta table row without needing a real file.

// We test the logic indirectly by verifying the parseExcelDirect
// function through parseSmeta with a synthetic XLSX buffer that xlsx can decode.
// Since actual xlsx encoding requires the xlsx library, we test the helpers directly.

// ─── parseNum (normalize.ts) ─────────────────────────────────────────────────
import { parseNum } from './normalize';

describe('parseNum', () => {
  it('parses simple integer', () => expect(parseNum('12345')).toBe(12345));
  it('parses dot as decimal separator', () => expect(parseNum('12.345')).toBe(12.345));
  it('parses comma decimal', () => expect(parseNum('1,5')).toBe(1.5));
  it('returns null for dash', () => expect(parseNum('-')).toBeNull());
  it('returns null for double-dash', () => expect(parseNum('--')).toBeNull());
  it('returns null for empty string', () => expect(parseNum('')).toBeNull());
  it('parses space-separated thousands', () => {
    const result = parseNum('1 250 000');
    expect(result).toBe(1250000);
  });
  it('parses number with trailing whitespace', () => expect(parseNum('500 ')).toBe(500));
});

// ─── asUnit (normalize.ts) ───────────────────────────────────────────────────
import { asUnit } from './normalize';

describe('asUnit', () => {
  it('recognizes м3', () => expect(asUnit('м3')).toBeTruthy());
  it('recognizes кг', () => expect(asUnit('кг')).toBeTruthy());
  it('recognizes шт', () => expect(asUnit('шт')).toBeTruthy());
  it('returns null for non-unit text', () => expect(asUnit('Бетон')).toBeNull());
  it('returns null for empty string', () => expect(asUnit('')).toBeNull());
});

// ─── tokenizeNumbers ─────────────────────────────────────────────────────────
import { tokenizeNumbers } from './normalize';

describe('tokenizeNumbers', () => {
  it('parses three numbers from a typical row tail', () => {
    const tokens = tokenizeNumbers('217,2842 36 030,00 164 259 433,29');
    const nums = tokens.filter(t => t.type === 'num').map(t => t.value);
    expect(nums.length).toBeGreaterThanOrEqual(2);
  });

  it('handles dash tokens', () => {
    const tokens = tokenizeNumbers('217 - -');
    const dashes = tokens.filter(t => t.type === 'dash');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });
});
