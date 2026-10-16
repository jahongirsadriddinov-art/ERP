import { GoogleGenAI } from '@google/genai';
import type { ToolResult } from '../../contracts';
import { GeminiQuotaError, isDailyQuotaError, isQuotaError, isTransientError, withGeminiKey } from '../../lib/geminiKeys';
import { toProviderSchema } from '../schema';
import {
  ProviderError, trimHistory, type ProviderSession, type ProviderStartOpts, type ProviderToolResult, type ProviderTurn, type TextProvider,
} from './types';

// Gemini — ASOSIY matn provayderi (llm-provider.md, owner 2026-10-13). @google/genai function
// calling, avtomatik funksiya chaqiruvi O'CHIQ (tool'larni faqat agent executor orqali bajaradi).
// Kalitlar — lib/geminiKeys.ts (yagona rotatsiya; kvota kalit × MODEL bo'yicha).
// Model javobidagi content (thoughtSignature bilan) tarixga O'ZGARISHSIZ qo'shiladi.
//
// TEZLIK + KVOTA (owner 2026-10-16): standart — tez flash-lite modellar zanjiri (bepul tarifda kunlik
// limiti ham kattaroq). Model kvotaga urilsa / mavjud bo'lmasa / band bo'lsa — zanjirdagi keyingi
// model (har modelning o'z kvotasi bor). Fikrlash (thinking) minimal. ID'lar 2026-10-16 da
// GET /v1beta/models orqali tekshirildi: gemini-3.5-flash-lite, gemini-flash-lite-latest, gemini-3.8-flash.
// Almashtirish: AI_TEXT_MODEL (vergul bilan ro'yxat) yoki firma sozlamasi provider.textModel (birinchi bo'ladi).

export const DEFAULT_TEXT_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash'];

/** Bitta model urinishiga vaqt (osilib qolgan model butun so'rovni yeb qo'ymasin). */
const PER_MODEL_TIMEOUT_MS = 12_000;

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

/** Model zanjiri: sozlama → env AI_TEXT_MODEL → standart (takrorlarsiz). */
export function textModelChain(settingModel?: string, env = process.env.AI_TEXT_MODEL): string[] {
  const fromEnv = (env || '').split(',').map((m) => m.trim()).filter(Boolean);
  const list = [settingModel?.trim() || '', ...(fromEnv.length ? fromEnv : DEFAULT_TEXT_MODELS)].filter(Boolean);
  return [...new Set(list)].slice(0, 4);
}

/** thinkingConfig qo'llamaydigan modellar (400 qaytargan) — jarayon davomida eslab qolinadi. */
const noThinking = new Set<string>();

/**
 * Minimal fikrlash (tezlik). Model oilasiga qarab (2026-10-16 da tekshirilgan):
 *  flash-lite — thinkingLevel 'minimal'; gemini-3.8-flash / 2.5 — thinkingBudget 0. 'high' effort — standart.
 */
export function thinkingFor(model: string, effort: ProviderStartOpts['effort']): Record<string, unknown> | undefined {
  if (effort === 'high' || noThinking.has(model)) return undefined;
  if (/flash-lite/.test(model)) return { thinkingLevel: 'minimal' };
  if (/^gemini-(2\.5|3\.8)-flash$/.test(model)) return { thinkingBudget: 0 };
  return undefined;
}

const isModelGone = (e: any) => /\b404\b|NOT_FOUND|not found|no longer available|is not supported for generateContent/i.test(String(e?.message || e));
const isThinkingReject = (e: any) => /\b400\b|INVALID_ARGUMENT/i.test(String(e?.message || e)) && /thinking|invalid argument/i.test(String(e?.message || e));

const toResponse = (r: ToolResult) => ({ status: r.status, message: r.message, ...(r.data !== undefined ? { data: r.data } : {}) });

class GeminiSession implements ProviderSession {
  private contents: any[];
  private round = 0;
  private idx = 0;
  constructor(private o: ProviderStartOpts, private factory: GenaiFactory, private models: string[]) {
    this.contents = [
      ...trimHistory(o.history).map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] })),
      { role: 'user', parts: [{ text: o.userText }] },
    ];
  }

  private request(model: string, signal: AbortSignal, withThinking: boolean) {
    const decls = this.o.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: toProviderSchema(t.parameters, 'gemini') }));
    const thinkingConfig = withThinking ? thinkingFor(model, this.o.effort) : undefined;
    return {
      model,
      contents: this.contents,
      config: {
        systemInstruction: this.o.system,
        ...(decls.length ? {
          tools: [{ functionDeclarations: decls }],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          automaticFunctionCalling: { disable: true },
        } : {}),
        ...(thinkingConfig ? { thinkingConfig } : {}),
        maxOutputTokens: 1024,
        abortSignal: signal,
      },
    };
  }

  /** Bitta model: kalitlar rotatsiyasi + thinkingConfig rad etilsa — usiz bir marta. */
  private async callModel(model: string, outer: AbortSignal): Promise<any> {
    const signal = AbortSignal.any([outer, AbortSignal.timeout(PER_MODEL_TIMEOUT_MS)]);
    const send = (withThinking: boolean) => withGeminiKey((key) => this.factory(key).models.generateContent(this.request(model, signal, withThinking)), { scope: model });
    try {
      return await send(true);
    } catch (e) {
      if (!outer.aborted && thinkingFor(model, this.o.effort) && isThinkingReject(e)) {
        noThinking.add(model);
        return send(false);
      }
      throw e;
    }
  }

  async next(signal: AbortSignal): Promise<ProviderTurn> {
    let resp: any;
    let model = this.models[this.idx];
    let quota = null as { daily: boolean; retryAt: Date } | null;
    let lastErr: unknown = null;
    for (; this.idx < this.models.length; this.idx++) {
      model = this.models[this.idx];
      try {
        resp = await this.callModel(model, signal);
        break;
      } catch (e) {
        if (signal.aborted) throw e;
        lastErr = e;
        const timedOut = (e as any)?.name === 'TimeoutError' || (e as any)?.name === 'AbortError';
        if (isQuotaError(e)) {
          const daily = isDailyQuotaError(e);
          const retryAt = e instanceof GeminiQuotaError ? e.retryAt : new Date(Date.now() + 60_000);
          quota = { daily: (quota?.daily || false) || daily, retryAt: quota && quota.retryAt < retryAt ? quota.retryAt : retryAt };
          continue;
        }
        if (isModelGone(e) || isTransientError(e) || timedOut) continue;
        throw e;
      }
    }
    if (!resp) {
      this.idx = Math.max(0, this.models.length - 1);
      if (quota) throw new GeminiQuotaError(quota.daily, quota.retryAt);
      throw lastErr ?? new ProviderError('gemini', 'NO_MODEL');
    }
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
      text, calls, model,
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

export function createGeminiProvider(deps: { factory?: GenaiFactory; requestTimeoutMs?: number; models?: string[] } = {}): TextProvider {
  const factory = deps.factory || defaultFactory;
  return {
    name: 'gemini',
    requestTimeoutMs: deps.requestTimeoutMs ?? 30_000,
    start: (o) => new GeminiSession(o, factory, deps.models?.length ? deps.models : textModelChain(o.model)),
  };
}

/** Faqat testlar uchun. */
export function __resetGeminiThinkingForTests(): void { noThinking.clear(); }
