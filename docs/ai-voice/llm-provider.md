# Text brain provider (owner decisions 2026-10-13)

**UPDATE (2026-10-13, later the same day): Gemini is PRIMARY now** — the owner cannot obtain a Claude API key yet.
- Implement the Gemini text agent as the default and only active provider.
- Keep the Claude provider as an OPTIONAL adapter behind the same `TextAgent` interface: it is used only when
  `ANTHROPIC_API_KEY` is set AND the setting `brain.provider` is `claude` (default `gemini`). Without the key the
  code must not import-fail or log errors at startup. If Claude is selected and fails, fall back to Gemini.
- The Claude notes below stay valid for when the key becomes available.

**UPDATE 2 (2026-10-13): OpenRouter is the FALLBACK.** Order: Gemini (primary) → OpenRouter (fallback) → optional Claude
adapter (only if `ANTHROPIC_API_KEY` is ever set and selected).
- OpenRouter: OpenAI-compatible Chat Completions with tool calling at `https://openrouter.ai/api/v1/chat/completions`,
  env `OPENROUTER_API_KEY` (Render env only), `OPENROUTER_MODEL` (configurable; pick a tool-calling-capable model —
  verify the id and `supported_parameters` includes `tools` via `GET https://openrouter.ai/api/v1/models` at
  implementation time; allow a comma-separated list so OpenRouter's own `models` fallback array can be used).
  Send headers `HTTP-Referer: https://erp-firma.uz` and `X-Title: ERP AI`. Use plain `fetch` (no new SDK).
- Switch to OpenRouter when Gemini errors (429 quota, 5xx, timeout, network, safety block with no answer), or when
  Gemini is not configured. The same tool registry → OpenAI `tools` (function) format, same `executeTool` path,
  tool results returned as `role: "tool"` messages with `tool_call_id`. Meter usage (`usage.prompt_tokens`,
  `completion_tokens`, and OpenRouter's `usage.cost` if present) into `AiUsageMetrics` with `provider: 'openrouter'`.
- If OPENROUTER_API_KEY is missing, the fallback is simply skipped (no startup error).
- Tests: fake fetch covering tool loop, 429 from Gemini → OpenRouter, both failing → polite error, no success claim on tool error.

## Original plan: Claude primary, Gemini fallback

The **text agent** (`aiVoice/brain/textAgent.ts`, interface `TextAgent` in `aiVoice/contracts.ts`) answers
bot `/ai` messages, runs ERP tools, and serves as the text stage of the voice *cascade* fallback.
**Realtime voice stays on Gemini Live** (Claude has no realtime audio API).

## Primary: Claude Opus 5.5 via the official SDK

- Package: `@anthropic-ai/sdk` (0.133.x at time of writing). Credentials: env `ANTHROPIC_API_KEY` (Render env only, never in chat or code). Model from env `AI_CLAUDE_MODEL`, default `claude-opus-5-5` (exact id, no date suffix).
- Client: `new Anthropic()` (reads the env). Set `timeout` (ms) per call; keep `maxRetries` small (1) because we have our own fallback.
- Request shape (manual loop, because every tool call must go through our `executeTool` with RBAC, confirmation and audit):
  - `client.beta.messages.create({ model, max_tokens: 16000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }], tools, messages, output_config: { effort } })`
  - **Thinking:** omit `thinking` (Opus 5.5 always thinks; `{type:"disabled"}` and `budget_tokens` return 400). Control depth with `output_config.effort`: default `"low"` for bot/voice latency, `"medium"` for longer manager reports. Make it a setting.
  - **tool_choice:** only `auto` (forced `any`/`tool` returns 400 on Opus 5.5). Put `strict: true` on every tool, with `additionalProperties: false` and `required` in the input schema. Tool list order must be deterministic (prompt cache).
  - Loop: on `stop_reason` `tool_use`, append the assistant `response.content` **verbatim** (thinking blocks included), run all tool_use blocks through `executeTool`, return **all** results in **one** user message (`is_error: true` on failure, never drop one). `pause_turn` → append and re-send. `max_tokens` with a pending tool_use → do not run the tool. `refusal` → stop, reply with a polite fixed message, record it. `end_turn` → done. Cap at 5 tool rounds.
  - Always validate tool inputs (our `tools/validate.ts`) before executing; treat failures as `is_error` results.
  - Errors: catch typed classes (`Anthropic.RateLimitError`, `Anthropic.APIConnectionError`, `Anthropic.InternalServerError`, `Anthropic.APIError` with status) — never string-match. 429 / 5xx / connection / timeout → switch this request to the Gemini fallback. 400/401/403 → log + Gemini fallback + alert developer once.
  - Usage metering into `AiUsageMetrics`: `usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; Opus 5.5 pricing $4/M input, $20/M output, $0.20/M cache read (keep prices in `aiVoice/pricing.ts`).
  - The model only claims success after `executeTool` returned success (system prompt rule + tests with a fake client).

## Fallback: Gemini

- Same `TextAgent` interface, `@google/genai` function calling, keys from `aiVoice/lib/geminiKeys.ts`, model from env.
- Used when Claude is not configured (no `ANTHROPIC_API_KEY`), errors as above, or the company setting selects Gemini.
- The same tool registry is translated to Gemini function declarations; the same executor/RBAC path runs.

## Tests

- Fake Anthropic client (inject a `create` function) covering: tool loop with 2 rounds, all results in one message, refusal handling, pause_turn, max_tokens with partial tool_use, 429 → Gemini fallback, no success claim when a tool errors.
- No live API calls in CI; an opt-in `RUN_LIVE_TESTS=1` smoke test only.
