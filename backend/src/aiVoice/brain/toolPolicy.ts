import type { ToolResult } from '../contracts';

// Agent darajasidagi tool siyosati (brain):
//  • explicitDecision — "o'z qarori" (ownDecision) tool'lari (approveTransaction/rejectTransaction)
//    FAQAT foydalanuvchining SHU navbatdagi aniq buyrug'i bo'lsa bajariladi ("tasdiqla", "rad et",
//    "утверди"...), yoki AI oldingi javobida aynan shuni so'ragan va foydalanuvchi "ha" degan bo'lsa.
//    Tool natijasidagi matn (untrusted) yoki modelning o'zi qaror qila olmaydi (prompt-injection himoyasi).
//  • capToolResult — modelga qaytadigan natija hajmi chegarasi (tezlik + token tejash).

export const APPROVE_RE = /tasdiq|ma['ʻ’`]?qulla|qabul\s*qil|approve|confirm|утверд|одобр|подтверд|прими|принять|приму/i;
export const REJECT_RE = /rad\s*(et|qil|qilin)|qaytar|reject|decline|отклон|отказ/i;
const AFFIRM_RE = /^\s*(ha|xa|haa+|ok|okey|mayli|albatta|bo['ʻ’`]?pti|roziman|да|ага|хорошо|конечно|давай)(?=$|[\s.,!])/i;

export type DecisionKind = 'approve' | 'reject';

export function decisionKindOf(tool: string): DecisionKind | null {
  if (tool === 'approveTransaction') return 'approve';
  if (tool === 'rejectTransaction') return 'reject';
  return null;
}

export function explicitDecision(kind: DecisionKind, userText: string, history: { role: string; text: string }[] = []): boolean {
  const re = kind === 'approve' ? APPROVE_RE : REJECT_RE;
  const text = String(userText || '').slice(0, 500);
  if (re.test(text)) return true;
  if (!AFFIRM_RE.test(text)) return false;
  const lastAi = [...(Array.isArray(history) ? history : [])].reverse().find((h) => h?.role === 'assistant');
  return !!lastAi && re.test(String(lastAi.text || '').slice(-400));
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
