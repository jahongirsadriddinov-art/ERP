"""Qo'ng'iroqlar boshqaruvi: terish, jiringlash, ulanish, audio ikki tomonga, yakunlash.

  • bir vaqtda faqat 1 ta qo'ng'iroq (review A1);
  • kiruvchi qo'ng'iroqlar avtomatik rad etiladi (A3) — tg.py'da. "Ochiq muloqot" yoqilgan bo'lsa (backend
    'incoming.config' RPC) — on_incoming(): qarorni backend beradi (bog'langan + rozilik), qabul qilinsa
    chiquvchi qo'ng'iroq bilan BIR XIL audio yo'li (_run);
  • 'ringing' — Telethon raw UpdatePhoneCall(PhoneCallWaiting.receive_date) orqali (pytgcalls bermaydi);
  • audio: Telegram 48 kHz → 16 kHz (40 ms kadrlar) → backend; backend 24 kHz → 48 kHz → 10 ms ritmli yuboruvchi;
  • maksimal davomiylik taymeri; backend hangup; worker o'chishida qo'ng'iroq yopiladi.

Engine — Telegram qatlami interfeysi (tg.py amalga oshiradi, testlar soxtasini beradi).
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional, Protocol

from . import audio as A
from .errors import RpcError, flood_seconds, map_call_error

log = logging.getLogger("tgw.calls")

MAX_CONCURRENT = 1


class Engine(Protocol):
    @property
    def ready(self) -> bool: ...
    async def has_peer(self, user_id: int) -> bool: ...
    async def play(self, user_id: int, timeout_sec: int) -> None: ...
    async def record(self, user_id: int) -> None: ...
    async def send_frame(self, user_id: int, pcm48: bytes) -> None: ...
    async def hangup(self, user_id: int) -> None: ...
    async def decline_incoming(self, user_id: int) -> None: ...


EmitFn = Callable[[dict], Awaitable[Any]]
SendUpFn = Callable[[bytes], Awaitable[Any]]
AskFn = Callable[[dict], Awaitable[Optional[dict]]]

# Kiruvchi qo'ng'iroqni qabul qilish (accept → confirm) uchun kutish chegarasi
INCOMING_ACCEPT_TIMEOUT_S = 20
_SID_HEX = set("0123456789abcdefABCDEF")


@dataclass
class ActiveCall:
    session_id: str
    user_id: int
    frame_uuid: str
    timeout_sec: int
    max_duration_sec: int
    state: str = "dialing"           # dialing | ringing | connected | ended
    ringing_sent: bool = False
    end_reason: Optional[str] = None
    discard_reason: Optional[str] = None
    finished: bool = False
    task: Optional[asyncio.Task] = None
    sender: Optional[A.PacedSender] = None
    sender_task: Optional[asyncio.Task] = None
    up_resampler: A.StreamResampler = field(default_factory=lambda: A.StreamResampler(A.TG_RATE, A.IN_RATE))
    down_resampler: A.StreamResampler = field(default_factory=lambda: A.StreamResampler(A.OUT_RATE, A.TG_RATE))
    chunker: A.Chunker = field(default_factory=lambda: A.Chunker(A.UP_CHUNK_BYTES))
    up_seq: int = 0
    incoming: bool = False           # "Ochiq muloqot": xodim o'zi qo'ng'iroq qildi
    done: asyncio.Event = field(default_factory=asyncio.Event)
    started_at: float = field(default_factory=time.monotonic)


class CallManager:
    def __init__(self, engine: Engine, emit: EmitFn, send_up: SendUpFn,
                 now_ms: Callable[[], float] = lambda: time.time() * 1000,
                 sender_factory: Optional[Callable[[Callable[[bytes], Awaitable[None]]], A.PacedSender]] = None,
                 ask_incoming: Optional[AskFn] = None):
        self.engine = engine
        self._ask_incoming = ask_incoming
        # "Ochiq muloqot" — standart O'CHIQ; faqat backend 'incoming.config' bilan yoqadi
        self.open_incoming = False
        self._incoming_pending: set[int] = set()
        self._incoming_gone: set[int] = set()
        self.incoming_accepted = 0
        self.incoming_declined = 0
        self._emit = emit
        self._send_up = send_up
        self._now_ms = now_ms
        self._sender_factory = sender_factory or (lambda send: A.PacedSender(send))
        self.active: Optional[ActiveCall] = None
        self.flood_wait_until_ms: float = 0
        self.total_calls = 0

    @property
    def active_count(self) -> int:
        return 1 if self.active and self.active.state != "ended" else 0

    async def _event(self, c: ActiveCall, state: str, reason: Optional[str] = None) -> None:
        ev: dict = {"type": "call.state", "sessionId": c.session_id, "state": state, "at": int(self._now_ms())}
        if reason:
            ev["reason"] = reason
        try:
            await self._emit(ev)
        except Exception as e:  # socket uzilgan — backend 20 s'da o'zi yopadi
            log.debug("call.state yuborilmadi: %s", type(e).__name__)

    # ── RPC: call.place ──
    async def place(self, p: dict) -> dict:
        sid = str(p.get("sessionId") or "")
        try:
            uid = int(str(p.get("tgUserId") or "0"))
            frame_uuid = A.session_frame_uuid(sid)
        except (ValueError, TypeError):
            raise RpcError("bad_request")
        if uid <= 0:
            raise RpcError("bad_request")
        timeout = int(min(90, max(15, int(p.get("timeoutSec") or 45))))
        max_dur = int(min(900, max(30, int(p.get("maxDurationSec") or 120))))
        if not self.engine.ready:
            return {"accepted": False, "reason": "not_connected"}
        if self.flood_wait_until_ms > self._now_ms():
            return {"accepted": False, "reason": "flood_wait"}
        if self.active_count >= MAX_CONCURRENT:
            return {"accepted": False, "reason": "busy_worker"}
        try:
            known = await self.engine.has_peer(uid)
        except Exception:
            known = False
        if not known:
            return {"accepted": False, "reason": "peer_unknown"}
        c = ActiveCall(session_id=sid, user_id=uid, frame_uuid=frame_uuid, timeout_sec=timeout, max_duration_sec=max_dur)
        self.active = c
        self.total_calls += 1
        c.task = asyncio.ensure_future(self._run(c))
        return {"accepted": True}

    async def _run(self, c: ActiveCall) -> None:
        await self._event(c, "dialing")
        try:
            await self.engine.play(c.user_id, c.timeout_sec)
        except asyncio.CancelledError:
            await self._finish(c, c.end_reason or "hangup")
            return
        except Exception as e:
            fs = flood_seconds(e)
            if fs:
                self.flood_wait_until_ms = self._now_ms() + fs * 1000
            reason = map_call_error(e, c.discard_reason)
            log.info("qo'ng'iroq ulanmadi: %s", reason)
            await self._finish(c, c.end_reason or reason)
            return
        if c.state == "ended" or c.end_reason:
            await self._safe_hangup(c)
            await self._finish(c, c.end_reason or "hangup")
            return
        try:
            await self.engine.record(c.user_id)
        except Exception as e:
            log.warning("record xatosi: %s", type(e).__name__)
            await self._safe_hangup(c)
            await self._finish(c, "error")
            return
        c.state = "connected"
        await self._event(c, "connected")

        async def send(pcm: bytes) -> None:
            await self.engine.send_frame(c.user_id, pcm)

        c.sender = self._sender_factory(send)
        c.sender_task = asyncio.ensure_future(c.sender.run())
        try:
            done_wait = asyncio.ensure_future(c.done.wait())
            waiters = {done_wait, c.sender_task}
            finished, _ = await asyncio.wait(waiters, timeout=c.max_duration_sec, return_when=asyncio.FIRST_COMPLETED)
            if not finished:
                c.end_reason = c.end_reason or "completed"     # maksimal davomiylik
            elif c.sender_task in finished and not c.done.is_set():
                exc = c.sender_task.exception() if not c.sender_task.cancelled() else None
                c.end_reason = c.end_reason or (map_call_error(exc, c.discard_reason) if exc else "network")
                if c.end_reason == "error":
                    c.end_reason = "network"
            done_wait.cancel()
        except asyncio.CancelledError:
            c.end_reason = c.end_reason or "error"
        await self._stop_sender(c)
        if c.end_reason not in ("completed_remote",):
            await self._safe_hangup(c)
        await self._finish(c, "completed" if c.end_reason == "completed_remote" else (c.end_reason or "completed"))

    async def _stop_sender(self, c: ActiveCall) -> None:
        if c.sender:
            c.sender.stop()
        if c.sender_task and not c.sender_task.done():
            c.sender_task.cancel()
            try:
                await c.sender_task
            except (asyncio.CancelledError, Exception):
                pass

    async def _safe_hangup(self, c: ActiveCall) -> None:
        try:
            await self.engine.hangup(c.user_id)
        except Exception as e:
            log.debug("hangup: %s", type(e).__name__)

    async def _finish(self, c: ActiveCall, reason: str) -> None:
        if c.finished:
            return
        c.finished = True
        c.state = "ended"
        c.done.set()
        if self.active is c:
            self.active = None
        await self._event(c, "ended", reason)

    # ── RPC: call.hangup ──
    async def hangup(self, p: dict) -> dict:
        sid = str(p.get("sessionId") or "")
        c = self.active
        if not c or c.session_id != sid:
            return {"ok": True}
        # Javob darhol (RPC 5 s); yopish fonda
        asyncio.ensure_future(self._end(c, "hangup"))
        return {"ok": True}

    async def _end(self, c: ActiveCall, reason: str) -> None:
        c.end_reason = c.end_reason or reason
        if c.state in ("dialing", "ringing"):
            # play() hali kutmoqda — vazifani bekor qilib, qo'ng'iroqni Telegram'da yopamiz
            if c.task and not c.task.done():
                c.task.cancel()
            await self._safe_hangup(c)
        else:
            c.done.set()
        if c.task:
            try:
                await asyncio.wait_for(asyncio.shield(c.task), timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                pass
        if not c.finished:
            await self._finish(c, c.end_reason or reason)

    async def shutdown(self, reason: str = "network") -> None:
        """Lease yo'qolganda / to'xtatishda — faol qo'ng'iroq yopiladi."""
        c = self.active
        if c:
            await self._end(c, reason)

    # ── "Ochiq muloqot": kiruvchi qo'ng'iroq (tg.py chaqiradi) ──
    async def _decline(self, user_id: int) -> None:
        self.incoming_declined += 1
        try:
            await self.engine.decline_incoming(user_id)
        except Exception as e:
            log.debug("decline: %s", type(e).__name__)

    async def on_incoming(self, user_id: int) -> str:
        """Kiruvchi qo'ng'iroq: backend qaror beradi. Natija: 'accepted' | 'declined' | 'ignored'."""
        if user_id <= 0:
            return "ignored"
        if user_id in self._incoming_pending:
            return "ignored"                    # takroriy voqea
        if not self.open_incoming or self._ask_incoming is None or not self.engine.ready:
            await self._decline(user_id)
            return "declined"
        busy = self.active_count >= MAX_CONCURRENT or bool(self._incoming_pending)
        self._incoming_pending.add(user_id)
        self._incoming_gone.discard(user_id)
        try:
            try:
                ack = await self._ask_incoming({"tgUserId": str(user_id), "workerBusy": busy, "at": int(self._now_ms())})
            except Exception as e:
                log.debug("incoming so'rovi: %s", type(e).__name__)
                ack = None
            sid = str((ack or {}).get("sessionId") or "")
            ok = bool(isinstance(ack, dict) and ack.get("accept") is True and len(sid) == 24 and set(sid) <= _SID_HEX)
            if not ok:
                log.info("kiruvchi qo'ng'iroq rad etildi (%s)", str((ack or {}).get("reason") or "no_answer")[:40])
                await self._decline(user_id)
                return "declined"
            # Qaror kutilayotganda boshqa qo'ng'iroq boshlangan yoki qo'ng'iroq qiluvchi go'shakni qo'ygan
            gone = user_id in self._incoming_gone
            if gone or self.active_count >= MAX_CONCURRENT or not self.engine.ready:
                if not gone:
                    await self._decline(user_id)
                ev = {"type": "call.state", "sessionId": sid, "state": "ended", "reason": "hangup" if gone else "busy", "at": int(self._now_ms())}
                try:
                    await self._emit(ev)
                except Exception:
                    pass
                return "declined"
            try:
                max_dur = int(min(900, max(30, int((ack or {}).get("maxDurationSec") or 300))))
            except (TypeError, ValueError):
                max_dur = 300
            c = ActiveCall(session_id=sid, user_id=user_id, frame_uuid=A.session_frame_uuid(sid),
                           timeout_sec=INCOMING_ACCEPT_TIMEOUT_S, max_duration_sec=max_dur, incoming=True)
            self.active = c
            self.total_calls += 1
            self.incoming_accepted += 1
            log.info("kiruvchi qo'ng'iroq qabul qilinmoqda")
            c.task = asyncio.ensure_future(self._run(c))
            return "accepted"
        finally:
            self._incoming_pending.discard(user_id)
            self._incoming_gone.discard(user_id)

    # ── Telegram voqealari (tg.py chaqiradi) ──
    async def on_ringing(self, user_id: int) -> None:
        c = self.active
        if c and c.user_id == user_id and c.state == "dialing" and not c.ringing_sent:
            c.ringing_sent = True
            c.state = "ringing"
            await self._event(c, "ringing")

    def on_discarded(self, user_id: int, reason: Optional[str]) -> None:
        if user_id in self._incoming_pending:
            self._incoming_gone.add(user_id)    # qaror kutilayotganda qo'ng'iroq qiluvchi go'shakni qo'ydi
        c = self.active
        if not c or c.user_id != user_id:
            return
        c.discard_reason = reason
        if c.incoming and c.state in ("dialing", "ringing") and not c.end_reason:
            # Kiruvchi: ulanishdan oldin bekor qilindi — kutmasdan yopamiz
            asyncio.ensure_future(self._end(c, "hangup"))
            return
        if c.state == "connected":
            # Suhbatdosh go'shakni qo'ydi
            c.end_reason = c.end_reason or ("network" if reason == "disconnect" else "completed_remote")
            c.done.set()

    async def on_frames(self, user_id: int, pcm48_frames: list[bytes]) -> None:
        c = self.active
        if not c or c.user_id != user_id or c.state != "connected":
            return
        for raw in pcm48_frames:
            pcm16 = c.up_resampler.process(raw)
            for chunk in c.chunker.push(pcm16):
                frame = A.encode_frame(c.frame_uuid, c.up_seq, chunk)
                c.up_seq = (c.up_seq + 1) % A.FLUSH_SEQ
                try:
                    await self._send_up(frame)
                except Exception:
                    return

    def on_backend_audio(self, buf: bytes) -> None:
        d = A.decode_frame(buf)
        c = self.active
        if not d or not c or c.sender is None:
            return
        frame_uuid, seq, pcm = d
        if frame_uuid != c.frame_uuid:
            return
        if not pcm and seq == A.FLUSH_SEQ:
            c.sender.flush()
            return
        c.sender.push(c.down_resampler.process(pcm))

