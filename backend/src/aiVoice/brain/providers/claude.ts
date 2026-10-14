import { aiConfig } from '../../config';
import { toProviderSchema } from '../schema';
import type { FetchLike } from './openrouter';
import {
  ProviderError, trimHistory, type ProviderSession, type ProviderStartOpts, type ProviderToolResult, type ProviderTurn, type TextProvider,
} from './types';

// Claude — IXTIYORIY adapter (llm-provider.md): faqat ANTHROPIC_API_KEY bo'lsa VA sozlamada
// brain.provider='claude' tanlansa ishlatiladi; xatosida Gemini/OpenRouter'ga o'tiladi. @anthropic-ai/sdk
// O'RNATILMAGAN (yangi bog'liqlik qo'shilmaydi) — shu sabab to'g'ridan-to'g'ri Messages API (fetch).
//  • model: AI_CLAUDE_MODEL (standart claude-opus-5-5); thinking parametri YUBORILMAYDI (Opus 5.5'da
//    doim yoqiq, disabled → 400); chuqurlik output_config.effort bilan (sozlama, standart 'low');
//  • tool_choice faqat 'auto' (majburiy any/tool → 400); har bir tool strict:true;
//  • assistant javobi (thinking bloklari bilan) tarixga O'ZGARISHSIZ qo'shiladi; barcha tool_result'lar
//    BITTA user xabarida (is_error bilan); pause_turn — qayta yuboriladi; refusal — muloyim rad;
//    max_tokens'da chala tool_use bajarilmaydi;
//  • server tomonidagi zaxira modeli: beta server-side-fallback-2026-07-01 + fallbacks:'default'.

export const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const MAX_PAUSE_CONTINUATIONS = 3;

/** Claude ketma-ket bir xil rolli xabarlarni birlashtiradi; birinchi xabar user bo'lishi kerak. */
function toClaudeHistory(h: ProviderStartOpts['history'], userText: string): any[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of [...trimHistory(h), { role: 'user' as const, text: userText }]) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.text}`;
    else out.push({ role: m.role, content: m.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

const textOf = (content: any[]) => content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('').trim();

class ClaudeSession implements ProviderSession {
  private messages: any[];
  constructor(private o: ProviderStartOpts, private fetchImpl: FetchLike, private apiKey: string, private model: string) {
    this.messages = toClaudeHistory(o.history, o.userText);
  }

  private async post(signal: AbortSignal): Promise<any> {
    const body = {
      model: this.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: this.o.system, cache_control: { type: 'ephemeral' } }],
      ...(this.o.tools.length ? {
        tools: this.o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: toProviderSchema(t.parameters, 'claude'), strict: true })),
        tool_choice: { type: 'auto' },
      } : {}),
      messages: this.messages,
      output_config: { effort: this.o.effort },
      fallbacks: 'default',
    };
    const res = await this.fetchImpl(CLAUDE_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new ProviderError('claude', `HTTP_${res.status}`, res.status);
    const json = await res.json().catch(() => null);
    if (!json || !Array.isArray(json.content)) throw new ProviderError('claude', 'BAD_RESPONSE');
    return json;
  }

  async next(signal: AbortSignal): Promise<ProviderTurn> {
    const usage = { tokensIn: 0, tokensOut: 0, cacheReadTokens: 0 };
    let model = this.model;
    for (let i = 0; ; i++) {
      const json = await this.post(signal);
      const u = json.usage || {};
      usage.tokensIn += (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
      usage.tokensOut += Number(u.output_tokens) || 0;
      usage.cacheReadTokens += Number(u.cache_read_input_tokens) || 0;
      model = String(json.model || model);
      const content: any[] = json.content;
      switch (json.stop_reason) {
        case 'refusal':
          return { text: '', calls: [], model, usage, refusal: true };
        case 'pause_turn':
          this.messages.push({ role: 'assistant', content });
          if (i + 1 >= MAX_PAUSE_CONTINUATIONS) return { text: textOf(content), calls: [], model, usage, truncated: true };
          continue;
        case 'tool_use': {
          this.messages.push({ role: 'assistant', content });
          const calls = content.filter((b) => b?.type === 'tool_use').map((b) => ({
            id: String(b.id), name: String(b.name), args: b.input && typeof b.input === 'object' ? b.input : {},
          }));
          return { text: textOf(content), calls, model, usage };
        }
        case 'max_tokens':
          // Chala tool_use bloki bajarilmaydi
          return { text: textOf(content), calls: [], model, usage, truncated: true };
        default:
          return { text: textOf(content), calls: [], model, usage };
      }
    }
  }

  addToolResults(results: ProviderToolResult[]): void {
    // BARCHA natijalar bitta user xabarida — bittasi ham tashlab ketilmaydi
    this.messages.push({
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.result),
        ...(r.result.status === 'error' || r.result.status === 'denied' ? { is_error: true } : {}),
      })),
    });
  }
}

export function createClaudeProvider(deps: { fetchImpl?: FetchLike; apiKey?: string; model?: string; requestTimeoutMs?: number } = {}): TextProvider {
  return {
    name: 'claude',
    requestTimeoutMs: deps.requestTimeoutMs ?? 45_000,
    start: (o) => new ClaudeSession(
      o, deps.fetchImpl || (globalThis.fetch as unknown as FetchLike),
      deps.apiKey ?? (process.env.ANTHROPIC_API_KEY || '').trim(), deps.model || aiConfig.brain.claudeModel,
    ),
  };
}
