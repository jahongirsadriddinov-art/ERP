import { aiConfig } from '../../config';
import { toProviderSchema } from '../schema';
import {
  ProviderError, trimHistory, type ProviderSession, type ProviderStartOpts, type ProviderToolResult, type ProviderTurn, type TextProvider,
} from './types';

// OpenRouter — ZAXIRA matn provayderi (owner 2026-10-13). OpenAI-mos Chat Completions + tool calling,
// oddiy fetch (yangi SDK yo'q). Kalit: OPENROUTER_API_KEY (faqat Render env). Model(lar): OPENROUTER_MODEL
// vergul bilan ro'yxat — birinchisi `model`, ≤3 tasi OpenRouter `models` zaxira massivi.
//
// STANDART (OPENROUTER_MODEL berilmasa): BEPUL, tool'larni qo'llaydigan modellar (FREE MODE — pilot
// pul to'lamaydi). 2026-10-14 da GET https://openrouter.ai/api/v1/models orqali tekshirildi
// (supported_parameters ichida "tools", narx 0):
//   google/gemma-4-31b-it:free → nvidia/nemotron-3-super-120b-a12b:free → openrouter/free
// Bepul modellar kunlik limitli; to'lov boshlangach masalan "google/gemini-3.1-flash-lite" qo'yiladi.

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_OPENROUTER_MODELS = ['google/gemma-4-31b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'openrouter/free'];

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; json(): Promise<any>; text(): Promise<string>;
}>;

function contentText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
  return '';
}

class OpenRouterSession implements ProviderSession {
  private messages: any[];
  constructor(private o: ProviderStartOpts, private fetchImpl: FetchLike, private models: string[], private apiKey: string) {
    this.messages = [
      { role: 'system', content: o.system },
      ...trimHistory(o.history).map((h) => ({ role: h.role, content: h.text })),
      { role: 'user', content: o.userText },
    ];
  }

  async next(signal: AbortSignal): Promise<ProviderTurn> {
    const tools = this.o.tools.map((t) => ({
      type: 'function', function: { name: t.name, description: t.description, parameters: toProviderSchema(t.parameters, 'openai') },
    }));
    const body = {
      model: this.models[0],
      ...(this.models.length > 1 ? { models: this.models.slice(0, 3) } : {}),
      messages: this.messages,
      ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
      max_tokens: 2048,
    };
    const res = await this.fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://erp-firma.uz',
        'X-Title': 'ERP AI',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new ProviderError('openrouter', `HTTP_${res.status}`, res.status);
    const json: any = await res.json().catch(() => null);
    if (!json || json.error) {
      const st = Number(json?.error?.code) || undefined;
      throw new ProviderError('openrouter', st ? `HTTP_${st}` : 'BAD_RESPONSE', st);
    }
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new ProviderError('openrouter', 'EMPTY');
    const toolCalls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const calls = toolCalls.map((tc, i) => {
      const id = String(tc?.id || `or_${i}`);
      const name = String(tc?.function?.name || '');
      const raw = tc?.function?.arguments;
      if (raw && typeof raw === 'object') return { id, name, args: raw };
      try {
        const parsed = raw ? JSON.parse(String(raw)) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? { id, name, args: parsed } : { id, name, args: {}, argsError: 'NOT_OBJECT' };
      } catch { return { id, name, args: {}, argsError: 'INVALID_JSON' }; }
    });
    const text = contentText(msg.content).trim();
    if (!text && !calls.length) throw new ProviderError('openrouter', 'EMPTY');
    // Assistant xabari (tool_calls, reasoning_details bilan) tarixga o'zgarishsiz qaytariladi
    this.messages.push({
      role: 'assistant', content: msg.content ?? null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      ...(msg.reasoning_details ? { reasoning_details: msg.reasoning_details } : {}),
    });
    const model = String(json.model || this.models[0]);
    const u = json.usage || {};
    const cost = typeof u.cost === 'number' ? u.cost : (model.endsWith(':free') || this.models[0].endsWith(':free') ? 0 : undefined);
    return {
      text, calls, model,
      usage: { tokensIn: Number(u.prompt_tokens) || 0, tokensOut: Number(u.completion_tokens) || 0, ...(cost !== undefined ? { costUsd: cost } : {}) },
    };
  }

  addToolResults(results: ProviderToolResult[]): void {
    for (const r of results) this.messages.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.result) });
  }
}

export function createOpenRouterProvider(deps: { fetchImpl?: FetchLike; models?: string[]; apiKey?: string; requestTimeoutMs?: number } = {}): TextProvider {
  return {
    name: 'openrouter',
    requestTimeoutMs: deps.requestTimeoutMs ?? 20_000,
    start: (o) => {
      const models = deps.models?.length ? deps.models : aiConfig.brain.openRouterModels.length ? aiConfig.brain.openRouterModels : DEFAULT_OPENROUTER_MODELS;
      const key = deps.apiKey ?? (process.env.OPENROUTER_API_KEY || '').trim();
      return new OpenRouterSession(o, deps.fetchImpl || (globalThis.fetch as unknown as FetchLike), models, key);
    },
  };
}
