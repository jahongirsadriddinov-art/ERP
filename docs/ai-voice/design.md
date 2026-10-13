# AI Voice Assistant for QurilishERP: implementation design

Scope: this is a read-only design. No files were changed. Line numbers were checked against the current tree where noted. Env vars appear by name only.

---

## 0. Key decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Telegram user-account voice calls | A separate **Python 3.12 worker** (`tgcall-worker/`) running py-tgcalls 3.0.0, ntgcalls ≥3.0.3 (pinned exactly) and Telethon 1.45, in a Debian bookworm-slim Docker image. It hosts no AI. It only bridges audio and call signalling to the Node backend. | Bots cannot call (`phone.requestCall` is user-only). Node has no maintained P2P wrapper: the ntgcalls npm package would need 300–600 lines of hand-written signalling. A one-shot py-tgcalls call from a container has been shown to work. |
| D2 | Where the worker runs | **Railway** (Docker, one replica) as the default, or a small VPS (Hetzner or DigitalOcean) with docker compose. **Not** the Render free web service. Render Background Worker only after the built-in UDP probe passes. | Media needs outbound UDP to Telegram reflectors. Railway is shown to work; Render's UDP egress is undocumented. The free plan also sleeps and wipes the disk, and the session must never run twice (`AUTH_KEY_DUPLICATED`). |
| D3 | Worker ↔ backend link | The worker opens an **outbound Socket.IO connection** to a new namespace `/aiv-worker` on the existing server. The handshake is HMAC-signed (`AIV_WORKER_HMAC_SECRET`): `ts`, a `nonce` stored in a Mongo TTL collection, and `sig = HMAC_SHA256(secret, "aiv-worker\n"+workerId+"\n"+ts+"\n"+nonce)`, with a ±60 s window. Inside the connection: RPC messages carry `requestId`, there are sequenced binary audio frames, and only one worker connection is allowed per account (a lease). **Rejected:** letting Python poll Mongo directly, because that hands a third-party-library process full DB credentials, which breaks the "no unrestricted DB access" rule. | The worker needs no inbound port and no DB credentials. It reuses socket.io, which is already installed, and python-socketio supports binary data and namespaces. `io.use` (socket.ts:83) applies only to the `/` namespace, so the JWT auth for normal clients is untouched. |
| D4 | One central AI brain | **All AI runs in Node.** The Telegram call audio path: worker (48 kHz s16le) → resampled to 16 kHz → `/aiv-worker` → the same `VoiceSessionManager` used for in-app calls → Gemini Live. The reply comes back at 24 kHz → worker upsamples to 48 kHz → `send_frame`, paced every 10 ms with silence fill. | One prompt, tool, RBAC, metering and audit path. The extra hop costs about 50–150 ms, which is acceptable. A worker that talks to Gemini directly is left as a later optimisation behind a flag. |
| D5 | In-app transport | Binary PCM over the **existing authenticated Socket.IO connection**, using `aiv:*` events. Capture is 16 kHz PCM16 in 40 ms frames (1280 B). Playback is 24 kHz PCM16. **Not WebRTC.** | Gemini Live only speaks WebSocket. WebRTC would need a server-side media stack (node-datachannel or LiveKit, i.e. a new vendor) plus TURN, which is not reliably available (Metered is optional, openrelay is a fallback). The socket already carries a JWT that is re-checked against the DB (socket.ts:83-98) and is reachable from web, the APK WebView and the WebView2 EXE. |
| D6 | Voice provider | **Primary:** Gemini Live `gemini-3.8-live` through the Node relay (new `@google/genai` 2.x SDK, Node ≥20), with input and output transcription, server VAD at 600 ms, `sessionResumption` and `contextWindowCompression`. **Fallback 1:** a Gemini cascade: `gemini-3.5-transcribe-live` → `gemini-3.8-flash` (function calling) → `gemini-3.8-flash-tts` (streamed, split per sentence). **Fallback 2 (optional):** Yandex SpeechKit for uz-UZ speech in and out, only if Uzbek quality fails the evaluation. For in-app calls there is a final browser `speechSynthesis` fallback. | Uzbek and Russian are listed for Live and TTS, and the existing `GEMINI_API_KEYS` can be reused, so no new credentials are needed. Uzbek quality is **not proven** (≈75% confidence), so a 1-day evaluation with real workers is a gate before rollout. Model ids live in env/settings, not in code. Google Cloud TTS has no uz-UZ voice. Groq stays only for the existing `/api/ai/chat` and is not touched. |
| D7 | Ephemeral tokens (browser straight to Gemini) | Not used in v1. | Tool calls would run in the client, and metering and redaction would be lost. |
| D8 | Scheduler | **Mongo-persisted job queue** (`AiJob`) with leases (`leaseOwner`, `leaseUntil`, heartbeats), unique `dedupeKey`s for idempotent ticks, exponential backoff, per-type concurrency, and a SIGTERM drain. **No Redis, no new queue library.** Periodic ticks use minute-bucket dedupe keys (copying the atomic-claim pattern at `expenseInsights.ts:126-145`). | It survives restarts and is safe if Render ever runs more than one instance. There are no new paid services. |
| D9 | No parallel calls to one person | A **partial unique index** on `AiCallSession {employeeId:1}` where `isActive:true`, shared by the in-app and Telegram channels. A duplicate-key error is treated as "busy" and the step is requeued +60 s. | This is a DB-level guarantee, so it does not depend on locks held in memory. |
| D10 | Attendance truth | Three separate facts are stored: `voiceAnswer`, `buttonAnswer`, and `checkInAt`. `checkInAt` is filled **only** by a reconciler that reads `Attendance` (written by the existing geofence check-in in routes/attendance.ts and bot `doCheckIn` bot.ts:720). The AI never writes `Attendance`. After the confirm button it shows the existing `confirm_checkin` button (live location → geofence). | Requirement: voice "yes" is not a button confirm, and neither is a real check-in. The geofence and the shift gate cannot be bypassed. |
| D11 | Who owns the Telegram account | **One platform-level account in v1**, connected by `dasturchi` in the DeveloperPanel. `AiChannelConnection` supports `scope:'company'` for later. | Ban/ToS risk and running one worker are easier to control centrally. Companies opt in through settings. |
| D12 | Tenant isolation for AI | Every tool runs inside `runWithTenant(ctx)` (tenantContext.ts:28). The context is built from the **session**, never from model output. Queries use `scoped()`/`stamped()` (scope.ts:22,35) **plus** an explicit `companyId` filter, because `scoped()` is a no-op with no context. Plan gating uses `companyHasFeature('ai_assistant')`, which fails closed. | Closes the known `scoped()` no-op hole for background and bot paths. |

---

## 1. Architecture

```
            ┌──────────── Render: qurilisherp-backend (Node/Express5) ───────────────┐
 Web/APK/EXE│ Socket.IO "/"  aiv:* (JWT) ──► VoiceSessionManager ──► Gemini Live      │
  (AudioWorklet)                              │  ▲ tools                (fallback:   │
            │ REST /api/ai-voice/* ───────────┤  │                      cascade)     │
            │                                 ▼  │                                   │
            │ ToolExecutor (RBAC+runWithTenant+redact+audit+usage) ◄── TextAgent     │
            │       ▲                                    ▲ (bot text/voice-note Q&A) │
            │ JobQueue(AiJob leases) ─ Planner/AttendanceFlow/Reminders/Reconciler   │
            │       │ ChannelRegistry: telegram_call | bot_message | inapp_call |    │
            │       │                  push | notify_manager                         │
            │ Socket.IO "/aiv-worker" (HMAC) ◄────────── outbound WSS ──────────┐    │
            │ bot.ts ──hooks──► aiVoice/bot/botHooks (ai: callbacks, /ai mode)  │    │
            └───────────────────────────────────────────────────────────────────┼────┘
                                                                               │
            Railway/VPS: tgcall-worker (Python, Telethon+py-tgcalls) ──────────┘
                         ──► Telegram MTProto (TCP) + reflectors (UDP)
```

