import type { ParsedExpense } from './botExpense';
import type { ExpenseContext } from './expenseContext';

// Ovozli chiqim oqimi (owner 2026-10-23: "juda sekin"). Avval hammasi KETMA-KET edi: xabar yuborish → fayl havolasi →
// yuklash → ro'yxatlar (Mongo) → Gemini (o'ylash bilan) → xabarni o'chirish → obyekt (Mongo) → tasdiqlovchi (Mongo, 1–3)
// → xodimlar (Mongo) → yangi xabar. Endi: yuklash, firma ro'yxati (60 s kesh) va tasdiqlovchi PARALLEL, Gemini tezkor
// rejimda, moslashtirish xotirada; natija "⏳ Tinglayapman…" xabarining o'rniga yoziladi. Audio Telegram'dagi OGG/Opus
// holida yuboriladi — Gemini uni to'g'ridan-to'g'ri qabul qiladi, qayta kodlash (transcode) yo'q.

export interface VoicePipelineDeps {
  download: () => Promise<Buffer>;
  loadContext: () => Promise<ExpenseContext>;
  loadApprover: () => Promise<any>;
  parse: (audio: Buffer, ctx: ExpenseContext) => Promise<ParsedExpense | null>;
}
export interface VoicePipelineResult {
  parsed: ParsedExpense | null; ctx: ExpenseContext; approver: any;
  timings: { download: number; context: number; ai: number; total: number };
}

export async function runVoiceExpensePipeline(d: VoicePipelineDeps): Promise<VoicePipelineResult> {
  const t0 = Date.now();
  const timed = <T>(p: Promise<T>) => p.then((v) => ({ v, ms: Date.now() - t0 }));
  // Tasdiqlovchi AI bilan parallel davom etadi (xato bo'lsa — null, sendExpenseDraft "tasdiqlovchi yo'q" deydi)
  const approverP = d.loadApprover().catch(() => null);
  const [audio, ctx] = await Promise.all([timed(d.download()), timed(d.loadContext())]);
  const tAi = Date.now();
  const parsed = await d.parse(audio.v, ctx.v);
  const ai = Date.now() - tAi;
  const approver = await approverP;
  return { parsed, ctx: ctx.v, approver, timings: { download: audio.ms, context: ctx.ms, ai, total: Date.now() - t0 } };
}
