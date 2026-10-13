# Research findings (2026-10-12)

## Can a server-side program logged in as a Telegram user account (MTProto) place a real 1-to-1 private voice call, read the callee's audio frames in real time and stream synthesized PCM back? Evaluated: py-tgcalls + ntgcalls (versions, API, frames in and out), client compatibility, Node.js options, call-state events, network needs (Render/containers), CPU/RAM, Python version, Telegram ToS and ban risk, and a minimal Python proof of concept.

**Verdict:** YES, technically feasible (about 85% confident). The stack is py-tgcalls 3.0.0 (released 2026-09-25) plus ntgcalls 3.0.3 (released 2026-10-11), driven by Telethon 1.45 or a maintained Pyrogram fork (Kurigram, PyrogramMod). An account can place an outgoing private call by calling play(user_id) with a positive id. You push raw PCM16LE in 10 ms chunks with send_frame(chat_id, Device.MICROPHONE, bytes). You read the callee's decoded PCM in real time from the stream_frame(Direction.INCOMING, Device.MICROPHONE) update after record(chat_id, RecordStream(True, params)). I confirmed this from the library source and from public issues where people do exactly this: an outgoing P2P call with ExternalMedia.AUDIO and RecordStream, from a python:3.12-slim container on Railway (no inbound UDP).

