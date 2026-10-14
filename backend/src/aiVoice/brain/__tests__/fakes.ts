// Brain testlari uchun soxta provayderlar: Gemini (GenaiLike) va fetch (OpenRouter / Claude).
// Hech qanday tarmoq chaqiruvi yo'q; har bir so'rov yozib olinadi (tekshirish uchun).
import type { GenaiLike } from '../providers/gemini';
import type { FetchLike } from '../providers/openrouter';

export type Step<Req> = (req: Req, i: number) => unknown | Promise<unknown>;

export function fakeGenai(steps: Step<any>[]) {
  const requests: any[] = [];
  const client: GenaiLike = {
    models: {
      generateContent: async (req: any) => {
        // Kontent massivi keyin mutatsiya qilinadi — nusxasini saqlaymiz
        requests.push(JSON.parse(JSON.stringify({ ...req, config: { ...req.config, abortSignal: undefined } })));
        const step = steps[Math.min(requests.length - 1, steps.length - 1)];
        return step(req, requests.length - 1);
      },
    },
  };
  return { factory: () => client, requests };
}

export const geminiCall = (name: string, args: Record<string, unknown> = {}, id?: string) => ({
  candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args, ...(id ? { id } : {}) }, thoughtSignature: 'sig' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
});
export const geminiText = (text: string) => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 20 },
});

export interface Recorded { url: string; headers: Record<string, string>; body: any }

export function fakeFetch(steps: Step<Recorded>[]) {
  const requests: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const rec = { url, headers: init.headers, body: JSON.parse(init.body) };
    requests.push(rec);
    const step = steps[Math.min(requests.length - 1, steps.length - 1)];
    const out: any = await step(rec, requests.length - 1);
    const status = out?.__status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => out, text: async () => JSON.stringify(out) };
  };
  return { fetchImpl, requests };
}

export const orToolCalls = (calls: { name: string; args?: Record<string, unknown> | string }[]) => ({
  model: 'test/model',
  choices: [{
    message: {
      role: 'assistant', content: null,
      tool_calls: calls.map((c, i) => ({
        id: `call_${i}_${c.name}`, type: 'function',
        function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args || {}) },
      })),
    },
    finish_reason: 'tool_calls',
  }],
  usage: { prompt_tokens: 50, completion_tokens: 5, cost: 0.0001 },
});
export const orText = (text: string) => ({
  model: 'test/model',
  choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 60, completion_tokens: 8, cost: 0.0002 },
});