---

## 2. Data models

All models go in `backend/src/models/`, following the existing convention: `companyId` and `employeeId` are **String**, and `timestamps: true`.

### AiAssistantSettings
- Unique index `{companyId:1}`.
- Fields:
  - `companyId`, `enabled:false`, `language:'uz'|'ru'|'auto'`, `voiceName:'Kore'`, `timezone:'Asia/Tashkent'`, `disclosureText?`
  - `attendance:{ enabled, suppressLegacyMorningReminder:true, shifts:[{ id, name, objectIds[], roles['ishchi','prorab','brigadir'], callTime:'08:00', workdays:[1..6], lateAfterMin:15, absentCutoff:'12:00', buttonWaitMin:10 }] }`
  - `calls:{ maxAttemptsPerChannel:2, backoffMin:[3,10], ringTimeoutSec:45, maxDurationSec:120, assistantMaxDurationSec:600, companyConcurrency:3, minGapSec:20, quietHours:{from:'21:00',to:'07:00'} }`
  - `fallbackOrder:['telegram_call','bot_message','inapp_call','push','notify_manager']`
  - `reminders:{ defaultLeadMin:0, defaultChannels:['bot_message','push'], maxActivePerUser:50 }`
  - `tools:{ byRole:{ direktor:[…], orinbosar:[…], prorab:[…], brigadir:[…], ishchi:[…] }, allowOffShiftAssistant:false }`
  - `provider:{ primary:'gemini_live', fallback:'gemini_cascade'|'none', liveModel?, textModel?, ttsModel?, transcribeModel? }`. Model ids only, never keys.
  - `limits:{ userSessionsPerHour:6, companyMinutesPerDay:120, monthlyBudgetUsd:20, hardStop:true, botMsgsPer10Min:20, toolCallsPerSession:30 }`
  - `privacy:{ recordAudio:false (locked false in v1), transcriptRetentionDays:30, auditRetentionDays:365 }`
  - `version` (optimistic concurrency), `updatedBy`

### AiChannelConnection
- Unique index `{scope:1, companyId:1, type:1}`.
- Fields:
  - `scope:'platform'|'company'`, `companyId:null|String`, `type:'telegram_user'|'telegram_bot'`
  - `status:'disconnected'|'awaiting_code'|'awaiting_password'|'connected'|'error'|'flood_wait'|'banned'`
  - `tgUserId`, `username`, `displayName`, `phoneMasked` (`+99890***12`)
  - `encryptedSession:{v,iv,tag,ct}` with `select:false`. AES-256-GCM using `AI_SECRETS_KEY`; `AI_SECRETS_KEY_PREV` is allowed for rotation.
  - `workerId`, `workerVersion`, `workerLeaseUntil`, `lastHealthAt`, `udpProbe:{ok,at}`
  - `activeCalls` (atomic counter), `dailyCallCount`, `dailyCallDay`, `floodWaitUntil`, `lastError`, `connectedBy`, `connectedAt`

### AiEmployeeContact
- Unique index `{companyId:1, employeeId:1}`. Also `{'telegram.tgUserId':1}` (sparse).
- Fields:
  - `companyId`, `employeeId`, `languageOverride?`
  - `channelPrefs:{ order?:ChannelName[], disabled:ChannelName[] }`
  - `telegram:{ tgUserId?, resolveStatus:'unknown'|'resolved'|'not_found'|'privacy_restricted'|'blocked', resolvedAt, callConsent:'none'|'requested'|'granted'|'revoked', consentAt }`
  - `optOut:{ calls:false, reminders:false, all:false, at, via }`
  - `botAiModeUntil?` (Telegram `/ai` mode)
  - `stats:{ lastCallAt, failuresInRow }`
- Consent events are also written to the existing `ConsentLog`.

### AiCallSession
- Indexes:
  - **unique partial `{employeeId:1}` with `partialFilterExpression:{isActive:true}`**
  - unique `{correlationId:1}`
  - `{companyId:1, createdAt:-1}`
  - `{confirmationId:1}`
  - `{status:1, updatedAt:1}`
- Fields:
  - `companyId`, `employeeId`, `correlationId`
  - `purpose:'attendance'|'assistant'|'reminder'|'test'`, `channel:'telegram_call'|'inapp_call'`, `direction`
  - `status:'queued'|'dialing'|'ringing'|'connected'|'completed'|'no_answer'|'busy'|'declined'|'failed'|'cancelled'|'interrupted'`, `isActive:boolean`
  - `attemptNo`, `jobId`, `confirmationId?`, `provider`, `model`, `resumptionHandle` (`select:false`)
  - `startedAt`, `answeredAt`, `endedAt`, `durationSec`, `endReason`, `errorCode`
  - `usage:{audioInSec,audioOutSec,tokensIn,tokensOut,costUsdMicros}`, `summary` (redacted), `recording:{enabled:false}`

### AiCallEvent
- Indexes: unique `{sessionId:1, seq:1}`; TTL on `{expiresAt:1}` with `expireAfterSeconds:0` (retention comes from settings).
- Fields: `companyId`, `sessionId`, `correlationId`, `seq`, `type:'state'|'transcript_in'|'transcript_out'|'tool_call'|'tool_result'|'error'|'usage'|'goaway'`, `at`, `data` (always passed through `redact()`), `expiresAt`.

### AiAttendanceConfirmation
- Indexes:
  - unique `{companyId:1, employeeId:1, date:1, shiftId:1}`
  - `{companyId:1, date:1, status:1}`
  - `{status:1, nextActionAt:1}`
  - unique sparse `{buttonToken:1}`
- Fields:
  - `companyId`, `employeeId`, `date` (YYYY-MM-DD in the company timezone), `shiftId`, `objectIds[]`, `scheduledAt`
  - `status:'pending'|'confirmed'|'late'|'declined'|'no_answer'|'call_failed'|'checked_in'|'absent'`
  - `voiceAnswer:'none'|'coming'|'late'|'not_coming'|'unclear'`, `voiceEtaMin?`
  - `buttonAnswer:'none'|'confirm'|'late'|'decline'`, `buttonAt`
  - `buttonToken` (10 base62 characters)
  - `checkInAt?`, `attendanceId?`
  - `attempts:[{channel, attemptNo, at, outcome, sessionId?, messageId?, errorCode?}]`
  - `stepIndex`, `nextActionAt`, `managerNotifiedAt?`, `correlationId`, `finalizedAt?`

### AiReminder
- Indexes:
  - `{status:1, nextFireAt:1}`
  - `{companyId:1, targetUserId:1, status:1}`
  - unique partial `{companyId:1, ownerId:1, idempotencyKey:1}` (where `idempotencyKey` exists)
- Fields:
  - `companyId`, `ownerId`, `targetUserId`, `text` (≤500), `timezone`, `dueAt` (UTC)
  - `recurrence:{ freq:'none'|'daily'|'weekdays'|'weekly'|'monthly', interval:1, byWeekday[], until?, count? }`
  - `nextFireAt`, `status:'active'|'done'|'cancelled'|'failed'`, `channels[]`, `lastFiredAt`, `fireCount`
  - `createdVia:'ui'|'voice'|'bot'|'telegram_call'`, `idempotencyKey?`, `sourceSessionId?`, `correlationId`

### AiActionAudit
- Indexes:
  - `{companyId:1, createdAt:-1}`
  - `{correlationId:1}`
  - unique partial `{companyId:1, idempotencyKey:1}`
  - unique sparse `{'pending.token':1}`
  - TTL `{expiresAt:1}`
