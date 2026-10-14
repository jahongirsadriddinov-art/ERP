import type { JsonSchema } from '../contracts';
import { isObjectIdString } from '../lib/ids';
import { isHHmm, isIsoDate } from '../lib/zonedTime';

// Kichik JSON-schema qism-to'plami validatori (yangi bog'liqliksiz). Model argumentlari
// ishonchsiz: satrlar cheklanadi, noma'lum maydonlar TASHLAB yuboriladi (masalan model
// o'zicha qo'shgan "companyId" hech qachon handler'ga yetmaydi).

export const DEFAULT_STRING_MAX = 500;
const DEFAULT_ARRAY_MAX = 50;
const MAX_DEPTH = 5;

export type ValidateResult<T = any> = { ok: true; value: T } | { ok: false; error: string };

export function validateArgs<T = Record<string, unknown>>(schema: JsonSchema, raw: unknown): ValidateResult<T> {
  const input = raw === undefined || raw === null ? {} : raw;
  const r = check(schema, input, 'args', 0);
  return r.ok ? { ok: true, value: r.value as T } : r;
}

function check(s: JsonSchema, v: unknown, path: string, depth: number): ValidateResult {
  if (depth > MAX_DEPTH) return { ok: false, error: `${path}: juda chuqur` };
  switch (s.type) {
    case 'object': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: `${path}: object kutilgan` };
      const out: Record<string, unknown> = {};
      const props = s.properties || {};
      for (const req of s.required || []) {
        const x = (v as any)[req];
        if (x === undefined || x === null || x === '') return { ok: false, error: `${path}.${req}: majburiy` };
      }
      for (const [k, ps] of Object.entries(props)) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
        const x = (v as any)[k];
        if (x === undefined || x === null) continue;
        const r = check(ps, x, `${path}.${k}`, depth + 1);
        if (!r.ok) return r;
        out[k] = r.value;
      }
      return { ok: true, value: out };
    }
    case 'string': {
      if (typeof v !== 'string') return { ok: false, error: `${path}: satr kutilgan` };
      const str = v.trim();
      const max = Math.min(s.maxLength ?? DEFAULT_STRING_MAX, 4000);
      if (str.length > max) return { ok: false, error: `${path}: ${max} belgidan uzun` };
      if (s.minLength !== undefined && str.length < s.minLength) return { ok: false, error: `${path}: juda qisqa` };
      if (s.enum && !s.enum.includes(str)) return { ok: false, error: `${path}: ruxsat etilmagan qiymat` };
      if (s.pattern && !new RegExp(s.pattern).test(str)) return { ok: false, error: `${path}: format noto'g'ri` };
      if (s.format === 'objectId' && !isObjectIdString(str)) return { ok: false, error: `${path}: ID noto'g'ri` };
      if (s.format === 'date' && !isIsoDate(str)) return { ok: false, error: `${path}: sana YYYY-MM-DD bo'lishi kerak` };
      if (s.format === 'time' && !isHHmm(str)) return { ok: false, error: `${path}: vaqt HH:mm bo'lishi kerak` };
      if (s.format === 'date-time' && !Number.isFinite(Date.parse(str))) return { ok: false, error: `${path}: sana-vaqt noto'g'ri` };
      return { ok: true, value: str };
    }
    case 'number':
    case 'integer': {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, error: `${path}: son kutilgan` };
      if (s.type === 'integer' && !Number.isInteger(n)) return { ok: false, error: `${path}: butun son kutilgan` };
      if (s.minimum !== undefined && n < s.minimum) return { ok: false, error: `${path}: ${s.minimum} dan kichik` };
      if (s.maximum !== undefined && n > s.maximum) return { ok: false, error: `${path}: ${s.maximum} dan katta` };
      if (s.enum && !s.enum.includes(n)) return { ok: false, error: `${path}: ruxsat etilmagan qiymat` };
      return { ok: true, value: n };
    }
    case 'boolean': {
      if (typeof v === 'boolean') return { ok: true, value: v };
      if (v === 'true' || v === 'false') return { ok: true, value: v === 'true' };
      return { ok: false, error: `${path}: boolean kutilgan` };
    }
    case 'array': {
      if (!Array.isArray(v)) return { ok: false, error: `${path}: massiv kutilgan` };
      const max = Math.min(s.maxItems ?? DEFAULT_ARRAY_MAX, 500);
      if (v.length > max) return { ok: false, error: `${path}: ${max} tadan ko'p` };
      const out: unknown[] = [];
      for (let i = 0; i < v.length; i++) {
        if (!s.items) return { ok: false, error: `${path}: items aniqlanmagan` };
        const r = check(s.items, v[i], `${path}[${i}]`, depth + 1);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    default:
      return { ok: false, error: `${path}: noma'lum tur` };
  }
}