Four caveats:
(a) The call must come from a user account. Bots cannot call; phone.requestCall is "Only users can use this method".
(b) Reliability depends on the version. Before a September-2026 ntgcalls fix (issue #70), 40-50% of outgoing calls to phones on carrier NAT never got media, and that includes 2.3.3. The reporter measured 10/10 connected after the fix. Use ntgcalls >= 3.0.2 (py-tgcalls 3.0.0 already requires it).
(c) Render specifically is UNVERIFIED. The call needs outbound UDP to Telegram reflectors, and Render does not document UDP egress. Railway is shown to work. A TCP reflector path exists in the ntgcalls source but only helps if Telegram hands out TCP reflectors.
(d) The policy and ban risk is real. Automated calls from a user account are allowed only if they are not spam. Accounts that log in through unofficial clients are "under observation", and flooding or spamming gets a permanent ban.

There is no maintained high-level Node.js option. The ntgcalls npm 3.0.3 package exposes only the low-level media and crypto engine, so you would have to write all the MTProto call signaling yourself in GramJS. I did not verify that anyone has done this.

VERSIONS / HISTORY (checked against PyPI JSON and wheel contents)
- py-tgcalls: P2P private calls first appear in 2.0.0 (2024-04-17), which required ntgcalls >= 1.2.0b12. 1.2.9 has no request_call.
- send_frame, record(), RecordStream, ExternalMedia and the stream_frame filter first appear in 2.1.0 (2025-03-16), which required ntgcalls >=1.3,<1.4.
- 2.3.3 (2026-06-16) requires ntgcalls >=2.2.4,<3. Current is 3.0.0 (2026-09-25), with requires-python >=3.10 and deps aiohttp>=3.9.3, ntgcalls>=3.0.2,<4.0.0, deprecation. 3.0.1b1 is on PyPI (2026-10-11).
- ntgcalls 3.0.3 (2026-10-11) ships wheels for cp310-cp314 and cp314t on manylinux_2_28 x86_64/aarch64, macOS arm64 and win_amd64. The wheel is about 43 MB. It needs glibc >= 2.28, so Debian bookworm-slim works and Alpine/musl has no wheel.

CLIENT COMPATIBILITY (verified in pytgcalls/mtproto/mtproto_client.py)
- The client is detected only by top-level package name: 'pyrogram' or 'telethon'. Minimums are pyrogram 1.2.20 and telethon 1.24.0.
- Telethon 1.45.0 (2026-09-10): OK and the most battle-tested in the issues.
- Kurigram 2.2.26 (2026-09-12) and PyrogramMod 2.4.1: both import as `pyrogram`, so they work. The 3.0 extra `[pyrogram]` pulls in pyrogrammod. Do not install two pyrogram forks together, because they overwrite each other's files.
- Original Pyrogram 2.0.106 (2023): very likely broken. pyrogram_client.py imports newer constructors such as PhoneCallDiscardReasonMigrateConferenceCall that its old layer lacks. I inferred this from the imports and did not run it.
- Hydrogram: had a hydrogram_client.py in 2.0.x-2.2.x. It is removed in 2.3.3 and 3.0, even though PyPI text still lists it. Treat it as unsupported.

HOW A P2P CALL WORKS IN 3.0 (methods/stream/play.py and methods/internal/connect_call.py)
- play(chat_id>0, stream, CallConfig(timeout=60)) does the whole handshake: getDhConfig, binding.create_p2p_call, set_stream_sources(CAPTURE), init_exchange, then phone.requestCall with ntgcalls' protocol (library_versions, udp_p2p, udp_reflector).
- It then waits up to config.timeout for the callee to accept, and runs exchange_keys, phone.confirmCall and connect_p2p(rtc_servers, library_versions, p2p_allowed, custom_parameters).
- It returns only once ntgcalls reports CONNECTED.
- Exceptions:
  - CallDeclined: the callee hung up or rejected. A "missed" reason also maps here.
  - CallBusy: PhoneCallDiscardReasonBusy.
  - TimedOutAnswer: no answer within the timeout. The library then discards the call itself.
  - CallDiscarded
  - TelegramServerError: connection failed. P2P calls are not retried.
- record(chat_id, RecordStream(True, AudioParameters(48000,1))) sets PLAYBACK sources to MediaSource.EXTERNAL. Decoded remote audio then arrives as StreamFrames(chat_id, direction, device, frames[]), where each Frame has .ssrc, .frame (bytes) and .info.
- Outgoing audio: MediaStream(ExternalMedia.AUDIO, AudioParameters(...)) and then send_frame(chat_id, Device.MICROPHONE, pcm_bytes).
  - The official example uses PCM16LE chunks of bitrate*2*channels/100 bytes (10 ms) and paces them with sleep(0.01).
  - 48 kHz mono is 960 bytes per chunk.
  - You must pace the chunks yourself in real time.
- The official bridged_calls example decodes incoming frames with np.frombuffer(frame.frame, np.int16). That confirms the incoming data is raw s16le at the record AudioParameters.
- An alternative to send_frame is a shell or ffmpeg pipe source (example/piped_audio_calls, fifo_conversion).

CALL STATES YOU CAN OBSERVE
- ChatUpdate.Status values: INCOMING_CALL, DISCARDED_CALL, BUSY_CALL, MIGRATE_TO_CONFERENCE_CALL, INCOMING_CONFERENCE_CALL and others. LEFT_CALL is a combined mask that includes DISCARDED_CALL and BUSY_CALL. Subscribe with filters.chat_update(ChatUpdate.Status.LEFT_CALL).
- Accepted / connected: play() returns.
- Busy, declined or missed, and timeout: the exceptions above.
- Remote hangup after connect: a DISCARDED_CALL ChatUpdate, and the library clears the call.
- Network drop: ntgcalls ConnectionState other than CONNECTED, after which the library discards the call.
- Missing: there is NO explicit "ringing" event. PhoneCallWaiting.receive_date is cached but not propagated. If you need ringing, add your own Telethon raw handler for UpdatePhoneCall(PhoneCallWaiting) and check whether receive_date is set.
- Also, "missed" and "declined" are not told apart. Both raise CallDeclined. To separate them, inspect the raw PhoneCallDiscarded reason yourself.

NODE.JS
- GramJS has no VoIP media.
- tgcalls / gram-tgcalls on npm were last updated in 2022, are group-call only and use wrtc. Dead.
- ntgcalls on npm 3.0.3 (2026-10-11, node>=18, prebuilt @ntgcalls/linux-x64, linux-arm64, win32-x64, darwin-arm64) exposes createP2pCall, initExchange, exchangeKeys, connectP2p, sendSignalingData, sendExternalFrame, onFrames, onSignalingData and getProtocol.
- You would have to port pytgcalls' signaling yourself: getDhConfig, requestCall, UpdatePhoneCall handling, confirmCall/acceptCall, and relaying phone.sendSignalingData and UpdatePhoneCallSignalingData through GramJS raw Api.
- That is feasible but about 300-600 lines of fragile code. Recommendation: run a small Python sidecar service, and let Node talk to it over HTTP or WebSocket.

NETWORK
- MTProto: outbound TCP 443 (or 80/5222).
- Media: WebRTC over Telegram reflectors/TURN, with addresses and ports supplied per call in phoneCall.connections. Only outbound UDP is needed. No inbound ports, because ICE goes from the container out to the relays.
- The ntgcalls source has a TCP reflector socket (wrtc ReflectorPort with PROTO_TCP / RawTcpSocket). It is skipped for ICE servers and used only when Telegram's connection list contains TCP-flagged reflectors. Do not rely on it if UDP egress is blocked.
- SOCKS/HTTP proxies do not carry the UDP media (the telegram-call-mcp README says the same).
- Demonstrated on Railway in a python:3.12-slim-bookworm container (issue #70). Render web services and background workers are not documented for UDP egress, so test first. A fallback is a small VPS (Hetzner, DO) or Fly.io.
- Use a Background Worker on Render, since nothing needs to listen.

CPU / RAM (my estimate, not measured)
- One audio-only call is one libwebrtc instance with Opus encode/decode at 48 kHz: roughly 2-10% of one vCPU and about 100-200 MB RSS for the whole Python process.
- A 512 MB instance should handle 1-3 concurrent calls. Avoid video. RecordStream(camera=True) caused SIGSEGV bugs in rc builds, fixed 2026-09-14 (issue #69).
- pytgcalls has a cpu_usage() utility you can use to measure.
- The GIL deadlock between native callbacks and Python I/O was fixed in 3.0.0b19 (issue #62).

TOS / BAN
- API ToS 1.4 prohibits "making actions on behalf of the user without the user's knowledge" and interfering with basic functionality.
- API ToS 1.5 prohibits using Telegram data to train AI. Do not train on captured speech.
- obtaining_api_id: "If you use the Telegram API for flooding, spamming ... you will be banned forever"; "All accounts that log in using unofficial Telegram API clients are automatically put under observation"; appeals go to recover@telegram.org.
- The consumer ToS bans spam and scams.
- requestCall can fail with:
  - USER_PRIVACY_RESTRICTED (the callee's "Who can call me" setting)
  - USER_IS_BLOCKED
  - PARTICIPANT_VERSION_OUTDATED
- I found no published rate limits for phone.requestCall. Expect FLOOD_WAIT_X; this is unverified.
- Mitigations:
  - Use a dedicated account on a real (non-VoIP) SIM.
  - Let it age and use it normally for a few days before automating.
  - Create the session string once, interactively. Keep the session string as a secret, and never run the same session in two places at once (AUTH_KEY_DUPLICATED).
  - Use a stable host and region.
  - Call only people who opted in: they are contacts or messaged the account first. Send a text before calling, as telegram-call-mcp does.
  - Keep volume low and space out calls.
  - Respect FloodWaitError.
  - Tell the callee it is an automated assistant and that audio is processed. Check local call-recording and consent law.
  - Turn on 2FA.

MINIMAL POC (Python 3.12, `pip install "py-tgcalls==3.0.0" "ntgcalls>=3.0.3" telethon==1.45.0 numpy`). I outlined this from source; I did not run it.
```python
import asyncio, os, time
from telethon import TelegramClient
from telethon.sessions import StringSession
from pytgcalls import PyTgCalls, filters
from pytgcalls.types import (MediaStream, ExternalMedia, RecordStream, Device,
                             Direction, StreamFrames, ChatUpdate, CallConfig)
from pytgcalls.types.raw import AudioParameters
from pytgcalls.exceptions import CallBusy, CallDeclined, TimedOutAnswer

AP = AudioParameters(bitrate=48000, channels=1)
CHUNK = AP.bitrate // 100 * 2 * AP.channels          # 10 ms of s16le = 960 B
TARGET = int(os.environ["TARGET_USER_ID"])

client = TelegramClient(StringSession(os.environ["TG_SESSION"]),
                        int(os.environ["TG_API_ID"]), os.environ["TG_API_HASH"])
calls = PyTgCalls(client)
heard = bytearray(); ended = asyncio.Event()

@calls.on_update(filters.stream_frame(Direction.INCOMING, Device.MICROPHONE))
async def on_audio(_, u: StreamFrames):
    if u.chat_id == TARGET:
        for f in u.frames: heard.extend(f.frame)   # raw PCM16LE 48k mono -> VAD/STT

@calls.on_update(filters.chat_update(ChatUpdate.Status.LEFT_CALL))
async def on_left(_, u: ChatUpdate):
    if u.chat_id == TARGET: ended.set()

async def push_pcm(pcm: bytes):                      # real-time pacing w/ drift correction
    t0 = time.monotonic()
    for n, i in enumerate(range(0, len(pcm), CHUNK), 1):
        await calls.send_frame(TARGET, Device.MICROPHONE, pcm[i:i+CHUNK].ljust(CHUNK, b"\0"))
        await asyncio.sleep(max(0, t0 + n*0.01 - time.monotonic()))

async def main():
    await client.start()          # session already authorized -> no prompt
    await calls.start()
    await client.get_entity(TARGET)   # needs access_hash: user must be contact/known dialog (or use @username)
    try:
        await calls.play(TARGET, MediaStream(ExternalMedia.AUDIO, AP), CallConfig(timeout=45))
    except CallBusy:      return print("busy")
    except CallDeclined:  return print("declined/missed")
    except TimedOutAnswer:return print("no answer")
    await calls.record(TARGET, RecordStream(True, AP))
    greeting = open("greeting_48k_mono_s16le.raw", "rb").read()  # e.g. ffmpeg -i tts.mp3 -f s16le -ar 48000 -ac 1
    await push_pcm(greeting)
    try: await asyncio.wait_for(ended.wait(), 20)
    except asyncio.TimeoutError: pass
    if not ended.is_set(): await calls.leave_call(TARGET)
    open("heard.raw", "wb").write(heard)

client.loop.run_until_complete(main())
```
Unverified details in the PoC:
- Whether MediaStream(ExternalMedia.AUDIO, AP) needs video_flags=MediaStream.Flags.IGNORE for audio-only. Issue #70 used AUTO_DETECT.
- Exact frame size and cadence of incoming frames (probably 10 ms).
- Whether you must keep sending silence frames while idle. For a conversational agent, run one sender task that drains a queue and sends zero-filled frames when it is empty.
- Whether record() before vs after play() matters for P2P. record() calls play() if no call exists.

Generate the session string once locally with Telethon: `StringSession.save(client.session)` after an interactive login.

**Risks**
- Account ban or restriction: unofficial-client logins are 'under observation'; spam or flooding means a permanent ban; new accounts and VoIP numbers are often banned soon after creating a session (Telethon issue #3861). No published rate limit for phone.requestCall (unverified).
- Render UDP egress is undocumented. If outbound UDP is blocked, media will not connect even though MTProto works. Railway is shown to work. TCP reflector fallback depends on Telegram offering TCP-flagged reflectors.
- Connection reliability depends on the version: ntgcalls <= 3.0.0rc3 and py-tgcalls 2.3.3 had 40-50% 'never connects' on outgoing calls to phones on carrier NAT (issue #70, fixed 2026-09). Pin ntgcalls >= 3.0.2 and test 20+ calls to real phones on mobile data.
- The library is young and native: SIGSEGV on video-track teardown (issue #69, fixed 2026-09-14) and a GIL deadlock during callbacks (issue #62, fixed 3.0.0b19). Stay audio-only, run the call engine in its own process, and add a supervisor or auto-restart.
- API churn: telegram-call-mcp pins 2.3.3 because 'private-call APIs are version-sensitive'; 3.0 changed internals (conference calls, MIGRATE_TO_CONFERENCE_CALL). Pin exact versions.
- No native 'ringing' event, and 'missed' vs 'declined' both raise CallDeclined. Extra raw UpdatePhoneCall handling is needed for precise states.
- The callee can refuse: USER_PRIVACY_RESTRICTED ('Who can call me'), USER_IS_BLOCKED, PARTICIPANT_VERSION_OUTDATED. Telethon must also already know the user's access_hash (contact, dialog or username), otherwise get_entity(user_id) fails.
- Hydrogram is unsupported in 2.3+/3.0 despite PyPI text. Original Pyrogram 2.0.106 is likely incompatible. Installing two pyrogram forks together breaks imports.
- Legal and privacy: recording or transcribing a call may need consent under local law; Telegram API ToS 1.5 forbids using Telegram data to train AI.
- Node.js has no maintained wrapper. Hand-porting the P2P signaling onto ntgcalls npm is error-prone; a Python sidecar is safer.
- CPU/RAM figures are estimates, not measurements. The PoC code was assembled from source and examples and has not been executed.

**Needs owner credentials**
- Telegram api_id and api_hash from my.telegram.org for the app
- A dedicated Telegram user account: phone number (preferably a real SIM, not VoIP), the one-time login code and 2FA password, used once interactively to generate the StringSession, then stored as a secret (e.g. TG_SESSION env var on the host)
- The target user's Telegram user_id plus access (they are a contact, have messaged the account, or have a @username), and their privacy settings must allow calls from this account
- TTS provider API key (any provider that outputs audio convertible to 48 kHz s16le PCM)
- Hosting account (Render, Railway or a VPS) and a test to confirm outbound UDP egress
- Optionally an STT provider key, for transcribing the captured frames

**Sources**
- https://pypi.org/project/py-tgcalls/
- https://pypi.org/pypi/py-tgcalls/json
- https://pypi.org/pypi/ntgcalls/json
- https://github.com/pytgcalls/pytgcalls
- https://github.com/pytgcalls/pytgcalls/tree/master/example
- https://raw.githubusercontent.com/pytgcalls/pytgcalls/master/example/p2p_example/example_p2p.py
- https://raw.githubusercontent.com/pytgcalls/pytgcalls/master/example/frame_sending/example_frame_sending.py
- https://raw.githubusercontent.com/pytgcalls/pytgcalls/master/example/bridged_calls/example_bridged.py
- https://raw.githubusercontent.com/pytgcalls/pytgcalls/master/pytgcalls/types/chats/chat_update.py
- https://raw.githubusercontent.com/pytgcalls/pytgcalls/master/pytgcalls/types/stream/record_stream.py
- https://raw.githubusercontent.com/pytgcalls/pytgcalls/master/pytgcalls/filters.py
- https://raw.githubusercontent.com/pytgcalls/pytgcalls/master/pytgcalls/exceptions.py
- https://raw.githubusercontent.com/pytgcalls/pytgcalls/master/pytgcalls/mtproto/pyrogram_client.py
- https://raw.githubusercontent.com/pytgcalls/pytgcalls/master/pytgcalls/mtproto/telethon_client.py
- https://github.com/pytgcalls/ntgcalls
- https://github.com/pytgcalls/ntgcalls/releases
- https://github.com/pytgcalls/ntgcalls/issues/70
- https://github.com/pytgcalls/ntgcalls/issues/69
- https://github.com/pytgcalls/ntgcalls/issues/62
- https://raw.githubusercontent.com/pytgcalls/ntgcalls/master/ntgcalls/src/p2p/rtc_server.cpp
- https://raw.githubusercontent.com/pytgcalls/ntgcalls/master/ntgcalls/src/instances/p2p_call.cpp
- https://raw.githubusercontent.com/pytgcalls/ntgcalls/master/wrtc/src/interfaces/reflector_port.cpp
- https://registry.npmjs.org/ntgcalls
- https://registry.npmjs.org/tgcalls
- https://registry.npmjs.org/gram-tgcalls
- https://glama.ai/mcp/servers/maloleg/telegram-call-mcp
- https://pypi.org/project/Kurigram/
- https://core.telegram.org/method/phone.requestCall
- https://core.telegram.org/api/terms
- https://core.telegram.org/api/obtaining_api_id
- https://telegram.org/tos
- https://core.telegram.org/api/end-to-end/voice-calls
- https://core.telegram.org/constructor/phoneConnectionWebrtc
- https://github.com/LonamiWebs/Telethon/issues/3861
- https://render.com/docs/background-workers
- https://www.betterclaw.io/blog/telegram-banned-ai-agent-what-to-do

## What is the best realtime conversational voice stack for an Uzbek (Latin) and Russian speaking construction workforce, run from a Node.js/TypeScript backend? This covers Gemini Live, Gemini TTS, the alternatives, a recommended primary pipeline and fallback with latency, and how to stream and play audio in a browser or WebView.

**Verdict:** Use Gemini Live (model `gemini-3.8-live`, stable/GA since Sep 2026) as the primary pipeline, through a Node WebSocket relay that uses the existing GEMINI_API_KEYS. Confidence is about 75%.

- **Language support:** The official Live API capabilities page lists both Uzbek (`uz`) and Russian (`ru`) among its 99 languages, with native audio in and out.
- **Uzbek quality is not proven:** Google publishes no Uzbek-specific benchmark. Third-party reviews say to "verify the languages you care about on a real call". Run a 1-day test with 10 to 20 real worker phrases before committing.
- **Fallback, same key, no new credentials:** a cascaded Gemini pipeline.
  - `gemini-3.5-transcribe-live` for streaming speech-to-text (uz-UZ and ru-RU are listed).
  - `gemini-3.8-flash` for the text model with function calling.
  - `gemini-3.8-flash-tts` with `stream:true` for speech ("Northern Uzbek" and Russian are listed).
- **Expected latency:** about 1.2 s time to first audio for Live (reported 1.18 s), plus about 80 to 150 ms network from Uzbekistan. About 2 to 3.5 s for the cascade.
- **Only add a new credential if Gemini's Uzbek output sounds wrong:** Yandex SpeechKit is the best non-Google option for Uzbek. It has uz-UZ speech-to-text and 3 native Uzbek voices: nigora, zamira, yulduz.
- **Rejected:**
  - Google Cloud TTS has no uz-UZ voice; Chirp 3 HD does not list it.
  - Google Cloud Speech-to-Text Chirp 3 does have uz-UZ, but it needs a separate GCP service account.
  - OpenAI Realtime would mean a new vendor, and its Uzbek quality is unverified.
  - ElevenLabs has Uzbek in Eleven v3/v4 and Scribe but not in Flash v2.5. It is a new vendor and costs more.
- **Browser audio:** AudioWorklet capture, downsampled to 16 kHz PCM16 and sent in about 40 to 100 ms chunks over a WebSocket. Play back through an AudioWorklet ring buffer at 24 kHz. Gemini Live has no native WebRTC, so WebRTC only makes sense through LiveKit or Pipecat, which would be another vendor.

## 0. Project state (checked in the repo)
- `backend/package.json` uses the deprecated `@google/generative-ai` ^0.24.1, which has no Live API support.
- You need to add `@google/genai`. The latest on npm is 2.28.0, published 2026-10-07, and it requires Node >= 20.
- The key rotation in `backend/src/services/gemini.ts` (`GEMINI_API_KEYS`) can be reused to pick a key for each Live session.
- Render (`render.yaml`) supports long-lived WebSockets, so a relay will work there.

## 1. Gemini Live API (checked against ai.google.dev, 2026-10-12)

### Models
| Model | Status | Use |
|---|---|---|
| `gemini-3.8-live` | Stable | Recommended default, latency first |
| `gemini-3.8-live-extended-thinking` | Stable | Background reasoning, `thinkingLevel` low/medium/high |
| `gemini-3.1-flash-live-preview` | Preview, legacy | Do not use for new work |
| `gemini-2.5-flash-native-audio-preview-12-2025` | Only for projects that already had access | Do not use for new work |
| `gemini-3.5-transcribe-live` | Stable | Streaming speech-to-text only |
| `gemini-3.5-live-translate-preview` | Preview | Speech-to-speech translation, `uz` supported |

### Languages
- The capabilities page lists 99 languages with BCP-47 codes, including `ru` and `uz`.
- Native audio models choose the output language themselves; you cannot force a languageCode. Pin it in the system instruction, for example: "Always reply in Uzbek (Latin script, o'zbek lotin). If the user speaks Russian, reply in Russian."

### Audio
- Input: raw PCM16 LE mono at 16 kHz, mimeType `audio/pcm;rate=16000`. Other sample rates are resampled by the server.
- Output: PCM16 LE mono at 24 kHz.
- Native audio models return AUDIO only. Turn on `inputAudioTranscription: {}` and `outputAudioTranscription: {}` to get text for the UI and for logs.

### Connecting with the Node SDK
```ts
import { GoogleGenAI, Modality, Behavior } from '@google/genai';
const ai = new GoogleGenAI({ apiKey });
const session = await ai.live.connect({
  model: 'gemini-3.8-live',
  config: {
    responseModalities: [Modality.AUDIO],
    systemInstruction: { parts: [{ text: SYS_PROMPT_UZ }] },
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    inputAudioTranscription: {}, outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 600 } },
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: { handle: prevHandle },
    tools: [{ functionDeclarations: [/* ERP tools */] }],
  },
  callbacks: { onopen, onmessage, onerror, onclose },
});
session.sendRealtimeInput({ audio: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' } });
// on msg.toolCall.functionCalls:
session.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: { result } }] });
```
- On `serverContent.interrupted`, flush the playback buffer. That message means the user started talking over the model.

### Tools and function calling
- 3.8 Live supports asynchronous function calling. Set `behavior: NON_BLOCKING` (the default) or `BLOCKING`. When you answer a non-blocking call, set the scheduling to `INTERRUPT`, `WHEN_IDLE` or `SILENT`.
- Google Search can be used as a tool.
- The Vertex guide says a tool handler must never return `{}` or `None`. Return `{status, retryable, message}` instead.

### Session limits
- Audio-only sessions stop at 15 minutes without compression. Audio plus video stops at 2 minutes.
- The WebSocket connection itself lasts about 10 minutes. The server sends a `GoAway` message with `timeLeft` before it closes.
- Use `sessionResumption`: the server sends a `SessionResumptionUpdate` handle that stays valid for 2 hours. Use `contextWindowCompression.slidingWindow` for sessions with no fixed end.
- Context window is 128k tokens.

### Pricing (official pricing page)
- `gemini-3.8-live`: audio in $3.00 per 1M tokens (about $0.005/min), audio out $12.00 per 1M tokens (about $0.018/min).
- A 5-minute conversation costs about $0.06 to $0.10.

### Ephemeral tokens (direct browser connection)
```ts
const token = await ai.authTokens.create({
  config: {
    uses: 1,
    expireTime,
    newSessionExpireTime: new Date(Date.now() + 60_000),
    liveConnectConstraints: {
      model: 'gemini-3.8-live',
      config: { sessionResumption: {}, responseModalities: ['AUDIO'] },
    },
  },
});
```
- The browser then uses `token.name` as its apiKey.
- Tokens only work for the Live API on v1beta. The default `expireTime` is 30 minutes and `newSessionExpireTime` is 1 minute.

### Recommended architecture
- **Relay (recommended for this ERP):** browser WS → Node relay → Gemini Live. ERP tools run on the server with tenant and auth context, the key stays hidden, the existing key rotation is reused, and transcripts can be logged and rate-limited. The extra hop costs about 20 to 60 ms.
- **Direct browser connection with an ephemeral token (lowest latency):** tool calls arrive in the browser and must be forwarded to the backend REST API. Lock the system prompt and tools with `liveConnectConstraints`.

## 2. Gemini TTS
- Current models: `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`, both stable. `gemini-2.5-flash-preview-tts` is now only for projects that already had access.
- The language table marks both "Northern Uzbek" and Russian as supported on both models. Language is detected automatically.
- Output is 24 kHz PCM16. A unary request returns WAV; `stream:true` returns raw `audio/l16` chunks.
- There are 30 prebuilt voices plus an extended voice library (`voices.list()`).
- The docs call it through the new Interactions API: `client.interactions.create({model:'gemini-3.8-flash-tts', input:[...], response_format:{type:'audio'}, generation_config:{speech_config:[{voice:'Kore'}]}})`.
- Prices are per 1M tokens. 3.8 Flash TTS: text in $0.50, audio out $9.00 until 2026-12-31, then $1.00 and $18.00. Flash-Lite TTS: audio out $6.00, then $12.00.

## 3. Alternatives
| Service | Uzbek and Russian support | Notes |
|---|---|---|
| Google Cloud STT v2 | uz-UZ on `chirp_3` and `chirp_2` (Chirp 3 uz-UZ is Preview). ru-RU also on `long` and `short`. | Needs a GCP project and service account. |
| Google Cloud TTS | Chirp 3 HD lists ru-RU (GA) but no uz-UZ. The voice list shows no Uzbek voice. | Not usable for Uzbek. |
| Yandex SpeechKit | STT: uz-UZ "Uzbek (Latin script)" on the `general` model; streaming is offered generally, per-language streaming support should be confirmed. TTS: uz-UZ voices nigora (v1/v3), zamira (neutral/strict/friendly), yulduz (plus whisper). Russian is excellent. | Needs a Yandex Cloud API key and folder ID. Gives low latency in the CIS region. |
| OpenAI Realtime | GPT-Realtime-2.1 and 2.1 mini (July 2026). | No published Uzbek evaluation; long-tail languages vary in quality. Needs an OpenAI key. |
| ElevenLabs | TTS: Eleven v3 and v4/v4 Turbo support Uzbek; Flash v2.5 does not, so the lowest-latency model is out. STT: Scribe lists Uzbek. | Needs an ElevenLabs key. |

## 4. Recommendation and latency
| Option | Pipeline | Expected latency | New credentials |
|---|---|---|---|
| Primary | Gemini Live `gemini-3.8-live` through the Node relay | About 1.2 s time to first audio (reported 1.18 s), plus about 80 to 150 ms RTT from Tashkent to Google's European region, so about 1.3 to 1.6 s after the user stops speaking. Server VAD `silenceDurationMs` 500 to 800 ms. | None |
| Fallback 1 | `gemini-3.5-transcribe-live` (streaming, uz-UZ/ru-RU, interim results) → `gemini-3.8-flash` (function calling, streamed text) → `gemini-3.8-flash-tts` (stream:true), split per sentence | About 2 to 3.5 s | None |
| Fallback 2 | Yandex SpeechKit for Uzbek and Russian speech in and out, with the Gemini text model kept as the brain | — | Yandex key, only if Gemini's Uzbek voice is poor |

- For fallback 1, start TTS on the first sentence of the model's reply rather than waiting for the whole answer.
- In every case, keep text transcripts so the UI can show what was heard and the worker can confirm before anything is written (for example, a material expense).

## 5. Browser and WebView audio
**Capture**
- Call `getUserMedia({audio:{channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true}})`.
- An `AudioWorkletProcessor` collects Float32 frames, downsamples from the device rate (usually 48 kHz) to 16 kHz, and converts to Int16.
- Send binary frames of about 40 to 100 ms (640 to 1600 samples) over the WebSocket. Use binary on the relay and base64 only to Gemini.
- `new AudioContext({sampleRate:16000})` also works in Chrome and Android WebView and saves the manual resampling.

**Playback**
- Use one `AudioContext({sampleRate:24000})` and an AudioWorklet with a ring buffer (Int16 → Float32).
- Pre-buffer about 100 to 200 ms to avoid underruns, and clear the buffer on `interrupted`.
- The simpler alternative is chained `AudioBufferSourceNode`s scheduled at `nextStartTime = max(ctx.currentTime, nextStartTime) + dur`. It is fine, but it clicks more under jitter and is harder to flush.

**WebSocket or WebRTC**
- Gemini Live is WebSocket only.
- WebRTC (better jitter handling and echo cancellation on poor 3G/4G) would need LiveKit Agents (`@livekit/agents-plugin-google` supports gemini-3.8-live) or Pipecat. That is another service to run and pay for.
- For a first version, PCM16 over WSS is enough.

**Tauri / Android WebView**
- The repo has `frontend/src-tauri/gen`, so the Android app is a Tauri WebView.
- It needs the RECORD_AUDIO permission, and the WebView must grant `onPermissionRequest` for the mic.
- Both iOS WKWebView and Android need a user gesture before `AudioContext.resume()`.

**UX on noisy sites**
- Construction sites are loud and VAD will trigger on noise. Offer push-to-talk: turn off automatic activity detection and send `activityStart`/`activityEnd`, or use hybrid VAD with `audioStreamEnd`.

**Risks**
- Uzbek output quality from native-audio Live is not proven. Google has no Uzbek benchmark, and third-party reviews say English-first. The voice may drift into Turkish- or Russian-accented speech, or switch to Russian. You cannot force a languageCode on native audio models, so you depend on the system prompt. Run a 1-day test with real workers before committing.
- Model names change quickly. gemini-3.8-live and gemini-3.8-flash-tts came from the docs fetched on 2026-10-12. The 2.5 models are now limited to projects that already had access, so pin model IDs in config, not in code.
- The project uses the deprecated @google/generative-ai 0.24.1, which has no Live API. You need to add @google/genai 2.x, which requires Node >= 20. Check the Render Node version.
- Session limits: audio sessions stop at 15 minutes without compression and the WebSocket lasts about 10 minutes. You must handle GoAway, sessionResumption handles (valid 2 hours) and contextWindowCompression, or long calls will drop.
- Ephemeral tokens work only on v1beta for the Live API. If you connect the browser directly, tool calls run on the client and must be forwarded to the backend with tenant auth. A relay is safer for the ERP.
- Network latency: there is no Google region in Uzbekistan, so expect 80-150+ ms RTT plus mobile jitter. A WebSocket without WebRTC jitter buffering can stutter on poor 3G/4G, so pre-buffer 100-200 ms of playback.
- Construction-site noise will cause false VAD triggers and barge-ins. Push-to-talk or tuned VAD sensitivity is recommended.
- Echo: with speakerphone playback through Web Audio, Chrome/WebView echo cancellation is usually fine, but some Android devices leak the model's voice back into the mic and it interrupts itself. Test on the target phones.
- Gemini API free-tier and rate limits on concurrent Live sessions for each key. Several workers talking at once may hit per-key limits, so key rotation or a paid tier is needed.
- The Gemini TTS price doubles after 2026-12-31 (3.8 Flash TTS audio out goes from $9 to $18 per 1M tokens).
- Yandex SpeechKit STT for uz-UZ is confirmed on the general model, but per-language streaming support was not confirmed in the docs. Verify it before relying on it as a fallback.

**Needs owner credentials**
- None for the primary pipeline and fallback 1. They use the existing GEMINI_API_KEYS (Gemini Developer API). A paid tier is probably needed so several workers can hold Live sessions at once.
- Optional, only if Gemini's Uzbek voice quality is poor: a Yandex Cloud SpeechKit API key and folder ID.
- Optional, only for Google Cloud STT Chirp 3 uz-UZ: a GCP project with the Speech-to-Text API enabled and a service account JSON. Not needed if gemini-3.5-transcribe-live is enough.
- Optional, only if WebRTC transport is wanted: LiveKit Cloud API key and secret (or a self-hosted LiveKit server).
- Optional and not recommended: an OpenAI API key (Realtime) or an ElevenLabs API key.

**Sources**
- https://ai.google.dev/gemini-api/docs/live
- https://ai.google.dev/gemini-api/docs/live-api/capabilities
- https://ai.google.dev/gemini-api/docs/live-api/tools
- https://ai.google.dev/gemini-api/docs/live-api/session-management
- https://ai.google.dev/gemini-api/docs/ephemeral-tokens
- https://ai.google.dev/gemini-api/docs/live-api/live-translate
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/speech-generation
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe
- https://github.com/google-gemini/gemini-skills/blob/main/skills/gemini-live-api-dev/SKILL.md
- https://github.com/google-gemini/gemini-live-api-examples
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-live
- https://www.techrepublic.com/article/news-gemini-3-8-live-models/
- https://tech-insider.org/gemini-3-8-live-extended-thinking-launch-2026/
- https://foundrysoft.co/blog/gemini-3-8-live-voice-agent-latency-pricing
- https://dev.to/googleai/build-real-time-voice-applications-with-gemini-38-live-and-35-transcribe-4nb5
- https://docs.cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages
- https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types
- https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd
- https://aistudio.yandex.ru/docs/en/speechkit/tts/voices.html
- https://aistudio.yandex.ru/docs/en/speechkit/stt/models.html
- https://openai.com/index/introducing-gpt-realtime/
- https://inworld.ai/resources/openai-realtime-api-alternatives
- https://elevenlabs.io/docs/overview/models
- https://elevenlabs.io/speech-to-text/uzbek
- https://www.npmjs.com/package/@livekit/agents-plugin-google
- https://www.npmjs.com/package/@google/genai
