import type { JsonSchema } from '../contracts';

// Tool parametrlari sxemasini provayder formatiga o'tkazish. Barcha provayderlar uchun xavfsiz
// qism-to'plam: type, description, properties, required, enum, items, additionalProperties:false.
// Cheklovlar (min/max, uzunlik, pattern, objectId) TAVSIFGA yoziladi — ularni baribir
// tools/validate.ts serverda tekshiradi (model argumentlari ishonchsiz).
// Claude strict rejimi minimum/maxLength kabi kalitlarni qabul qilmaydi; 'date'/'time'/'date-time'
// formatlari esa qo'llab-quvvatlanadi — faqat Claude uchun saqlanadi.

export type SchemaMode = 'gemini' | 'openai' | 'claude';

function hints(s: JsonSchema, mode: SchemaMode): string[] {
  const h: string[] = [];
  if (s.format === 'objectId') h.push('24-character hex id');
  if (s.format === 'date' && mode !== 'claude') h.push('YYYY-MM-DD');
  if (s.format === 'time' && mode !== 'claude') h.push('HH:mm');
  if (s.format === 'date-time' && mode !== 'claude') h.push('ISO date-time');
  if (s.minimum !== undefined) h.push(`min ${s.minimum}`);
  if (s.maximum !== undefined) h.push(`max ${s.maximum}`);
  if (s.maxLength !== undefined) h.push(`max ${s.maxLength} chars`);
  if (s.maxItems !== undefined) h.push(`max ${s.maxItems} items`);
  return h;
}

export function toProviderSchema(s: JsonSchema, mode: SchemaMode, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type };
  const h = hints(s, mode);
  const desc = [s.description, h.length ? `(${h.join(', ')})` : ''].filter(Boolean).join(' ').trim();
  if (desc) out.description = desc;
  if (s.enum?.length) out.enum = [...s.enum];
  if (mode === 'claude' && s.type === 'string' && (s.format === 'date' || s.format === 'time' || s.format === 'date-time')) out.format = s.format;
  if (s.type === 'array' && s.items && depth < 6) out.items = toProviderSchema(s.items, mode, depth + 1);
  if (s.type === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties || {})) props[k] = toProviderSchema(v, mode, depth + 1);
    out.properties = props;
    out.required = [...(s.required || [])];
    out.additionalProperties = false;
  }
  return out;
}
