# Principal-engineer review: AI Voice Assistant design for QurilishERP

I checked these against the current tree (read-only): `backend/src/services/socket.ts:13-27,66-169`, `backend/src/middleware/workGate.ts:26-35`, `backend/src/index.ts:165,184,254,311-320,341,362-377`, `backend/src/services/bot.ts:95-112,1440-1510,2279-2335,2880-3232`, `backend/src/services/expenseInsights.ts:125-145`, `backend/tsconfig.json`, `render.yaml`, `.github/workflows/*.yml`, `backend/src/models/AiConversation.ts`, `backend/src/models/User.ts:25,72` and `backend/src/routes/groups.ts:52-58`.

---

## A. Wrong or weak technical assumptions

### A1. Telegram call capacity makes `telegram_call` unusable as the morning attendance primary
- The design assumes "at most 2 concurrent calls per account". That is unverified. Official clients allow one active private call per account, and nothing in the research shows two P2P calls from one MTProto session working at once.
- **Plan for 1 concurrent call.** One call takes about 45 s ring + up to 120 s talk + `minGapSec` 20 s, so roughly 20–25 calls per hour.
- A 100-worker company would take 4–5 hours. The 150-call daily cap is **platform-wide**, shared by every company.
- A user account calling dozens of people every morning, from a datacenter IP, under an "unofficial client" login, is exactly the pattern Telegram flags as spam.
- **Fix:**
  - `bot_message` is always step 1.
  - `telegram_call` is used only to escalate for people who have not answered after `buttonWaitMin`.
  - Add a platform-wide cap `AI_TG_MAX_CONCURRENT=1` and per-company daily quotas carved out of the account cap.
  - Default `fallbackOrder` becomes `['bot_message','telegram_call','inapp_call','push','notify_manager']`.

### A2. `contact.resolve` through `contacts.importContacts` by phone is the wrong primary identity path
- Bulk phone import from a fresh account is a known ban trigger and has strict undocumented flood limits.
- A recycled phone number can also resolve to the wrong person.
- The bot already knows the authoritative Telegram user id: `query.from.id` on the consent press, and `User.telegramUserId` (`User.ts:72`). A private `chat.id` equals the user id.
- What the account actually lacks is the **access_hash**.
- **Fix:** take `tgUserId` from the consent callback's `from.id`. Get the access_hash in this order:
  1. `@username` resolve.
  2. The consent message includes a `t.me/<account>` link and asks the employee to send the account a one-time code shown in the bot (for example `AI-4821`). This is the strongest opt-in signal, which the research also recommends. The worker matches the code and binds the id.
  3. `importContacts` only as a last resort, rate-limited to a few per hour, and only accepted if the returned user_id equals the bot-known id.

### A3. Incoming calls and DMs to the AI account are not handled
- Anyone can call or DM the platform account.
- **Fix:** the worker auto-discards every incoming `PhoneCallRequested` (`phone.discardCall`, busy) and never forwards DMs to the AI. The only exception is the binding-code matcher in A2, which ignores everything else.

### A4. Worker lease does not prevent `AUTH_KEY_DUPLICATED`
- The backend lease only gates `session.fetch`.
- Railway rolling deploys overlap the old and new containers. The old container already holds the session in memory and stays connected to Telegram, so two processes run one session. Telegram then permanently invalidates it.
- **Fix:**
  - Use a **fencing lease**: `{leaseId, leaseUntil}` with a 30 s TTL, renewed every 10 s over the worker socket.
  - The worker only starts Telethon after it holds the lease.
  - If a renewal fails, or the socket is down for more than 20 s, the worker immediately calls `client.disconnect()` and drops the session from memory.
  - A new worker must wait `leaseUntil + 10 s`.
  - On Railway set `numReplicas: 1` and a deployment overlap of 0 (`RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0`), or use "stop old before start new".

### A5. Shared-secret HMAC plus `session.fetch` hands over the whole Telegram account if one secret leaks
- Anyone holding `AIV_WORKER_HMAC_SECRET` can connect as a worker, which the lease allows whenever the real worker is down, and download the decrypted StringSession.
- The worker-generated `ts` plus nonce scheme also needs `AiNonce` writes on every reconnect.
- **Fix, two options:**
  - **Preferred:** never store the session in the backend. The worker persists it on its own volume, encrypted with a worker-only key `TG_SESSION_KEY`. The backend keeps only status and metadata. Login still flows through the DeveloperPanel → backend → worker RPC, and the result never returns to the backend.
  - If backend storage stays: replace HMAC with an Ed25519 challenge-response.
    - The backend holds only `AIV_WORKER_PUBKEY` and issues a server nonce.
    - `session.fetch` is allowed only while no lease is held.
    - Every fetch fires `notifyDeveloper`.
- RPC messages inside an authenticated WSS connection need unique `requestId`s, not nonces.

### A6. Gemini Live concurrency and "key rotation"
- Live concurrent-session and RPM quotas are per **project/tier**. Several keys from the same project add no capacity.
- `companyConcurrency: 3` is per company. Nothing caps usage **platform-wide**.
- **Fix:**
  - Add a platform semaphore `AI_LIVE_MAX_CONCURRENT`, derived from active `AiCallSession`s (see C4).
  - Document that keys must come from separate projects to add capacity.
  - When the cap is hit, the scheduler waits; it does not fall back to the cascade, which uses the same quota.

### A7. Tool-call blocking semantics
- With asynchronous function calling the model can keep talking, and claim success, before the tool result arrives.
- **Fix:** declare every write tool and every attendance tool with `behavior: BLOCKING`. Never let a turn complete with a success phrase before `toolResponse`. A test enforces this through `FakeVoiceProvider`.

### A8. The disclosure must not depend on the model
- A native-audio model may skip, paraphrase, or switch language on the disclosure. Live also does not speak until it gets input.
- **Fix:**
  - Pre-render the disclosure clip per company and language with `gemini-3.8-flash-tts`, cache it as PCM in Mongo or on the worker, and play it deterministically on `connected`.
  - Open the Live session during ringing to hide the ~1.2 s setup, without streaming audio yet.
  - Then send a `sendClientContent` "start" turn.
- The company name is tenant-controlled text. Sanitise it (≤60 chars, strip newlines and brackets) before putting it into prompts.

