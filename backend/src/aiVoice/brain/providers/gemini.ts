import { GoogleGenAI } from '@google/genai';
import { aiConfig } from '../../config';
import type { ToolResult } from '../../contracts';
import { withGeminiKey } from '../../lib/geminiKeys';
import { toProviderSchema } from '../schema';
import {
  ProviderError, trimHistory, type ProviderSession, type ProviderStartOpts, type ProviderToolResult, type ProviderTurn, type TextProvider,
} from './types';

// Gemini — ASOSIY matn provayderi (llm-provider.md, owner 2026-10-13). @google/genai function
// calling, avtomatik funksiya chaqiruvi O'CHIQ (tool'larni faqat agent executor orqali bajaradi).
// Kalitlar — lib/geminiKeys.ts (yagona rotatsiya: 429/ruxsat xatosida keyingi kalit).
// Model javobidagi content (thoughtSignature bilan) tarixga O'ZGARISHSIZ qo'shiladi.

/** Testlar soxta mijoz beradi; haqiqiysi — GoogleGenAI. */
export interface GenaiLike { models: { generateContent(req: any): Promise<any> } }
export type GenaiFactory = (apiKey: string) => GenaiLike;

const clientCache = new Map<string, GenaiLike>();
const defaultFactory: GenaiFactory = (apiKey) => {
  let c = clientCache.get(apiKey);
  if (!c) {
    c = new GoogleGenAI({ apiKey }) as unknown as GenaiLike;
    if (clientCache.size > 20) clientCache.clear();
    clientCache.set(apiKey, c);
  }
  return c;
};

const toResponse = (r: ToolResult) => ({ status: r.status, message: r.message, ...(r.data !== undefined ? { data: r.data } : {}) });

class GeminiSession implements ProviderSession {
  private contents: any[];
  private round = 0;
  constructor(private o: ProviderStartOpts, private factory: GenaiFactory, private model: string) {
    this.contents = [
      ...trimHistory(o.history).map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] })),
      { role: 'user', parts: [{ text: o.userText }] },
    ];
  }

  async next(signal: AbortSignal): Promise<ProviderTurn> {
    const decls = this.o.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: toProviderSchema(t.parameters, 'gemini') }));
    const req = {
      model: this.model,
      contents: this.contents,
      config: {
        systemInstruction: this.o.system,
        ...(decls.length ? {
          tools: [{ functionDeclarations: decls }],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          automaticFunctionCalling: { disable: true },
        } : {}),
        maxOutputTokens: 2048,
        abortSignal: signal,
      },
    };
    const resp: any = await withGeminiKey((key) => this.factory(key).models.generateContent(req));
    this.round++;
    const cand = resp?.candidates?.[0];
    const content = cand?.content;
    const parts: any[] = Array.isArray(content?.parts) ? content.parts : [];
    const text = parts.filter((p) => typeof p?.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
    const calls = parts.filter((p) => p?.functionCall?.name).map((p, i) => ({
      id: String(p.functionCall.id || `g${this.round}_${i}`),
      name: String(p.functionCall.name),
      args: p.functionCall.args && typeof p.functionCall.args === 'object' ? p.functionCall.args : {},
    }));
    // Xavfsizlik bloki yoki bo'sh javob — "javobsiz" xato (agent zaxiraga o'tadi)
    if (!text && !calls.length) {
      throw new ProviderError('gemini', resp?.promptFeedback?.blockReason ? 'BLOCKED' : `EMPTY_${cand?.finishReason || 'NO_CANDIDATE'}`);
    }
    this.contents.push({ ...content, role: content?.role || 'model' });
    const um = resp?.usageMetadata || {};
    return {
      text, calls, model: this.model,
      usage: {
        tokensIn: Number(um.promptTokenCount) || 0,
        tokensOut: (Number(um.candidatesTokenCount) || 0) + (Number(um.thoughtsTokenCount) || 0),
        cacheReadTokens: Number(um.cachedContentTokenCount) || 0,
      },
    };
  }

  addToolResults(results: ProviderToolResult[]): void {
    this.contents.push({
      role: 'user',
      parts: results.map((r) => ({
        functionResponse: { ...(r.id.startsWith('g') ? {} : { id: r.id }), name: r.name, response: toResponse(r.result) },
      })),
    });
  }
}

export function createGeminiProvider(deps: { factory?: GenaiFactory; requestTimeoutMs?: number } = {}): TextProvider {
  const factory = deps.factory || defaultFactory;
  return {
    name: 'gemini',
    requestTimeoutMs: deps.requestTimeoutMs ?? 20_000,
    start: (o) => new GeminiSession(o, factory, o.model || aiConfig.models.text),
  };
}