- Fields:
  - `companyId`, `actorUserId`, `actorRole`, `targetUserId?`
  - `channel`, `sessionId?`, `correlationId`, `tool`, `kind:'read'|'write'`, `argsRedacted`
  - `status:'ok'|'denied'|'not_found'|'error'|'needs_confirmation'|'confirmed'|'cancelled'|'expired'`
  - `resultSummary`, `errorCode`, `idempotencyKey?`, `pending:{token, expiresAt, args (encrypted)}?`, `latencyMs`, `expiresAt`
- Writes are **also** mirrored into the existing `logAudit()` (services/audit.ts:18), so they appear in the current audit UI.

### AiUsageMetrics
- Unique index `{companyId:1, day:1, userId:1, provider:1, model:1}`. Written with `$inc` upserts.
- Fields: `userId` (null means the company aggregate), `sessions`, `audioInSec`, `audioOutSec`, `tokensIn`, `tokensOut`, `toolCalls`, `telegramCalls`, `botMessages`, `costUsdMicros`.

### Supporting collections (needed by D3 and D8)
- **AiJob:** `type`, `companyId?`, `employeeId?`, `refId?`, `payload`, `runAt`, `priority`, `status:'queued'|'leased'|'done'|'failed'|'dead'|'cancelled'`, `attempts`, `maxAttempts`, `leaseOwner`, `leaseUntil`, `lastError`, `dedupeKey?`, `correlationId`, `expiresAt`.
  - Indexes: `{status:1, runAt:1, priority:-1}`, unique sparse `{dedupeKey:1}`, `{leaseUntil:1}` partial on `status:'leased'`, TTL `expiresAt` (7 days after done).
- **AiNonce:** `{nonce unique, expiresAt TTL 10 min}`. Replay protection for the worker handshake and internal RPC.
- **AiRateCounter:** `{key unique, windowStart, count, expiresAt TTL}`. Mongo-backed rate limits and semaphores. It replaces in-memory `checkRate` for AI only.

### Existing model edits
- `models/AiConversation.ts`: add optional `source:'chat'|'voice_inapp'|'telegram_call'|'bot'`, `sessionId?` and `correlationId?`. The role enum stays as it is, so AIAssistant is unaffected. Only `purpose:'assistant'` voice sessions are saved there. Attendance calls go to `AiCallEvent` only.
- `models/User.ts`: add `UserSchema.index({telegramChatId:1},{sparse:true})`. This fixes the collection scans on every bot update.

---

## 3. Tools layer

### Location
`backend/src/aiVoice/tools/` contains `types.ts`, `registry.ts`, `executor.ts`, `rbac.ts` and `validate.ts`.

### Core types
```ts
type Purpose = 'assistant'|'attendance'|'reminder'|'test';
interface ToolCtx { companyId: string; userId: string; role: Role; isOwner: boolean; lang: 'uz'|'ru';
  tz: string; channel: 'inapp_call'|'telegram_call'|'bot'|'web'; purpose: Purpose; sessionId?: string; correlationId: string }
interface ToolResult { status: 'ok'|'denied'|'not_found'|'error'|'needs_confirmation'; message: string;
  data?: unknown; retryable: boolean; pendingActionId?: string }        // never {} (Live API requirement)
interface AiToolDef<A> { name: string; description: { uz: string; ru: string }; parameters: JsonSchema;
  kind: 'read'|'write'; defaultRoles: Role[]; purposes: Purpose[];
  confirm: 'never'|'always'|'when_other_user'; handler(ctx: ToolCtx, args: A): Promise<ToolResult> }
```

### What `executeTool(ctx, name, rawArgs, {idempotencyKey})` does, in order
1. Checks that the tool is in `settings.tools.byRole[ctx.role]` (owners get the direktor set). Checks the purpose allow-list.
2. Validates arguments with a small JSON-schema subset validator. No new dependency; strings are capped.
3. Checks the Mongo rate limit (`toolCallsPerSession`) and the budget guard.
4. If a write tool needs confirmation: returns `needs_confirmation` and creates an `AiActionAudit.pending` entry with a 32-byte token hash and a 5-minute expiry.
5. Otherwise runs `runWithTenant({userId, role, companyId, isOwner, isDeveloper:false}, handler)`. Every handler **also** filters on `companyId: ctx.companyId` explicitly.
6. Redacts output: phone numbers and `baseSalary` of anyone other than the caller are removed, **even for bosses**.
7. Writes `AiActionAudit`. Writes also go through `logAudit`.
8. Increments usage.

The model only sees `{status, message, data}`. The system prompt states: *"Report success only when status=='ok'. Never invent results."* The UI and bot show the authoritative result from the server-side `aiv:tool` event or the bot message, not the model's words.

### Tool mapping to existing data

| Tool | Data source | Roles (default) |
|---|---|---|
| `getMyTasks` | There is **no Task model**, so this aggregates: pending `Transaction` where `approverId==me` (or `requiresAdminApproval` for bosses), my active `AiReminder`s due today, pending `SignedDoc` for me, and today's `AiAttendanceConfirmation` if pending. Returns `note:'Vazifalar moduli hali yo'q'`. | all |
| `getMySchedule` | Today's `Attendance` status (NOT_STARTED/WORKING/FINISHED, same mapping as attendance.ts `/list` :65), `User.projectIds` → Object name/location, the settings shift (callTime, lateAfter), today's reminders. | all |
| `getProjectSummary(objectId\|name)` | `Object` fields; `Material` counts; workers via `User.find({projectIds:id})`; today present count; finance (confirmed non-transfer `Transaction` totals for 30 or 90 days via aggregate, **bosses only**). Prorab: only objects where `foremanId==me` or in `projectIds`, no finance unless `tools.byRole` allows `finance.objectSpend`. | direktor, orinbosar, prorab |
| `getInventoryBalance(objectId?, material?)` | `Material` needed/sent/remaining per object. The tool states clearly that this is not warehouse stock. | direktor, orinbosar, prorab, brigadir (own objects) |
| `getAttendanceSummary(date?, objectId?)` | `Attendance` for a date. Absent is inferred as eligible workers without a record, plus today's `AiAttendanceConfirmation` statuses. Boss: whole company. Prorab/brigadir: workers on their objects. Worker: self. | all (scoped) |
| `createReminder` / `updateReminder` / `cancelReminder` / `listReminders` | `AiReminder`. Self needs no confirmation. Bosses may target a same-company user (`confirm:'when_other_user'`). `idempotencyKey = hash(sessionId+turn)`. | all |
| `getAllowedFinancialReport(period)` | Bosses: totals by type and object (a new aggregate; `buildFinanceContext` in ai.ts is not reused, because it loads all 90-day transactions into memory). Others: own `PayrollRecord` (like `/api/payroll/mine`) and their own transactions only. | all (content by role) |
| `notifyManager(message, urgency)` | Manager = `Object.foremanId` of the user's objects, otherwise same-company direktor/orinbosar (**never** `notifyAdmins`). Delivered via `createNotification` + bot channel. `confirm:'always'`. | all |
| `getEmployeeProfile(userId\|name)` | `User`: name, role, position, brigade, objects. Phone and salary only when it is the caller. | all |
| **Purpose-restricted** `recordAttendanceAnswer(answer, etaMin?)` | Sets `voiceAnswer` only. | attendance purpose only |
| `optOutCalls()` | `AiEmployeeContact.optOut.calls`. | all |
| `endCall(reason)` | Session hang-up. | voice only |

Attendance calls expose only `recordAttendanceAnswer`, `optOutCalls`, `endCall` and `getMySchedule`.

---

## 4. Voice engine (backend `aiVoice/voice/`)

### Provider interface
`VoiceProvider.open(opts) → VoiceSession`. A session emits:
- `audioOut(Int16 24k)`
- `transcript({role, text, final})`
- `toolCall({id, name, args})`
- `interrupted`
- `goAway(timeLeft)`
- `usage`
- `closed(reason)`

It accepts `pushAudio(Int16 16k)`, `activityStart`/`activityEnd` (push-to-talk), `toolResponse` and `close`.

### GeminiLiveProvider
- Uses `@google/genai` `ai.live.connect`.
- Keys are rotated from `GEMINI_API_KEYS`/`GEMINI_API_KEY` by its own small parser. `gemini.ts` is not modified.
- If `setupComplete` has not arrived within 4 s, it falls back to the cascade.
- On GoAway it reconnects with the resumption handle.
- The system instruction comes from `prompts.ts`. It contains:
  - the mandatory disclosure: *"Assalomu alaykum, men {company} kompaniyasining sun'iy intellekt yordamchisiman."*
  - Uzbek Latin, or Russian if the user speaks Russian
  - short sentences
  - never reveal others' phone numbers or salaries
  - only claim success after `status:'ok'`

### CascadeProvider
- Energy VAD on the server (RMS plus a 500 ms hangover).
- Speech-to-text: `gemini-3.5-transcribe-live`, or `generateContent` with inline audio.
- Text: `TextAgent` (`gemini-3.8-flash` function calling, shared with the bot).
- Speech: TTS per sentence, streamed.
- If TTS fails: in-app sends text-only plus a client `speechSynthesis` fallback; Telegram ends the call and falls back to a bot message.

### FakeVoiceProvider
Scripted, used for tests.

### VoiceSessionManager
The single owner of an `AiCallSession`. It:
- inserts the session with `isActive:true` (a unique violation means busy)
- holds the company semaphore (`AiRateCounter` with `$inc` conditional on `$lt` the max)
- applies the duration limit: a "wrap up" instruction at limit−15 s and a hard stop at the limit
- enforces the tool-call cap
- writes redacted transcripts as `AiCallEvent` rows with `expiresAt` taken from settings
- turns usage into `AiUsageMetrics` and cost (`aiVoice/pricing.ts` table, overridable with env `AI_PRICING_JSON`)
- marks the session `interrupted` on SIGTERM

Transports plug in through `VoiceTransport {sendAudio, sendEvent, close}`: the in-app socket and the Telegram worker bridge.

---

## 5. Channels, scheduler and attendance flow

### Channel interface (`aiVoice/channels/types.ts`)
```ts
type ChannelName = 'telegram_call'|'bot_message'|'inapp_call'|'push'|'notify_manager';
interface ChannelAdapter { name: ChannelName;
  isAvailable(c: ChannelCtx): Promise<{ ok: boolean; reason?: string }>;
  attempt(c: ChannelCtx, r: ChannelRequest): Promise<{ outcome: 'answered'|'delivered'|'no_answer'|'busy'|'declined'
    |'failed'|'unavailable'|'skipped'; retryable: boolean; sessionId?: string; messageId?: string;
    errorCode?: string; awaitResponseUntil?: Date }> }