### A9. Render is underpowered and every deploy drops calls
- The current free plan has 0.1 CPU and 512 MB, and it already runs Express, the bot, Socket.IO and every loop.
- Each live session base64-encodes PCM at 25 frames/s, JSON-frames it to Gemini and decodes 24 kHz audio back. That is not credible on 0.1 CPU next to the bot.
- Every push to main redeploys and SIGTERMs live calls. Zero-downtime deploys also **briefly run two instances**, so the "single instance" assumption breaks on every deploy (see C3).
- **Fix:**
  - Starter plan or higher is a hard prerequisite for any voice rollout.
  - Set `maxShutdownDelaySeconds` in `render.yaml` (verify the field and limit for the chosen plan) and drain active sessions up to it.
  - Add a documented deploy freeze around `callTime ±2h`.
  - Measure CPU with a load test (P9).

### A10. Socket.IO audio transport details are missing
- Socket.IO has no backpressure. A slow consumer makes buffers grow without limit.
- **Fix:**
  - The server keeps a per-session out-queue cap of about 500 ms and drops the oldest frames.
  - The worker uses `transports=['websocket']` only. Long-polling turns binary into base64 and adds latency.
  - The in-app client already upgrades from polling (`frontend/src/app/socket.ts`). Refuse `aiv:start` when `socket.conn.transport.name !== 'websocket'` and show "network does not support voice".
- Specify the frame header: 16-byte UUID (`correlationId`, **not** an ObjectId, which is 12 bytes), u32 **little-endian** seq, PCM16LE.
- The 1 MB per-frame cap is about 800× a 40 ms frame (1280 B). Set the cap to **8 KB per frame** and **60 frames per second**, require an even byte length, and only accept frames from the socket id bound to that session.

### A11. Presence via `isOnline` is a liar for backgrounded Android
- The WebView socket of a backgrounded APK can still look online. The AI then rings into the void for 30 s.
- **Fix:** the client emits `aiv:presence {visible}` on `visibilitychange`. `inapp_call.isAvailable` requires `visible && lastSeen < 60 s`.

### A12. Echo on speakerphone
- Chrome and Android WebView AEC does not reliably cancel Web Audio output on many Android devices. The model then hears itself and interrupts itself.
- **Fix:**
  - Push-to-talk is the default on Android.
  - Otherwise use half-duplex gating: while the player is outputting, mute uplink unless RMS exceeds a barge-in threshold.
  - Test on the target phones (P9).

### A13. Node version
- Node 20 reached EOL in April 2026 and CI uses 20.
- `"engines": {"node": ">=20"}` lets Render pick any future major.
- **Fix:** pin `"engines": {"node": "24.x"}` (local is v24), set `NODE_VERSION` in `render.yaml`, and bump all workflows to 24.

### A14. `tsc --noEmit` in CI does not cover tests
- `backend/tsconfig.json` excludes `src/**/*.test.ts` and `__tests__`, and vitest does not type-check.
- **Fix:** add `tsconfig.test.json` (includes tests, `noEmit`) and run both. Run it once locally before adding it to CI so existing errors do not turn CI red unannounced.

### A15. Smaller corrections
- `expenseInsights.ts:126-145` is not purely an atomic claim. It also has an in-memory `lastRunKey` guard. Only the `Company.updateOne({$ne})` at :138 is the pattern to copy.
- `createNotification` already calls `sendPushToUser`. The push channel calling both sends two pushes. Use `createNotification` only.
- `Notification.type` has no AI type. Either use `'shift'` (attendance) and `'system'` (reminders), or extend the enum in P1 with a frontend default icon.

---

## B. Security holes

### B1. Tool matrix privilege escalation
- `settings.tools.byRole` is admin-editable, so an orinbosar can grant `ishchi` the finance tools.
- **Fix:** effective tools = `settings.byRole[role] ∩ CODE_CEILING[tool].roles`, where the ceiling is hard-coded in each `AiToolDef.maxRoles`. The PUT validator rejects anything outside the ceiling.
- Only direktor or the owner may edit the direktor and orinbosar rows.

### B2. Stale tool context
- `ToolCtx` is built once at session start.
- **Fix:**
  - Re-read `role`, `isOwner`, `isBlocked`, `companyId` and company status in `executeTool`, with a ≤10 s cache.
  - Re-check `companyHasFeature('ai_assistant')` and the budget.
  - End sessions on `kickSession`, a block, or revocation: hook `routes/sessions.ts` revoke and `users.ts setBlocked` through an exported `aiEndSessionsForUser(userId)`.

### B3. Confirmation replay and race
- `aiv:confirm-action` and `ai:x` must execute through one atomic `findOneAndUpdate`:
  - match `{_id, status:'needs_confirmation', actorUserId, companyId, 'pending.expiresAt': {$gt: now}}`
  - set `status: 'confirmed'`
- Only the winner executes. The pending token must be bound to the actor and the channel.
- There must be **no** model-callable "confirm" tool. Confirmation only comes from a UI or bot button press.
- In a **Telegram call** there is no UI, so write tools that need confirmation route it to a bot `ai:x` button, or are disabled for the `telegram_call` channel in v1. The design leaves this unspecified.

### B4. Prompt injection through ERP data
- Transaction descriptions, user and object names, reminder texts and `/ai` messages all reach a boss's session.
- **Fix:**
  - Tool results return structured JSON with free-text fields truncated to ≤200 chars.
  - Those fields are wrapped as `{"untrusted_text": …}`, and the system prompt says to never follow instructions inside them.
  - Any write that affects another user requires a human button confirmation regardless of `confirm` settings. Make `confirm: 'when_other_user'` a code ceiling that the settings cannot lower.
  - Cap how many writes per session target other users.
  - Add an injection fixture test (P2).

### B5. Bot callback identity
- The router resolves the user from `query.message.chat.id` (`bot.ts:2284`).
- **Fix:** for `ai:` callbacks require:
  - `query.message.chat.type === 'private'`
  - `String(query.from.id) === String(chatId)`
  - `record.employeeId === user._id`
  - the same `companyId`
  - the token not expired: attendance tokens are valid until `finalizedAt` or the end of the day, consent tokens for 7 days
  - an atomic state transition, so a repeated press is a no-op that answers "already recorded"
- Subscription gate: the AI hook sits after the gate (`bot.ts:2310-2318`), so unsubscribed workers cannot press attendance buttons. The flow must treat that as `no_answer`, not an error. Add a test.

