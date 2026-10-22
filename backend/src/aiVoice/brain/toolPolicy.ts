import type { ToolResult } from '../contracts';
import { normApostrophes, toLatinUz } from './style';

// Agent darajasidagi tool siyosati (brain):
//  • explicitDecision — "o'z qarori" (ownDecision) tool'lari (approveTransaction/rejectTransaction)
//    FAQAT foydalanuvchining SHU navbatdagi aniq buyrug'i bo'lsa bajariladi ("tasdiqla", "rad et",
//    "утверди"...), yoki AI oldingi javobida aynan shuni so'ragan va foydalanuvchi "ha" degan bo'lsa.
//    Tool natijasidagi matn (untrusted) yoki modelning o'zi qaror qila olmaydi (prompt-injection himoyasi).
//  • capToolResult — modelga qaytadigan natija hajmi chegarasi (tezlik + token tejash).

// XAVFSIZLIK (audit 2026-10-19): faqat BUYRUQ shakli ("tasdiqla", "tasdiqlang", "tasdiqlayman"). Savol/ot shakli
// ("tasdiqlash kerak bo'lganlar qaysi?", "tasdiqlanmagan", "tasdiq kutyapti") o'tmaydi — aks holda injeksiya qilingan
// ERP matni shunchaki ro'yxat so'ralganda ham tranzaksiyani tasdiqlatib yuborishi mumkin edi.
export const APPROVE_RE = /tasdiqla(?!sh)(?!n(?!g))|tasdiqlab\s*(ber|qo['ʻ’`]?y)|ma['ʻ’`]?qulla(?!sh)(?!n(?!g))|qabul\s*qil(?![ia]n)|\bapprove\b|утверди(?!т)|утверждаю|одобри|одобряю|подтверди|подтверждаю|прими(?![а-яё])|принимаю/i;
export const REJECT_RE = /rad\s*(et(?!il)|qil(?![ia]n))|qaytar(?!il)|\breject\b|\bdecline\b|отклони|отклоняю|откажи/i;
const AFFIRM_RE = /^\s*(ha|xa|haa+|ok|okey|mayli|albatta|bo['ʻ’`]?pti|roziman|да|ага|хорошо|конечно|давай)(?=$|[\s.,!])/i;

export type DecisionKind = 'approve' | 'reject';

export function decisionKindOf(tool: string): DecisionKind | null {
  if (tool === 'approveTransaction') return 'approve';
  if (tool === 'rejectTransaction') return 'reject';
  return null;
}

export function explicitDecision(kind: DecisionKind, userText: string, history: { role: string; text: string }[] = []): boolean {
  const re = kind === 'approve' ? APPROVE_RE : REJECT_RE;
  // Kirill o'zbekcha ("тасдиқла", "рад эт") va tarixdagi kirillcha AI javobi ham (uz-cyrl foydalanuvchi)
  const both = (s: string) => [s, normApostrophes(toLatinUz(s))];
  const text = String(userText || '').slice(0, 500);
  if (both(text).some((x) => re.test(x))) return true;
  if (!both(text).some((x) => AFFIRM_RE.test(x))) return false;
  const lastAi = [...(Array.isArray(history) ? history : [])].reverse().find((h) => h?.role === 'assistant');
  return !!lastAi && both(String(lastAi.text || '').slice(-400)).some((x) => re.test(x));
}

export const MAX_RESULT_CHARS = 6000;

function cutArrays(v: unknown, limit: number, depth = 0): unknown {
  if (depth > 8 || v === null || typeof v !== 'object' || v instanceof Date) return v;
  if (Array.isArray(v)) return v.slice(0, limit).map((x) => cutArrays(x, limit, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = cutArrays(x, limit, depth + 1);
  return out;
}

/** Natija JSON'i chegaradan oshsa — massivlar qisqartiriladi (truncated:true); baribir katta bo'lsa — data tashlanadi. */
export function capToolResult(r: ToolResult, maxChars = MAX_RESULT_CHARS): ToolResult {
  if (r?.data === undefined) return r;
  const size = (d: unknown) => { try { return JSON.stringify(d)?.length ?? 0; } catch { return Infinity; } };
  if (size(r.data) <= maxChars) return r;
  for (const limit of [15, 8, 4, 2]) {
    const d = cutArrays(r.data, limit);
    const wrapped = d && typeof d === 'object' && !Array.isArray(d) ? { ...(d as object), truncated: true } : { items: d, truncated: true };
    if (size(wrapped) <= maxChars) return { ...r, data: wrapped };
  }
  return { ...r, data: { truncated: true } };
}