```

### Availability rules
- **telegram_call** needs all of:
  - the connection is `connected`, not in flood-wait, and under its daily cap (default 150)
  - `callConsent==='granted'` and `resolveStatus==='resolved'`
  - no opt-out and not in quiet hours
- **inapp_call** needs `isOnline(userId)` (socket.ts:320) and the client not busy in a WebRTC call.
- **bot_message** needs `telegramChatId` and the user not blocked.
- **push** uses `sendPushToUser` plus `createNotification`. The notification row matters: the Android BackgroundService poll is the only way to reach the APK, because there is no FCM.
- **notify_manager**: see the tools section.

### Jobs (`AiJob.type`)
| Job | Behaviour |
|---|---|
| `tick.planner` | dedupe `tick:planner:<YYYY-MM-DDTHH:mm>`. Each instance inserts on its 30 s loop; only the unique insert runs it. |
| `attendance.plan` | dedupe `att:plan:<companyId>:<date>:<shiftId>` |
| `attendance.step` | refId = confirmation |
| `attendance.reconcile` | every 2 min |
| `attendance.finalize` | at `absentCutoff` |
| `reminder.fire` | dedupe `rem:<id>:<nextFireAt>` |
| `retention.sweep` | daily |
| `connection.health` | — |

### Queue mechanics
- **Claim:** `findOneAndUpdate({status:'queued', runAt:{$lte:now}, type:{$in:typesWithCapacity}}, {$set:{status:'leased', leaseOwner:INSTANCE_ID, leaseUntil:now+60s}, $inc:{attempts:1}}, {sort:{priority:-1, runAt:1}})`.
- **Heartbeat** every 20 s for long jobs.
- **Sweeper:** expired leases go back to `queued`, or to `dead` once `attempts ≥ maxAttempts`.
- **Backoff:** `min(base·2^n, cap)` with jitter.
- **Shutdown** (`process.once('SIGTERM')`): stop claiming, release unstarted leases, end live sessions as `interrupted`, close the worker namespace, then exit within 25 s (Render allows 30 s).

### Planner
For each company where `settings.enabled && attendance.enabled`:
1. Compute local time with `Intl.DateTimeFormat(…, {timeZone})` (new `aiVoice/lib/zonedTime.ts`; `utils/tz.ts` stays as it is).
2. If today is a workday and local time is ≥ `callTime`, create a confirmation for each eligible employee. Eligible means: role in the shift roles, assigned to the shift objects via `User.projectIds`, not blocked, not opted out, and no check-in yet. Use upserts on the unique key.
3. Enqueue `attendance.step` jobs, spread out by `minGapSec` and `companyConcurrency`.

### AttendanceFlow (a pure state machine, unit-testable)
- Each step takes the next channel from `employee.channelPrefs.order ?? settings.fallbackOrder`, minus disabled or unavailable channels, and calls `attempt`. The channel is retried up to `maxAttemptsPerChannel` times with the backoff before moving on.
- **telegram_call answered:** the AI asks the question and records `voiceAnswer`. **Then** the bot always sends the buttons `ai:a:<token>:c|l|d` ("Tasdiqlayman / Kechikaman / Kelmayman"), and the flow waits `buttonWaitMin`.
- **Button press:** sets `buttonAnswer` and status `confirmed`, `late` or `declined`, then replies with the existing **check-in** button (`confirm_checkin`, the normal geofence flow).
- `declined`, or no answer after the whole chain: `notify_manager` (same company only). Status becomes `no_answer`, or `call_failed` if every call attempt failed technically and nothing else responded.
- **Reconciler:** `Attendance.find({userId:{$in}, date})` with `checkIn` → status `checked_in`, `checkInAt`. This overrides any non-terminal state.
- **Finalize at absentCutoff:** anything not `checked_in` or `declined` becomes `absent`. **Attendance is not written.**
- **Opt-out:** checked before every step.
- **Legacy reminder:** the existing morning reminder (bot.ts:2905) is skipped for users of companies where `suppressLegacyMorningReminder` is on.

### Reminders
- `nextFireAt` is computed in the reminder's timezone by `recurrence.ts` (daily, weekdays, weekly byWeekday, monthly with month-end clamping, until/count).
- Firing uses the target's channels.
- The bot message offers "✅ Bajarildi" and "⏰ 10 daqiqa" buttons (`ai:r:<id>:d|s`).
- Firing is idempotent through the dedupe key.

---

## 6. Telegram worker (`tgcall-worker/`, Python)

### Commands (backend → worker RPC)
`auth.start{phone}`, `auth.code{code}`, `auth.password{password}`, `auth.logout`, `status`, `contact.resolve{phone, userId}` (`contacts.importContacts`, returns `tgUserId` or `privacy_restricted`), `call.place{sessionId, tgUserId, timeoutSec}`, `call.hangup{sessionId}`, `udp.probe`.

### Events (worker → backend)
`call.state{sessionId, state: dialing|ringing|connected|ended, reason: busy|declined|timeout|privacy|blocked|outdated|flood_wait|network}` and `health{version, udpOk, activeCalls}`.

Audio uses binary frames `[16-byte sessionId][u32 seq][PCM16]`.

### Login flow (no secrets in chat)
1. The DeveloperPanel posts phone, then code, then 2FA password to `/api/ai-voice/platform/telegram-account/login/*`.
2. The backend relays these to the worker over RPC. It never persists or logs them, and the audit entry records only the step name.
3. On success the worker returns `StringSession.save()`.
4. The backend encrypts it into `encryptedSession`.
5. When the worker starts, it calls `session.fetch` over the authenticated namespace and keeps the session in memory only.

`TG_API_ID` and `TG_API_HASH` are env vars on the worker host.

### Mapping call results (py-tgcalls → outcome)
| py-tgcalls result | Outcome |
|---|---|
| `CallBusy` | busy |
| `CallDeclined` | declined/missed (`no_answer`). The reason is refined from raw `PhoneCallDiscarded`. |
| `TimedOutAnswer` | no_answer |
| `TelegramServerError` / network | failed, retryable |
| `USER_PRIVACY_RESTRICTED` | unavailable. Also sets `resolveStatus=privacy_restricted`. |
| `FloodWaitError` | connection becomes `flood_wait`; the channel reports unavailable and the flow falls back to the bot. |

### Ringing and limits
- Ringing is detected through a raw Telethon `UpdatePhoneCall(PhoneCallWaiting)` handler.
- Audio only, never video (SIGSEGV issue #69).
- At most 2 concurrent calls per account.
- A supervisor (`restart: unless-stopped`) restarts the worker.

### Consent and ToS
Before the first call, the bot sends a consent message:
- *"AI yordamchi (@account) sizga ertalab qo'ng'iroq qiladi. Ruxsat berasizmi?"*, with Allow / Deny buttons (`ai:o:<token>:y|n`).
- Granting triggers `contact.resolve`.
- Every call starts with the AI disclosure.

Other rules:
- Captured speech is never used for training.
- Use a dedicated aged account on a real SIM with 2FA.

---

## 7. API routes

All new routes live under `backend/src/aiVoice/routes/` and are mounted in index.ts next to `/api/ai` (:254).

### Company admin
Mounted as `app.use('/api/ai-voice', requireAuth, blockDeveloper, adminRouter)`. Inside: `requireAiAdmin` (isOwner, direktor or orinbosar, re-read from the DB) plus `companyHasFeature('ai_assistant')`, which fails closed.
- `GET`/`PUT /settings` (PUT requires `version`; 409 on mismatch)
- `GET /tools` (catalog for the role matrix)
- `GET /channels/status` (bot `getMe` username, webhook secret configured yes/no, platform Telegram account status masked)
- `GET /employees?q=`, `PATCH /employees/:userId` (channel order/disabled. An admin can disable a channel but cannot override an employee's opt-out.)
- `GET /attendance?date=&shiftId=`, `POST /attendance/run-now {shiftId}` (idempotent via the same dedupe key)
- `GET /calls`, `GET /calls/:id` (redacted events)
- `GET /audit?from&to&tool&status`, `GET /usage?from&to`
- `POST /test-call {userId, channel}` (5 per hour)

### Self
Mounted as `app.use('/api/ai-voice/me', requireAuth, blockDeveloper, meRouter)`. It is added to the workGate ALLOW list.
- `GET`/`PATCH /` (language, opt-out, consent, channel order)
- `GET`/`POST`/`PATCH`/`DELETE /reminders[/:id]`
- `POST /attendance/:id/respond {answer}` (web equivalent of the buttons)
- `GET /pending-call` (an AI ring still within its timeout, for users who opened the app from a notification)

### Platform
Mounted as `app.use('/api/ai-voice/platform', requireAuth, requireDeveloper, platformRouter)`, **before** the admin mount.
- `GET /telegram-account`
- `POST /telegram-account/login/start|code|password`, `POST /telegram-account/logout`
- `POST /telegram-account/test-call {userId}`
- `GET /worker`

### Socket events (main namespace)
- Client → server: `aiv:start {purpose:'assistant', ptt?:boolean}`, `aiv:accept {sessionId}`, `aiv:decline {sessionId, reason}`, `aiv:audio` (binary), `aiv:ptt {on}`, `aiv:confirm-action {pendingActionId, accept}`, `aiv:hangup`.
- Server → client: `aiv:incoming {sessionId, purpose, expiresAt}`, `aiv:ready`, `aiv:audio` (binary), `aiv:transcript`, `aiv:tool {name, status, message}`, `aiv:confirm {pendingActionId, summary}`, `aiv:interrupted`, `aiv:end {reason}`, `aiv:error`.
- For workers, `aiv:start` with purpose assistant is refused when they are off shift (`isOnShift`, workGate.ts) unless `allowOffShiftAssistant` is on. Attendance sessions are always allowed.

---

## 8. Frontend (`frontend/src/app/aiVoice/`)

### Audio
- `audio/capture.worklet.js`: Float32 at the device rate → a 16 kHz resampler with a low-pass → Int16, posted in 640-sample chunks.
- `audio/player.worklet.js`: 24 kHz ring buffer, 150 ms pre-buffer, `flush` message.
- `audio/pcmCapture.ts` and `audio/pcmPlayer.ts`: loaded with `audioWorklet.addModule(new URL('./x.worklet.js', import.meta.url))`, which Vite emits as an asset. Works offline in Tauri and Capacitor.
- `audio/resample.ts`: pure functions, unit tested.

### Session and call UI
- `useAiVoiceSession.ts`: socket events via `getSocket()` from `app/socket.ts`.
- `AiVoiceCallOverlay.tsx`: avatar and pulse, live transcript, mute, push-to-talk toggle (for noisy sites), hang up, and confirm cards for `aiv:confirm`.
- `AiIncomingCall.tsx`: ring UI using the existing `playSound('connecting')`. Accept is a user gesture, so it can `resume()` the AudioContext and call `getUserMedia`. **Media is not acquired before Accept**, unlike CallOverlay.tsx:279.
- `nativeAttention.ts`:
  - Tauri: `getCurrentWindow().show()/setFocus()/requestUserAttention()` plus the existing `sendNativeNotification` (platform.ts:242).
  - Android: `navigator.vibrate`.
- `AiVoiceRoot.tsx`: mounted once. It holds the incoming listener and the overlay, and takes props `{currentUser, busy}`. When `busy` (an active WebRTC call) it auto-declines with `busy`, so existing user-to-user calls are never interrupted.
- `bus.ts`: `openAiVoiceCall()`. AIAssistant and ChatPage call it.

### Settings
`settings/AiSettingsPanel.tsx`, an admin panel in ProfilePage, with tabs:
- General: enable, language, voice, timezone
- Schedule: shifts, workdays, call time, late and absent cutoffs
- Channels: fallback order (drag), attempts, timeout, button wait, duration, quiet hours, read-only Telegram bot and account status
- Employees: per-employee channel, consent state, opt-out (read-only)
- Tools by role: matrix
- Provider: primary/fallback, model ids, never keys
- Limits and costs: rate limits, budget, usage chart from `/usage`
- Audit log
- Test call

Supporting files:
- `settings/MyAiPrefsPanel.tsx`: every user (opt-out, consent, channel order, my reminders).
- `settings/TelegramAccountPanel.tsx`: DeveloperPanel tab with the phone → code → 2FA steps. Inputs use `autocomplete="one-time-code"`, are cleared after submit, and are never put in localStorage.
- `settings/api.ts`.

### i18n
- Two new namespace files: `i18n/ns/aiVoice.ts` (settings) and `i18n/ns/aiVoiceCall.ts` (call UI).
- They are registered as top-level `aiVoice` and `aiVoiceCall` keys in `i18n/index.ts`, the same way `ai: nsAi.uz` is (:26-40).
- New keys only, so the rule that base `translations.ts` wins over extra is not triggered. uz-cyrl is transliterated automatically.

---

## 9. Edits to shared files

All of these are done by **package 1** as stubs or hooks. Later packages only fill in files they own. Exceptions are marked.

| File | Edit |
|---|---|
| `backend/src/index.ts` | (a) Mount 3 routers near :254 (platform, me, admin). (b) In `mongoose.connect().then` after `startAutoSnapshots()` (:375): `startAiVoice()`. (c) **P4:** webhook route :312 checks `X-Telegram-Bot-Api-Secret-Token` with `safeEqual`. |
| `backend/src/services/socket.ts` | In `initSocket` after `io` is created: `registerAiWorkerNamespace(io)`. In `io.on('connection')` (after :116): `registerAiVoiceSocket(socket)`. **P5:** the security fixes in §11. |
| `backend/src/services/bot.ts` | (a) At the end of module init: `registerBotInstance(bot)` (dependency injection, no import cycle). (b) Shift-gate regex :2301: add `ai:a:\|ai:o:`. (c) Right after the subscription gate (before `subcheck`, ~:2332): `if (await aiBotCallbackHook(query, user, lang)) return;`. (d) Message handler after the gates (~:1507): `if (await aiBotMessageHook(msg, user, lang)) return;`. (e) `resetChatState` :1395: `aiBotResetChat(chatId)`. (f) `sendMorningReminders` :2907: add `companyId` to the select and `if (await aiSuppressesLegacyMorning(w.companyId)) continue;`. **P4:** webhook `secret_token` at :104, `notifyAdmins` companyId at :2853, `isDev` check at :2623. |
| `backend/src/middleware/workGate.ts:26` | Add `/^\/api\/ai-voice\/me/` to `ALLOW`. |
| `backend/src/models/User.ts`, `AiConversation.ts` | Indexes and fields from §2. |
| `backend/package.json` | Add `@google/genai@^2.28`; dev deps `supertest`, `@types/supertest`, `socket.io-client`; `"engines":{"node":">=20"}`. |
| `backend/.env.example`, `render.yaml` | New names with `sync:false`. Also fix the drift: EMAIL_* (not SMTP_*), METERED_*, GEMINI_AUDIO_MODELS, GROQ_*. |
| `.github/workflows/backend-tests.yml` | Add `npx tsc --noEmit`. |
| `frontend/src/app/App.tsx` | `const AiVoiceRoot = lazy(()=>import("./aiVoice/AiVoiceRoot"))` near :118. Mount `<Suspense fallback={null}><AiVoiceRoot currentUser={liveUser} busy={!!activeCall}/></Suspense>` next to `<AIAssistant>` (:5841). |
| `frontend/src/app/AIAssistant.tsx` | One header button: `onClick={openAiVoiceCall}`. |
| `frontend/src/app/ProfilePage.tsx` | Two `menuRows` entries at :659 (`aiAssistant` for admins, `aiPrefs` for everyone) and two `activePanel===…` branches rendering the lazy panels. |
| `frontend/src/app/DeveloperPanel.tsx` | Add `"aiVoice"` to the tab union (:28), one tab button (~:350) and one branch rendering the lazy `TelegramAccountPanel`. |
| `frontend/src/app/i18n/index.ts` | Import the 2 namespaces and add them to `uzMerged`/`ruMerged`. |

### New env names
- **Backend:** `AI_VOICE_ENABLED`, `AI_SECRETS_KEY`, `AI_SECRETS_KEY_PREV`, `AIV_WORKER_HMAC_SECRET`, `AI_LIVE_MODEL`, `AI_TEXT_MODEL`, `AI_TTS_MODEL`, `AI_TRANSCRIBE_MODEL`, `AI_PRICING_JSON`. Optional: `YANDEX_SPEECHKIT_API_KEY`, `YANDEX_FOLDER_ID`.
- **Worker:** `BACKEND_URL`, `AIV_WORKER_HMAC_SECRET`, `WORKER_ID`, `TG_API_ID`, `TG_API_HASH`.
- The webhook secret is **derived** as `HMAC(TELEGRAM_BOT_TOKEN, "webhook")` mapped to `[A-Za-z0-9_-]`. No new env var is needed and it is always enforced.

---

## 10. Work packages

P1 goes first. P2–P8 then run in parallel and depend only on P1's contracts.

### P1: Foundation, contracts and shared hooks (sequential, blocks all others)

**Creates (backend):**
- Models: `models/AiAssistantSettings.ts`, `AiChannelConnection.ts`, `AiEmployeeContact.ts`, `AiCallSession.ts`, `AiCallEvent.ts`, `AiAttendanceConfirmation.ts`, `AiReminder.ts`, `AiActionAudit.ts`, `AiUsageMetrics.ts`, `AiJob.ts`, `AiNonce.ts`, `AiRateCounter.ts`
- `aiVoice/config.ts`
- `aiVoice/contracts.ts` (DTOs plus socket and worker protocol types)
- `aiVoice/lib/{crypto.ts (AES-256-GCM, key versioning), hmac.ts (sign/verify + AiNonce replay), zonedTime.ts, redact.ts, ids.ts, mongoRateLimit.ts}`
- `aiVoice/settings.ts` (defaults merge, 10 s cache, `isAiActive(companyId)`), `aiVoice/audit.ts`, `aiVoice/usage.ts`, `aiVoice/pricing.ts`
- `aiVoice/tools/{types.ts, registry.ts, executor.ts, rbac.ts, validate.ts}`
- `aiVoice/queue/{jobQueue.ts, handlers.ts}`
- `aiVoice/channels/{types.ts, registry.ts}`, `aiVoice/voice/types.ts`
- `aiVoice/bootstrap.ts` (startAiVoice, SIGTERM drain, loop start)
- **Stub files with final signatures** that later packages own: `aiVoice/bot/botHooks.ts`, `aiVoice/socket/inAppSocket.ts`, `aiVoice/telegram/workerNamespace.ts`, `aiVoice/routes/{adminRoutes,meRoutes,platformRoutes}.ts`

**Creates (frontend):**
- `aiVoice/bus.ts`, `aiVoice/protocol.ts`
- Stubs: `aiVoice/AiVoiceRoot.tsx`, `aiVoice/settings/{AiSettingsPanel,MyAiPrefsPanel,TelegramAccountPanel}.tsx`, `i18n/ns/aiVoice.ts`, `i18n/ns/aiVoiceCall.ts`

**Shared edits:** everything in §9 that is not marked P4 or P5. JWT hardening: `middleware/auth.ts:44` throws at startup when `JWT_SECRET` is missing and `RENDER`/`NODE_ENV=production`.

**Tests:**
- `aiVoice/__tests__/models.int.test.ts`: unique and partial indexes, including that a duplicate active call is rejected.
- `crypto.test.ts`: round trip, tamper detection, key rotation.
- `hmac.int.test.ts`: replay rejection, ±60 s skew.
- `jobQueue.int.test.ts`: two "instances" claim concurrently; exactly-once; lease expiry recovery; dead-letter; drain.
- `executor.int.test.ts`: role denial, cross-tenant denial when model args name another company's id, PII redaction, `needs_confirmation`, idempotency, audit rows.
- `zonedTime.test.ts`.
- `settings.test.ts`.

### P2: ERP tools and text agent
- **Creates:** `aiVoice/tools/erp/{getMyTasks,getMySchedule,getProjectSummary,getInventoryBalance,getAttendanceSummary,reminders,getAllowedFinancialReport,notifyManager,getEmployeeProfile,attendanceCall}.ts`, `aiVoice/tools/erp/index.ts` (registers them), `aiVoice/brain/{systemPrompt.ts, textAgent.ts (Gemini flash function-calling loop, max 5 tool rounds, 20 s timeout via AbortSignal), geminiClient.ts (genai client + key rotation)}`.
- **Hardening of the existing `routes/ai.ts`** (does not break the AIAssistant UI):
  - `/execute` gets `aiLimit`
  - `delete_user`/`update_user` refuse when the target is `isOwner`, a direktor (for orinbosar callers), or the caller themself
  - phone uniqueness pre-check
  - role allow-list
  - `logAudit` on every action
  - AIAssistant.tsx:368 shows the existing confirm card for `direct_action` too (one condition change)
- **Tests:** one `*.int.test.ts` per tool (seeded 2 companies: isolation, role matrix, phone/salary redaction, Material-not-warehouse note); `textAgent.test.ts` with a mocked genai client (tool loop, "no success claim on error"); `ai.execute.int.test.ts` (supertest: the owner-protection regressions).

### P3: Scheduler, attendance flow, reminders, self routes
- **Creates:** `aiVoice/scheduler/{planner.ts, attendanceFlow.ts (pure state machine), attendanceRunner.ts, reconciler.ts, finalize.ts, reminders.ts, recurrence.ts, retention.ts}`, `aiVoice/channels/{pushChannel.ts, managerChannel.ts}`, `aiVoice/routes/meRoutes.ts` (fills the stub).
- **Tests:**
  - `attendanceFlow.test.ts`: every transition. Voice yes leaves status pending until the button; a button never sets `checked_in`; a check-in overrides; opt-out; retries capped.
  - `recurrence.test.ts`: timezone, month-end, until/count.
  - `planner.int.test.ts`: fake clock; idempotent re-plan after restart; weekdays.
  - `attendance.e2e.int.test.ts`: a full simulated morning with fake channels (telegram no_answer → bot buttons → confirm → Attendance inserted → checked_in; another user → absent at cutoff; manager notified only within the same company).
  - `meRoutes.int.test.ts` (supertest, workGate allow-list).

### P4: Telegram bot channel and bot security fixes
- **Creates:** `aiVoice/channels/botChannel.ts`, `aiVoice/bot/botHooks.ts` (fills the stub), `aiVoice/bot/i18n.ts` (uz/ru dict).
  - `sendToUser(userId, text, {buttons, parseMode})` returns `messageId`. It handles 403 (marks the contact blocked) and 429 `retry_after` (requeue).
  - `ai:a:<token>:c|l|d` attendance buttons, `ai:r:<id>:d|s` reminder done/snooze, `ai:x:<token>:y|n` pending-action confirmation, `ai:o:<token>:y|n` consent/opt-out.
  - The token is verified against the record **and** `query.from.id`/chatId → employee → companyId. Repeat presses are idempotent. Blocked users are rejected (`User.isBlocked`).
  - `/ai` mode: text and voice notes go to `textAgent` with a Mongo rate limit, cleared in `resetChatState`.
  - Uses an `export` of the uz-cyrl transliterator from `i18n/bot.ts`.
- **Fixes:**
  - webhook `secret_token` (bot.ts:104) plus the header check (index.ts:312)
  - `notifyAdmins(message, kb, companyId)` filters by company, with the call site at transactions.ts:245
  - `sub_approve_`/`sub_reject_` require `isDev(user.role)` (:2623)
- **Tests:** `botChannel.test.ts` (fake bot instance: 403/429, ≤64-byte callback_data); `botHooks.int.test.ts` (forged token, wrong chat, other company, duplicate press, blocked user, off-shift worker can press attendance buttons but not `ai:x`); `webhookSecret.test.ts` (supertest: missing or wrong header gives 401); `notifyAdmins.int.test.ts` (no cross-tenant delivery).

### P5: Voice engine, in-app call backend and socket fixes
- **Creates:** `aiVoice/voice/{provider.ts, geminiLive.ts, cascade.ts, vad.ts, fakeProvider.ts, prompts.ts, sessionManager.ts, geminiKeys.ts}`, `aiVoice/channels/inAppCallChannel.ts` (ring via `emitToUser`, 30 s ring timeout, `isOnline`), `aiVoice/socket/inAppSocket.ts` (fills the stub; enforces at most 1 MB per audio frame), `backend/scripts/aiv-eval-uz.ts` (manual Uzbek evaluation, needs a key).
- **socket.ts fixes:**
  - `relay()` overwrites `from`/`fromName` with `socket.data`
  - the target must be in the same company
  - the handshake rejects `isBlocked` users and revoked sessions (`checkSessionNotRevoked`)
  - presence goes to `company:<id>` rooms, not `io.emit`
  - the `call:offer` push is sent only for the first offer (no `restart`/`renegotiate` flag)
- **Tests:** `sessionManager.int.test.ts` (fake provider: tool bridging through the executor, duration hard stop, GoAway resume, usage rows, busy via the partial index, SIGTERM leaves sessions `interrupted`); `cascade.test.ts` (VAD segmentation on synthetic PCM, TTS failure path); `inAppSocket.int.test.ts` (real server + `socket.io-client`: auth, off-shift refusal, incoming/accept/decline/busy, frame size cap); `socketSecurity.int.test.ts` (spoofed `from`, cross-tenant target, blocked user); `geminiLive.live.test.ts`, which is **skipped unless `RUN_LIVE_TESTS=1`**.

### P6: Telegram call microservice and backend bridge
- **Creates (Python):** `tgcall-worker/{Dockerfile (python:3.12-slim-bookworm), requirements.txt (py-tgcalls==3.0.0, ntgcalls==3.0.3, telethon==1.45.0, python-socketio[asyncio_client], numpy, soxr), app/main.py, app/bridge.py (HMAC handshake, RPC, reconnect with backoff), app/auth_flow.py, app/calls.py (place/hangup, raw UpdatePhoneCall ringing, error mapping), app/audio.py (48k↔16k/24k resample, 10 ms paced sender with silence fill), app/udp_probe.py (STUN binding), app/health.py, tests/test_audio.py, tests/test_error_map.py, tests/test_bridge_protocol.py (against fixtures from contracts.ts), tests/test_live_call.py (@pytest.mark.live)}`, `tgcall-worker/railway.json`, `.github/workflows/tgcall-worker-tests.yml`.
- **Creates (backend):** `aiVoice/telegram/{workerNamespace.ts (fills stub; single-worker lease), workerRpc.ts, accountService.ts (encrypt/store session, status, flood-wait, daily cap)}`, `aiVoice/channels/telegramCallChannel.ts`, `aiVoice/routes/platformRoutes.ts` (fills stub).
- **Tests:**
  - `workerNamespace.int.test.ts` (bad signature or replayed nonce rejected; second worker rejected; RPC timeout)
  - `telegramCallChannel.test.ts` (outcome mapping, consent/privacy gating)
  - `platformRoutes.int.test.ts` (dasturchi only; codes never persisted or audited in clear; session stored encrypted)
  - pytest unit tests in CI
  - **The live call test is only reported as passed when actually run** with `LIVE_TG=1` and a connected account. It writes `live-call-report.json` with the `AiCallSession` id. Otherwise the result is "NOT RUN".

### P7: Frontend in-app call client
- **Creates:** `aiVoice/audio/{capture.worklet.js, player.worklet.js, pcmCapture.ts, pcmPlayer.ts, resample.ts}`, `aiVoice/{useAiVoiceSession.ts, AiVoiceCallOverlay.tsx, AiIncomingCall.tsx, nativeAttention.ts, ttsFallback.ts}`. Fills `AiVoiceRoot.tsx` and `i18n/ns/aiVoiceCall.ts`.
- **Tests:** vitest `resample.test.ts`, `pcmPlayer.test.ts` (ring buffer, flush, underrun), `useAiVoiceSession.test.tsx` (mock socket: state machine, busy auto-decline, no `getUserMedia` before Accept). Playwright `e2e/ai-voice.spec.ts`: Chromium `--use-fake-device-for-media-stream`, mocked socket via an injected stub, opened from the AIAssistant button, transcript and confirm card render, phone and desktop projects.

### P8: Admin settings backend and UI
- **Creates:** `aiVoice/routes/adminRoutes.ts` (fills stub), and fills `settings/{AiSettingsPanel, MyAiPrefsPanel, TelegramAccountPanel}.tsx`, plus `settings/sections/{General,Schedule,Channels,Employees,ToolsMatrix,Provider,LimitsCost,AuditLog,TestCall}.tsx`, `settings/api.ts` and `i18n/ns/aiVoice.ts`.
- **Tests:** `adminRoutes.int.test.ts` (supertest: RBAC (orinbosar ok, prorab 403, dasturchi blocked); feature fails closed; version conflict 409; secrets never present in responses); vitest `AiSettingsPanel.test.tsx` (form validation: HH:mm, fallback-order uniqueness); Playwright `e2e/ai-settings.spec.ts` (mocked API: save settings, Telegram login steps clear the inputs, nothing written to localStorage).

### Dependencies
- P1 → all others.
- Soft contracts:
  - P3 uses channel adapters only through `channels/registry` (fakes in tests).
  - P6's audio path uses `VoiceSessionManager` through `voice/types.ts` from P1.
  - P7 and P8 code against `protocol.ts` and `contracts.ts` from P1.

---

## 11. Existing bugs and risks to fix as part of this work

1. **High, P4.** Telegram webhook has no `secret_token` or header check (index.ts:311-320, bot.ts:104). Forged `contact` updates lead to account takeover, and forged callbacks would forge AI attendance/confirm buttons. This must be fixed before any `ai:` callbacks ship.
2. **High, P4.** `notifyAdmins` (bot.ts:2853, called from transactions.ts:245) sends finance data to the directors of every company.
3. **High, P4.** `sub_approve_`/`sub_reject_` (bot.ts:2623) has no `isDev` check, so anyone can activate subscriptions.
4. **High, P5.** The socket signalling relay (socket.ts:138-169) forwards client `from`/`to` unchanged: spoofed caller identity and cross-tenant rings and pushes. The AI call UI lives next to it, so it must be fixed in the same pass, without changing the event shapes CallOverlay uses.
5. **High, P2.** AI `direct_action` runs delete/update user with no confirmation (AIAssistant.tsx:368; ai.ts:364-405). There is no owner/direktor/self protection, and the orinbosar can change the owner's phone (also PUT/DELETE `/api/auth/users/:id`, auth.ts:662-733; recommend the same guard there).
6. **High, P1.** `JWT_SECRET` falls back to `'secret'` (auth.ts:44). Fail at startup in production.
7. **Medium, P5.** The socket handshake ignores `isBlocked` and revoked sessions (socket.ts:83-98). `broadcastPresence` leaks across tenants (socket.ts:25).
8. **Medium, P1/P2.** `requireFeature` fails open (requireFeature.ts:37). The new AI code uses fail-closed `companyHasFeature`. Recommend also making `/api/ai` fail closed for companyless users.
9. **Medium, P1/P3.** In-memory rate limits, dedupe and reminders (rateLimit.ts, bot.ts:2888 `lastReminderKeyIn/Out`). The AI uses Mongo counters and leases. Recommend porting the legacy morning/evening reminder dedupe to an `AiJob`-style dedupe key later; the AI suppression flag already avoids double messages.
10. **Medium, P4.** The bot never checks `User.isBlocked` or company status. Enforced in all `ai:` paths. Recommend a global check at the top of both bot handlers.
11. **Medium, P2/P5.** `geminiAudioToJson` has no timeout (gemini.ts:36-67). New code always uses `AbortSignal.timeout`. Recommend adding one to `gemini.ts` as well.
12. **Medium (unrelated, recommend a separate PR).** POST `/api/messages` has no group-membership or same-company check (messages.ts:294-353); `groups.ts` adds members from other companies (:95-146). Not required for the voice feature, but it is the same class of tenant leak.
13. **Low, P1.** `telegramChatId` has no index (User.ts:54); every bot update does a collection scan.
14. **Low, P1.** CI never runs `tsc` (backend-tests.yml); `.env.example` has drifted (SMTP_* vs EMAIL_*, VAPID_SUBJECT, missing METERED_*/GEMINI_AUDIO_MODELS/GROQ_*).
15. **Low, P7.** CallOverlay acquires the camera/mic before Accept (CallOverlay.tsx:269-299). The AI call UI does not repeat this; recommend fixing CallOverlay separately to avoid touching WebRTC in this work.
16. **Low (document as a known limitation).** Socket `maxHttpBufferSize` 1e8 (socket.ts:68). AI frames are capped at 1 MB per event in the handler; lowering the global value is deferred until media-over-socket use is confirmed. The shift gate locks workers out after midnight (bot.ts:1495). Attendance 'late' is hard-coded at 09:00 (attendance.ts:138): the AI board shows the AI late status and the Attendance status side by side, and the threshold is not changed in this scope.