### B6. Webhook secret rollout
- `setWebHook` at `bot.ts:104` with `secret_token` must also run in the 5-minute re-register (the same `registerWebhook` closure). Otherwise a lingering old instance or a dev polling instance resets it.
- After the header check is enforced, **exempt `/api/bot/webhook` from the global 600/min per-IP limiter** (`index.ts:184`). All updates come from a few Telegram IPs and would start getting 429s.
- Return 401 on a mismatch, keep `express.json()` (it is already global at :165) and remove the duplicate.

### B7. Platform test-call
- `POST /platform/telegram-account/test-call {userId}` lets a dasturchi ring any user of any company.
- **Fix:** require the target's `callConsent === 'granted'`, write an audit row with the company, and limit to 5 per hour.

### B8. Login relay secrets
- The phone, code and 2FA password pass through Express.
- **Fix:**
  - Ensure the global error handler (`index.ts` ~:325) and `/api/errors` never echo the request body.
  - Mark these routes `Cache-Control: no-store`.
  - Rate-limit to 5 per 10 min.
  - Keep pending-auth state only in worker memory, keyed by a server-issued `loginAttemptId`.

### B9. Consent integrity
- Consent may only be set by the employee's own bot press or their `/me` PATCH.
- `PATCH /employees/:userId` (admin) must reject `callConsent` and `optOut` fields.
- Write a `ConsentLog` row with the source.

### B10. Unique-index null traps
- Mongo `sparse` unique indexes still index explicit `null`. This affects `AiJob.dedupeKey`, `AiAttendanceConfirmation.buttonToken`, `AiActionAudit.'pending.token'` and `AiEmployeeContact.'telegram.tgUserId'`.
- **Fix:** use `partialFilterExpression: {field: {$type: 'string'}}` on all of them.
- Make `telegram.tgUserId` **unique** (partial) so one Telegram identity cannot map to two employees.

### B11. Socket relay fix would break existing features as specified
- Dev-support groups (`groups.ts:52-58`) connect a dasturchi (`companyId` null) with company users. The "target must be the same company" rule breaks dev-support calls and video chats.
- Moving presence to `company:<id>` rooms drops presence for dasturchi.
- **Fix:**
  - Allow relays when both users share a group with `devSupport: true`, or when either side is `dasturchi`.
  - Group relays (`data.groupId`) check that the sender is in `memberIds`.
  - Presence for dasturchi: emit to the dev's own room with the presence of their devSupport groups' members, or keep the global emit only for dasturchi sockets.
- The "push only on the first offer" rule cannot be detected server-side, because CallOverlay re-sends `call:offer` on ICE restart (`CallOverlay.tsx:197,258,317`) with no flag. Dedupe server-side instead: skip the push if the same (from, to) pair was pushed within 60 s.

### B12. `AiChannelConnection` cache and counters
- `activeCalls` and `AiRateCounter` semaphores leak permanently when a process crashes mid-call.
- **Fix:** derive concurrency from counting `AiCallSession {isActive: true}` per company, per account and platform-wide, together with the stale sweeper in C4. Drop the counters.

---

## C. Scheduler correctness

### C1. Long leases
- `attendance.step` holding a 60 s lease across a 45 s ring and a 120 s call, with heartbeats, means a crash re-dials the same person.
- **Fix:** make steps **event-driven**:
  - The step job creates an `AiCallSession` (the attempt key `confirmationId:stepIndex:attemptNo` is stored as a unique `attemptKey`), sends `call.place`, and finishes.
  - The `call.state` terminal event, or a `call.timeout` job at `ringTimeout + maxDuration + 30 s`, enqueues the next step with dedupe `att:step:<confId>:<stepIndex+1>`.
- No job ever spans a call.

### C2. Catch-up after downtime
- "local time ≥ callTime" with no upper bound means a server back at 11:00 calls everyone at 11:00.
- **Fix:**
  - Add `shift.maxLateMin` (default 60). Planning after `callTime + maxLateMin` creates confirmations with `bot_message` only and no calls.
  - Planning never happens after `absentCutoff`.
  - Reminders: a one-shot reminder older than 6 h becomes `missed`. Recurring reminders skip forward to the next future occurrence, never bursting.

### C3. Multi-instance claims
- During Render deploy overlap, a job claimed on instance A may need the worker socket, or the user's socket, that lives on instance B.
- **Fix:**
  - Jobs that need the worker carry `requires: 'worker'`. They are claimable only by the instance where `workerNamespace.connected === true` (that instance's `INSTANCE_ID` sits in `AiChannelConnection.workerInstanceId`).
  - In-app ring delivery uses `emitToUser`, which is local. Treat "user not on this instance" as `unavailable` with a requeue of +15 s (max 2), not a fallback.
  - Document in `config.ts` that realtime is single-instance, and log a warning when two instances heartbeat at once.

### C4. Stale active sessions lock people out forever
- After a crash, `AiCallSession.isActive: true` stays set. The partial unique index then makes the employee "busy" forever, requeued +60 s indefinitely.
- **Fix:** add a `session.sweep` job every minute. Sessions with `isActive && updatedAt < now - (maxDuration + ringTimeout + 60 s)` become `interrupted` with `isActive: false`. The session manager touches `updatedAt` every 15 s. Cap busy-requeues at 5.

### C5. Dedupe keys block manual re-runs
- `POST /attendance/run-now` reusing `att:plan:<company>:<date>:<shift>` is a permanent no-op once the automatic plan ran. `dead` and `failed` jobs never TTL either, so the key blocks forever.
- **Fix:**
  - Set `expiresAt` on every terminal status.
  - `run-now` uses key `att:plan:…:manual:<minute>`. Planning is idempotent through the confirmation unique index, so re-running is safe.
- Handle E11000 from concurrent upserts with a single retry.

### C6. Pre-attempt truth check
- The 2-minute reconciler is too coarse. A worker who checked in at 07:59 gets called at 08:00.
- **Fix:**
  - Every `attendance.step` runs `Attendance.findOne({userId, date})` immediately before `attempt`, and also checks opt-out.
  - `checked_in` always wins, including over `absent`, until the end of the day.

### C7. Timezone and date consistency
- `Attendance.date` and `isOnShift` use `utils/tz.ts` (fixed UTC+5). Asia/Tashkent has had no DST since 1991, so fixed +5 is correct. A configurable `settings.timezone` can drift from `Attendance.date`.
- **Fix:** v1 locks `timezone` to `'Asia/Tashkent'` (read-only in the UI, validated server-side). `zonedTime.ts` must agree with `todayInTashkent()`; a test asserts they agree around the 18:59/19:00 UTC boundary.
- Workdays use **ISO weekday** (1 = Monday … 7 = Sunday), derived with `Intl` `weekday`, never `Date.getDay()` on a shifted date.
- Quiet hours that wrap midnight (21:00 → 07:00) need explicit tests.
- Add `skipDates[]` per company for public holidays (Navruz, Mustaqillik and so on).

### C8. Legacy morning reminder suppression is unsafe
- If the AI runner is broken, nobody gets a reminder.
- **Fix:** suppress the legacy reminder (`bot.ts` `sendMorningReminders`) only for users who **have an `AiAttendanceConfirmation` for today**, using one batched `$in` query rather than a per-worker settings lookup.
- The legacy dedupe `lastReminderKeyIn` is in-memory and duplicates during deploy overlap. Port it to an `AiJob` dedupe key in P3; this was previously "later".

### C9. Reminder fire atomicity
- **Fix:** insert the `reminder.fire` job with dedupe `rem:<id>:<nextFireAt ISO>` **first**, then advance `nextFireAt` with a CAS on the old value. A crash in between at worst produces a duplicate insert, which is ignored.
- Calls have quiet hours; personal reminders do not.

---

## D. Work-package overlap and hidden dependencies

1. **P5 depends on P2.** `cascade.ts` uses `TextAgent`. Fix: P1 defines the `TextAgent` interface plus a stub, P2 implements it, and P5 takes it by injection.
2. **Duplicate Gemini key rotation** in P2 (`brain/geminiClient.ts`) and P5 (`voice/geminiKeys.ts`). Fix: one `aiVoice/lib/geminiKeys.ts` in P1.
3. **Manager resolution duplicated** in P2 (`notifyManager`) and P3 (`managerChannel`). Fix: `aiVoice/lib/managers.ts` `resolveManagers()` in P1.
4. **Channel registry wiring.** `bootstrap.ts` and `channels/registry.ts` import adapters that do not exist until P3–P6. Fix: P1 creates stub adapters (returning `unavailable`) for all 5 channels, each owned by exactly one package.
5. **`queue/handlers.ts`** needs handlers from P3 (scheduler) and P6 (`connection.health`). Fix: P1 creates `scheduler/index.ts` and `telegram/health.ts` stubs that export `registerHandlers(q)`, and `handlers.ts` only calls them.
6. **Security edits to `bot.ts`, `index.ts`, `socket.ts`, `routes/ai.ts` and `auth.ts`** are spread across P1, P2, P4 and P5, on top of P1's hook insertions, using line numbers that shift. Fix: move all live-vulnerability fixes into a separate **P0 hotfix**, shipped first and on its own. These are production holes today regardless of the AI work. Each later package then touches only files it owns.
7. **Models and contracts must be frozen in P1.** Any later change goes through a P1 follow-up PR. All npm dependencies are added in P1, so there are no lockfile conflicts.
8. **`App.tsx` `onCallOffer` (4901-4907)** ignores offers only while `activeCall` is set. A WebRTC call arriving during an AI call would open CallOverlay and grab the mic. Fix: P1 adds an `isAiCallActive()` check from `aiVoice/bus.ts` with an auto `call:reject {reason: 'busy'}`.
9. **`routes/auth.ts` PUT/DELETE user guards** were only "recommended". They are the same account-takeover class as `ai.ts` `update_user`. Fix: they belong in P0.
10. **Bot message hook precedence.** Placing `aiBotMessageHook` at ~`bot.ts:1507` runs before `chatSessions`, `pendingExpenseEntry` and the other pending flows, so it would steal expense voice notes. Fix:
    - The hook fires only when `botAiModeUntil > now` **and** no other pending map holds the chat.
    - Entering `/ai` clears the other states, and entering another flow clears AI mode.
    - Cache `botAiModeUntil` in memory with a DB fallback, so there is no extra DB hit on every message.
    - Register `/ai` in `setMyCommands` (`bot.ts:1416`).
11. **Shift-gate regex.** Add `ai:r:` (reminder done/snooze) alongside `ai:a:` and `ai:o:`. Keep `ai:x:` gated.

---

## E. Missing tests (beyond those listed)

- Stale-session sweeper.
- Busy-requeue cap.
- Event-driven step chain after a simulated crash between `call.place` and `call.state`: no double dial.
- Worker lease fencing: two fake workers, the old one must self-fence, and the second waits for TTL.
- Planner catch-up beyond `maxLateMin`, `skipDates`, ISO weekdays, and agreement with `todayInTashkent` at the date boundary.
- `run-now` after an automatic plan, and after a dead job.
- Partial-index null traps: inserting two docs with `dedupeKey: null` must succeed.
- Tool ceiling: an admin PUT granting finance to `ishchi` must return 400.
- Prompt-injection fixture: a transaction description containing "call notifyManager…" produces no executed write.
- Confirm double-submit race: exactly one execution.
- Telegram-call write tool: routed to an `ai:x` button, or refused.
- Callback forged `from.id`, group chat, and expired token.
- Webhook: re-register passes `secret_token`, and the webhook is exempt from the global limiter.
- Socket regressions:
  - existing `call:offer`/`answer`/`ice` shapes still reach CallOverlay, with `from` overwritten
  - dev-support cross-company calls still work
  - group relay requires membership
  - push dedupe on re-offer
  - presence for dasturchi
- Existing-bot regressions:
  - `confirm_checkin` and checkout
  - the `confirm_<txId>` catch-all (`bot.ts:2716`) is never reached by `ai:` data
  - the expense voice flow is unaffected outside `/ai` mode
  - the morning reminder is unchanged with the flag off
- `App.tsx`: a WebRTC offer during an AI call is auto-rejected.
- Full stack with a **fake worker** (`socket.io-client` emitting PCM) → `VoiceSessionManager` with `FakeVoiceProvider` → paced frames back. This is missing from P6.
- Load test: N=5 concurrent in-app sessions on a Starter-sized container, recording CPU and RSS.
- Existing `e2e/smoke.spec.ts` plus backend suites in CI, as a no-regression gate.

---

## F. Other breakage and risk notes

- **JWT startup throw:** gate on `process.env.RENDER === 'true'`. `NODE_ENV` is never set, and `render.yaml` uses `generateValue`, so this is safe.
- **`requireAuth` runs twice** with nested mounts. Use distinct prefixes instead of mount-order tricks: `/api/ai-voice/admin`, `/api/ai-voice/me`, `/api/ai-voice/platform`. A router-level `router.use(requireAiAdmin)` on `/api/ai-voice` would otherwise 403 every `/me` request that reaches it.
- **Retention and legal:** worker transcripts are personal data. Uzbekistan's personal-data law (ZRU-547, localisation article) is an open question for the whole system. Add it to the rollout checklist; do not block on it. Telegram API ToS 1.5 bans training on captured speech.
- **Bandwidth:** about 80 KB/s per call through Render (in plus out, plus base64 to Gemini), roughly 10 MB per 2-minute call. That is fine for a pilot. Track it in `AiUsageMetrics`.

---

# FINAL corrected work-package list

P0 goes first and ships on its own. P1 follows. P2–P8 then run in parallel and depend only on P1's frozen contracts and stubs. P9 runs last.

### P0: Security hotfixes (sequential, independent of AI, ships first)
- **Edits:**
  - `services/bot.ts`:
    - `setWebHook` `secret_token` (derived `HMAC(TELEGRAM_BOT_TOKEN,"webhook")` mapped to `[A-Za-z0-9_-]`), also in the 5-minute re-register
    - `notifyAdmins(message, kb, companyId)` with `companyId` **required**, call site `transactions.ts:245`
    - `sub_approve_`/`sub_reject_` require `isDev(user.role)` (~:2623)
  - `index.ts`:
    - webhook header check with `safeEqual`
    - exempt `/api/bot/webhook` from the global limiter (:184)
    - drop the duplicate `express.json()`
  - `middleware/auth.ts:44`: throw at startup when `JWT_SECRET` is missing and `RENDER==='true'`.
  - `services/socket.ts`:
    - `relay()` overwrites `from`/`fromName` from `socket.data`
    - target must be the same company, or share a `devSupport` group, or either side is dasturchi
    - `groupId` relays require membership
    - the handshake rejects `isBlocked` users and revoked sessions (`checkSessionNotRevoked`)
    - call push deduped per (from, to) for 60 s
    - presence scoped to `company:<id>`, with dasturchi receiving the presence of their devSupport-group members
  - `routes/ai.ts`:
    - `/execute` gets `aiLimit`
    - `delete_user`/`update_user` refuse when the target is `isOwner`, a direktor (for orinbosar callers), or the caller
    - phone uniqueness pre-check
    - role allow-list
    - `logAudit`
  - `routes/auth.ts:662-733` PUT/DELETE users: the same guards.
  - `frontend/src/app/AIAssistant.tsx:368`: confirm card for `direct_action`.
- **Tests:**
  - `webhookSecret.int.test.ts` (supertest: missing or wrong header gives 401; the limiter is not applied)
  - `notifyAdmins.int.test.ts`
  - `subApprove.int.test.ts`
  - `socketSecurity.int.test.ts` (spoofed `from`, cross-tenant target, dev-support allowed, group non-member, blocked or revoked handshake, push dedupe)
  - `ai.execute.int.test.ts`
  - `authUsers.int.test.ts`
  - Existing `smoke.spec.ts` must pass. Manual check: 1:1 and group calls still connect.
- **Rollout:** deploy, then watch the logs for webhook 401s for 5 minutes.

### P1: Foundation, frozen contracts, stubs and shared hooks (sequential, blocks P2–P8)
- **Creates (backend):**
  - **Models:** all 12 models from §2, with these changes:
    - all unique "sparse" indexes become `partialFilterExpression {$type: 'string'}`
    - `telegram.tgUserId` unique partial
    - `AiCallSession` gains `attemptKey` (unique partial) and `workerInstanceId`
    - `AiJob` gains `requires?: 'worker'` and `expiresAt` on **every** terminal status
    - drop `AiChannelConnection.activeCalls` and the `AiRateCounter` semaphores; concurrency comes from counting active sessions; keep `AiRateCounter` for rate windows only
    - `AiChannelConnection` gains `leaseId`, `leaseUntil`, `workerInstanceId`, and drops `encryptedSession` (the session lives on the worker)
    - `AiAssistantSettings.attendance.shifts[]` gains `maxLateMin: 60` and `skipDates[]`
    - `timezone` locked to `'Asia/Tashkent'`
    - `tools.byRole` is validated against the code ceilings
  - **`aiVoice/config.ts`**, which documents the single-instance realtime assumption and holds `AI_LIVE_MAX_CONCURRENT` and `AI_TG_MAX_CONCURRENT`.
  - **`aiVoice/contracts.ts`**, frozen:
    - DTOs, socket and worker protocol
    - binary frame `[16B UUID][u32 LE seq][PCM16LE]`
    - lease messages
    - `TextAgent` and `VoiceProvider` interfaces
  - **`aiVoice/lib/`**:
    - `crypto.ts` (AES-256-GCM, key versioning)
    - `workerAuth.ts` (Ed25519 challenge-response with a server nonce; replaces `hmac.ts`)
    - `zonedTime.ts` (ISO weekday, must agree with `todayInTashkent`)
    - `redact.ts`, `ids.ts`, `mongoRateLimit.ts`
    - `geminiKeys.ts` (single key rotation)
    - `managers.ts` (`resolveManagers`, same company only)
    - `untrusted.ts` (truncate and wrap free text)
  - **`aiVoice/settings.ts`** (defaults merge, 10 s cache, `isAiActive`, ceiling enforcement), plus `audit.ts`, `usage.ts`, `pricing.ts`.
  - **`aiVoice/tools/`** `{types, registry, executor, rbac, validate}.ts`:
    - `AiToolDef` gains `maxRoles` (code ceiling), `channels` allow-list and `behavior: 'BLOCKING'`
    - the executor re-reads the user, company and feature per call (10 s cache)
    - confirmation goes through an atomic `findOneAndUpdate` transition
    - writes affecting another user always require a human button
  - **`aiVoice/queue/`**:
    - `jobQueue.ts` (claim honours `requires`, sweeper, backoff, terminal TTL)
    - `handlers.ts` (calls `registerHandlers` from the stubs)
    - `sessionSweep.ts` (stale `isActive` sessions become `interrupted`)
  - **`aiVoice/channels/`** `{types, registry}.ts` plus **stub adapters** `{botChannel, pushChannel, managerChannel, inAppCallChannel, telegramCallChannel}.ts` (all return `unavailable`).
  - **`aiVoice/voice/types.ts`** and **`aiVoice/brain/textAgent.ts`** stub.
  - **`aiVoice/bootstrap.ts`**: `startAiVoice`, SIGTERM drain up to the configured shutdown delay, instance heartbeat with a two-instance warning.
  - **Stubs with final signatures:**
    - `bot/botHooks.ts`
    - `socket/inAppSocket.ts`
    - `telegram/{workerNamespace,health}.ts`
    - `scheduler/index.ts`
    - `routes/{adminRoutes,meRoutes,platformRoutes}.ts`
    - exported `aiEndSessionsForUser(userId)`
- **Creates (frontend):**
  - `aiVoice/bus.ts` (`openAiVoiceCall`, `isAiCallActive`) and `aiVoice/protocol.ts`
  - stubs `AiVoiceRoot.tsx`, `settings/{AiSettingsPanel,MyAiPrefsPanel,TelegramAccountPanel}.tsx`, `i18n/ns/{aiVoice,aiVoiceCall}.ts`
- **Shared edits:**
  - **`index.ts`:** mount `/api/ai-voice/platform` (`requireAuth`, `requireDeveloper`), `/api/ai-voice/me` (`requireAuth`, `blockDeveloper`) and `/api/ai-voice/admin` (`requireAuth`, `blockDeveloper`) near :254, all with distinct prefixes. Call `startAiVoice()` after `startAutoSnapshots()` (:374).
  - **`socket.ts`:** `registerAiWorkerNamespace(io)` after `io` is created; `registerAiVoiceSocket(socket)` in `connection`.
  - **`bot.ts`:**
    - `registerBotInstance(bot)`
    - shift-gate regex :2301 adds `ai:a:|ai:o:|ai:r:`
    - callback hook after the subscription gate (before `subcheck`)
    - message hook after the shift gate, firing only in AI mode with no other pending state; the hook clears other states
    - `/ai` added to `setMyCommands`
    - `resetChatState` calls `aiBotResetChat`
    - `sendMorningReminders` skips users with today's `AiAttendanceConfirmation` (one batched query)
  - **`routes/sessions.ts` revoke and `users.ts` setBlocked:** call `aiEndSessionsForUser`.
  - **`workGate.ts:26`:** add `/^\/api\/ai-voice\/me/` to `ALLOW`.
  - **`models/User.ts`:** `telegramChatId` index.
  - **`models/AiConversation.ts`:** `source`, `sessionId`, `correlationId`.
  - **`models/Notification.ts`:** add the `ai` type, and the frontend NotificationCenter gets a default icon.
  - **`backend/package.json`:**
    - `@google/genai@^2.28`
    - dev deps `supertest`, `@types/supertest`, `socket.io-client`
    - `"engines": {"node": "24.x"}`
    - **all** future npm deps added here
  - **`render.yaml`:** `NODE_VERSION`, plan ≥ Starter (flagged for the owner's decision), shutdown delay, new env names with `sync:false`, fix the env drift.
  - **`backend/.env.example`:** new env names and the drift fixes.
  - **CI:** all workflows on Node 24. `backend-tests.yml` runs `tsc --noEmit` plus `tsc -p tsconfig.test.json`, after a local clean run.
  - **`App.tsx`:**
    - lazy `AiVoiceRoot` next to `<AIAssistant>` with `busy={!!activeCall}`
    - `onCallOffer` (4901) auto-rejects with busy when `isAiCallActive()`
  - **`AIAssistant.tsx`:** header button.
  - **`ProfilePage.tsx`:** two `menuRows` entries plus panels.
  - **`DeveloperPanel.tsx`:** `aiVoice` tab.
  - **`i18n/index.ts`:** the two namespaces.
- **Tests:**
  - `models.int.test.ts` (partial indexes including the null trap; duplicate active call rejected; `attemptKey` unique)
  - `crypto.test.ts`
  - `workerAuth.int.test.ts` (bad signature, replayed server nonce)
  - `jobQueue.int.test.ts` (concurrent claim exactly once; lease expiry; dead letter; terminal TTL; `requires: 'worker'` claim filter; drain)
  - `sessionSweep.int.test.ts`
  - `executor.int.test.ts` (role ceiling vs settings escalation; cross-tenant ids in args; re-read of a blocked or demoted user; PII redaction; atomic confirm race; other-user writes always need confirmation; channel allow-list; audit rows)
  - `zonedTime.test.ts` (boundary agreement with `todayInTashkent`, ISO weekday, wrap-around quiet hours)
  - `settings.test.ts`
  - `botHooksWiring.int.test.ts` (with stub hooks, the existing `confirm_checkin`, `confirm_<txId>`, expense voice and morning reminder all behave as before)
  - frontend `bus.test.ts` (`onCallOffer` busy auto-reject)

### P2: ERP tools and text agent
- **Creates:**
  - `aiVoice/tools/erp/{getMyTasks,getMySchedule,getProjectSummary,getInventoryBalance,getAttendanceSummary,reminders,getAllowedFinancialReport,notifyManager,getEmployeeProfile,attendanceCall,optOut}.ts` and `tools/erp/index.ts`
    - every tool has `maxRoles`, `channels` and `behavior: BLOCKING`
    - free text goes through `lib/untrusted.ts`
    - `notifyManager` uses `lib/managers.ts`
  - `aiVoice/brain/{systemPrompt.ts, textAgent.ts}` implementing the P1 interface: max 5 tool rounds, 20 s `AbortSignal` timeout, keys via `lib/geminiKeys.ts`.
- **No edits to `routes/ai.ts`** (moved to P0).
- **Tests:**
  - one `*.int.test.ts` per tool (2 seeded companies; isolation; role ceiling; phone and salary redaction; the Material-not-warehouse note)
  - `textAgent.test.ts` (mocked genai; tool loop; no success claim on error)
  - `injection.int.test.ts` (an injected transaction description does not trigger a write)

### P3: Scheduler, attendance flow, reminders, self routes
- **Creates:**
  - `aiVoice/scheduler/`:
    - `index.ts` (fills the stub; `registerHandlers`)
    - `planner.ts`: level-triggered, honours `maxLateMin` and `skipDates`, never plans after `absentCutoff`, E11000 retry
    - `attendanceFlow.ts` (pure state machine)
    - `attendanceRunner.ts`: event-driven steps, no job spans a call, pre-attempt Attendance and opt-out check, busy-requeue cap of 5
    - `reconciler.ts` (`checked_in` overrides every state, including `absent`)
    - `finalize.ts`
    - `reminders.ts` (insert the job first, then CAS `nextFireAt`; missed after 6 h; recurring skips forward)
    - `recurrence.ts` (ISO weekdays; defined weekdays = Mon–Sat)
    - `retention.ts`
    - `legacyReminderDedupe.ts` (ports the in-memory `lastReminderKeyIn/Out` to an `AiJob` dedupe key)
  - Fills the `channels/pushChannel.ts` stub (`createNotification` only, no double push) and the `channels/managerChannel.ts` stub.
  - Fills the `aiVoice/routes/meRoutes.ts` stub; it cannot set another user's data.
- **Tests:**
  - `attendanceFlow.test.ts`: all transitions; a voice answer leaves the status pending; a button never sets `checked_in`; check-in overrides including `absent`; opt-out; retries capped
  - `recurrence.test.ts`
  - `planner.int.test.ts`: fake clock; restart idempotency; catch-up beyond `maxLateMin` is bot-only; skipDates; `run-now` after an automatic plan and after a dead job
  - `attendanceRunner.int.test.ts`: crash between dispatch and outcome causes no re-dial; a stale session is swept and the flow continues
  - `attendance.e2e.int.test.ts`: full morning with fake channels; manager notified only within the same company
  - `meRoutes.int.test.ts` (supertest, workGate allow-list)

### P4: Telegram bot channel and hooks
- **Creates:**
  - fills the `aiVoice/channels/botChannel.ts` stub: `sendToUser` returns `messageId`; 403 marks the contact blocked; 429 `retry_after` requeues; no module-scope import of `bot.ts`
  - fills the `aiVoice/bot/botHooks.ts` stub:
    - `ai:a:` (attendance), `ai:r:` (reminders), `ai:x:` (confirm), `ai:o:` (consent/opt-out), plus the AI-mode message hook with precedence rules
    - callbacks require `chat.type === 'private'`, `from.id === chatId`, and a record bound to that employee and company
    - token expiry checked
    - atomic transitions, so repeat presses are idempotent
    - `isBlocked` users rejected
    - unsubscribed users treated as `no_answer`
    - the consent flow captures `tgUserId` from `from.id` and shows a `t.me/<account>` link with a one-time binding code
  - `aiVoice/bot/i18n.ts`, plus an exported uz-cyrl transliterator from `i18n/bot.ts`.
- **Tests:**
  - `botChannel.test.ts` (fake bot; 403/429; callback_data ≤64 bytes)
  - `botHooks.int.test.ts`:
    - forged token, group chat, `from.id` mismatch, other company, duplicate press, expired token, blocked user
    - an off-shift worker can press `ai:a`/`ai:o`/`ai:r` but not `ai:x`
    - an unsubscribed user's press is treated as `no_answer`
    - AI mode does not intercept expense voice notes or active `chatSessions`

### P5: Voice engine and in-app call backend
- **Creates:**
  - `aiVoice/voice/{provider.ts, geminiLive.ts, cascade.ts, vad.ts, fakeProvider.ts, prompts.ts, sessionManager.ts, disclosure.ts}`:
    - `geminiLive.ts`: BLOCKING tools, pre-connects during ringing, GoAway resume
    - `cascade.ts` takes the `TextAgent` by injection
    - `disclosure.ts` holds the pre-rendered TTS disclosure clip with a cache
    - `sessionManager.ts`: platform semaphore from counting active sessions; touches `updatedAt` every 15 s; per-session out-queue cap of about 500 ms; re-validates the user per tool call
    - keys come from `lib/geminiKeys.ts`
  - fills the `channels/inAppCallChannel.ts` stub: requires `aiv:presence visible` within the last 60 s, a 30 s ring, and an atomic accept from one tab with the others ended as `answered_elsewhere`
  - fills the `socket/inAppSocket.ts` stub:
    - websocket transport required
    - frames ≤8 KB, ≤60 per second, even length, bound to the socket id
    - `userSessionsPerHour` limit
    - off-shift refusal
  - `backend/scripts/aiv-eval-uz.ts`
- **No `socket.ts` edits** (moved to P0).
- **Tests:**
  - `sessionManager.int.test.ts` (tool bridging; the model cannot speak success before the tool response; duration hard stop; GoAway resume; usage rows; busy via the partial index; platform cap; SIGTERM leaves sessions `interrupted`; disclosure played first)
  - `cascade.test.ts`
  - `inAppSocket.int.test.ts` (real server plus `socket.io-client`: auth, off-shift refusal, incoming/accept/decline/busy, multi-tab accept race, frame size and rate caps, polling transport refused)
  - `geminiLive.live.test.ts` (skipped unless `RUN_LIVE_TESTS=1`)

### P6: Telegram call microservice and backend bridge
- **Creates (Python):** `tgcall-worker/`
  - `Dockerfile` (python:3.12-slim-bookworm)
  - `requirements.txt` with exact pins: py-tgcalls==3.0.0, ntgcalls==3.0.3, telethon==1.45.0, python-socketio[asyncio_client], numpy, soxr
  - `app/main.py`
  - `app/bridge.py`: Ed25519 challenge-response, websocket-only transport, RPC, reconnect with backoff
  - `app/lease.py`: fencing; Telethon starts only with the lease; disconnects Telethon on a failed renewal or 20 s without the socket
  - `app/session_store.py`: StringSession encrypted with `TG_SESSION_KEY` on the worker volume; never sent to the backend
  - `app/auth_flow.py`
  - `app/calls.py`:
    - place and hangup
    - raw `UpdatePhoneCall(PhoneCallWaiting)` ringing
    - error mapping
    - auto-discard of incoming calls
    - max 1 concurrent call
  - `app/binding.py`: matches DM one-time codes to the bot-known `tgUserId`, ignores everything else
  - `app/audio.py`: resampling, paced 10 ms sender with drift correction and silence fill
  - `app/udp_probe.py`, `app/health.py`
  - `tests/{test_audio.py, test_error_map.py, test_bridge_protocol.py, test_lease.py, test_incoming_discard.py, test_live_call.py (@pytest.mark.live)}`
  - `railway.json` (1 replica, no deploy overlap)
  - `.github/workflows/tgcall-worker-tests.yml`
- **Creates (backend):**
  - fills the stubs: `aiVoice/telegram/workerNamespace.ts` (fencing lease; records `workerInstanceId`) and `aiVoice/telegram/health.ts`
  - `workerRpc.ts`
  - `accountService.ts`: status, flood-wait, platform daily cap plus per-company quota; `contact.resolve` order is username, then binding code, then rate-limited `importContacts` that must match `from.id`
  - fills the `channels/telegramCallChannel.ts` stub: claims only on the worker instance; transient worker disconnect causes a requeue, not a fallback
  - fills the `aiVoice/routes/platformRoutes.ts` stub: no-store; 5 per 10 min; test-call requires consent; audit row
- **Tests:**
  - `workerNamespace.int.test.ts` (bad signature or replayed challenge rejected; second worker rejected until the lease expires; RPC timeout)
  - `telegramCallChannel.test.ts` (outcome mapping; consent and privacy gating; requeue on transient disconnect)
  - `platformRoutes.int.test.ts` (dasturchi only; codes never persisted, audited or logged; no session in the DB)
  - `fakeWorker.e2e.int.test.ts` (`socket.io-client` worker → `VoiceSessionManager` with the fake provider → paced frames back)
  - pytest in CI
  - The live call test is reported as passed only with `LIVE_TG=1` and a `live-call-report.json` file; otherwise it is "NOT RUN".

### P7: Frontend in-app call client
- **Creates:**
  - `aiVoice/audio/{capture.worklet.js, player.worklet.js, pcmCapture.ts, pcmPlayer.ts, resample.ts, duplexGate.ts}` (half-duplex barge-in gating)
  - `aiVoice/{useAiVoiceSession.ts, AiVoiceCallOverlay.tsx, AiIncomingCall.tsx, nativeAttention.ts, ttsFallback.ts}`
    - `useAiVoiceSession.ts` emits `aiv:presence` and subscribes when the socket connects
    - push-to-talk is the default on Android
  - Fills `AiVoiceRoot.tsx` and `i18n/ns/aiVoiceCall.ts`.
- **Tests:**
  - vitest `resample.test.ts`, `pcmPlayer.test.ts`, `duplexGate.test.ts`
  - `useAiVoiceSession.test.tsx` (state machine; busy auto-decline; no `getUserMedia` before Accept; presence events; socket connecting late)
  - Playwright `e2e/ai-voice.spec.ts` (fake media device, mocked socket, phone and desktop projects)
  - existing `smoke.spec.ts` stays green

### P8: Admin settings backend and UI
- **Creates:**
  - fills the `aiVoice/routes/adminRoutes.ts` stub (mounted at `/api/ai-voice/admin`):
    - tools matrix validated against the code ceilings
    - only direktor or the owner may edit the direktor and orinbosar rows
    - `PATCH /employees` cannot set consent or opt-out
    - `run-now` uses a manual dedupe key
    - timezone is read-only
  - fills `settings/{AiSettingsPanel, MyAiPrefsPanel, TelegramAccountPanel}.tsx`
  - `settings/sections/{General,Schedule,Channels,Employees,ToolsMatrix,Provider,LimitsCost,AuditLog,TestCall}.tsx`
    - Schedule includes `maxLateMin` and `skipDates`
  - `settings/api.ts`, `i18n/ns/aiVoice.ts`
- **Tests:**
  - `adminRoutes.int.test.ts`:
    - orinbosar allowed, prorab 403, dasturchi blocked
    - feature gate fails closed
    - version conflict 409
    - secrets never in responses
    - ceiling escalation rejected
    - consent fields rejected
  - vitest `AiSettingsPanel.test.tsx` (HH:mm; fallback-order uniqueness; skipDates)
  - Playwright `e2e/ai-settings.spec.ts` (Telegram login inputs cleared; nothing written to localStorage)

### P9: Integration, load and go-live gate (after P2–P8)
- Full-stack CI scenario:
  - seeded 2 companies
  - fake worker plus `FakeVoiceProvider`
  - a morning run: bot message → escalation to Telegram call → button → check-in → `checked_in`; another user ends `absent`; the manager is notified only within the same company
- Load test: 5 concurrent in-app sessions and 1 Telegram session on a Starter-sized container, recording CPU and RSS against a budget.
- Device matrix: real Android phones (AudioWorklet, mic prompt, echo or self-interruption, background), Windows EXE (WebView2 mic, tray window coming to the front).
- Evaluations, each marked NOT RUN until actually executed:
  - `aiv-eval-uz.ts` with 10–20 real worker phrases is the go/no-go for the Live primary
  - 20+ live Telegram calls on mobile data
  - the UDP probe on the worker host
- **Rollout:**
  1. Render ≥ Starter, P0 deployed, webhook 401s monitored.
  2. Pilot company with `fallbackOrder ['bot_message','inapp_call','push','notify_manager']`.
  3. Add `telegram_call` as an escalation step only, after the live-call report and the Uzbek evaluation pass, with `AI_TG_MAX_CONCURRENT=1` and per-company quotas.
  4. Deploy freeze around `callTime ±2h`.

### Dependencies
- P0 → P1 → {P2, P3, P4, P5, P6, P7, P8} → P9.
- Soft contracts, all frozen in P1:
  - P3 reaches channels only through `channels/registry` and the stub adapters.
  - P5 uses the `TextAgent` interface (implemented by P2) by injection.
  - P6 uses `VoiceSessionManager` through `voice/types.ts`.
  - P7 and P8 code against `protocol.ts` and `contracts.ts`.
- Model, contract or npm changes after P1 go only through a P1 follow-up PR.
- No package edits `bot.ts`, `socket.ts`, `index.ts`, `App.tsx` or `routes/ai.ts` except P0 and P1.
---

## Owner decisions (2026-10-13)

- **Work schedule is set manually by the company owner** (direktor/owner, optionally orinbosar) from **all three surfaces: the existing Telegram bot, the app and the site**:
  - work start time (the AI call/check time derives from it)
  - weekly workdays (ISO weekdays, freely chosen; not fixed to Mon–Sat)
  - per-date overrides: `skipDates[]` (no work on that date, e.g. holidays) **and** `extraWorkDates[]` (work on a normally-off day)
  - The planner must honour all three. P3 (planner), P4 (bot: an owner-only schedule menu with inline buttons such as time picker, weekday toggles, date add/remove) and P8 (settings UI) must implement this. The bot flow must reuse the existing ERP bot (`services/bot.ts` via the hooks); **no new bot**.
- **Pilot:** company "Jondor Iris Stroy", test user (the owner's own Telegram, already linked to the bot). The owner has already DM'd the AI Telegram account and opened call privacy.
- Worker hosting: Railway deferred; try Render first with the UDP probe.