---

## 12. What can be built and tested now vs. what needs credentials or devices

### Built and tested in CI now (no credentials)
- All models, indexes, queue, leases, scheduler, attendance state machine, reminders, recurrence and timezones
- Tools with RBAC and isolation, audit, usage and settings
- All REST routes (supertest + mongodb-memory-server, already a dev dependency)
- The socket protocol (`socket.io-client`)
- Voice sessions with `FakeVoiceProvider`
- Cascade VAD with synthetic PCM
- Bot channel with an injected fake bot (botChannel must not import bot.ts at module scope, because bot.ts throws without a token)
- The worker HMAC bridge, both the Node side and pytest protocol fixtures
- Python audio and error-mapping unit tests
- Frontend worklet math, hooks, and Playwright with a fake media device and a mocked socket and API

### Needs credentials, an account or devices (marked NOT RUN until actually run)

| Item | What it needs |
|---|---|
| Real Gemini Live Uzbek/Russian quality and latency | Existing `GEMINI_API_KEYS`, probably a paid tier for concurrent sessions. Run `scripts/aiv-eval-uz.ts` and a 1-day evaluation with 10–20 real worker phrases. This is the go/no-go gate for the Live primary; a fail means the cascade or Yandex. |
| Real Telegram call | `TG_API_ID`/`TG_API_HASH` on the worker host; a dedicated aged account on a real SIM, logged in **through the DeveloperPanel UI only**; a worker host with outbound UDP (Railway or a VPS; the UDP probe must pass); 20+ test calls to real phones on mobile data; employees who granted consent and whose privacy settings allow calls. |
| Production webhook secret | A deploy, then confirm that Telegram sends the header (watch for 401s in the logs for 5 minutes). |
| Android APK | Real phones: WebView `AudioWorklet`, mic prompt (MainActivity.java:62-115), speakerphone echo or self-interruption, background behaviour (there is no FCM, so the fallback is the 60 s notification poll). |
| Windows EXE | The WebView2 mic prompt on `tauri.localhost`, and the tray-hidden window coming to the front on an AI ring. |
| Push to APK/EXE | Not available: there is no FCM and the service worker is unregistered in native apps. The flow relies on `createNotification`, the Android poll, and Telegram. |

**Rollout order:**
1. Set `AI_VOICE_ENABLED` per environment and turn on `settings.enabled` for one pilot company.
2. Run bot-message-only attendance first, with `fallbackOrder` set to `['bot_message','inapp_call','push','notify_manager']`.
3. Add `telegram_call` only after the live call report and the Uzbek evaluation pass.