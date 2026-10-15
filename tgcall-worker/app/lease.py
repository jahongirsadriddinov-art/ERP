"""Fencing lease (review A4) — bitta Telegram sessiyasi hech qachon ikki jarayonda ishlamasligi uchun.

Qoidalar:
  • Telethon FAQAT lease bo'lganda ishga tushadi (on_acquired);
  • yangilash muvaffaqiyatsiz bo'lsa yoki socket 20 s'dan ko'p uzilib qolsa — darhol on_lost
    (Telethon uziladi, sessiya xotiradan tashlanadi);
  • mahalliy himoya: oxirgi muvaffaqiyatli yangilashdan 28 s o'tsa (TTL 30 s) — ham on_lost;
  • backend lease.revoked yuborsa (deploy/SIGTERM) — Telethon uziladi, keyin lease O'ZIMIZ bo'shatamiz
    (qayta ulanganda), shunda yangi instansiya darhol ola oladi.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable, Optional

log = logging.getLogger("tgw.lease")

CallFn = Callable[[str, dict], Awaitable[Optional[dict]]]

EV_ACQUIRE = "worker:lease.acquire"
EV_RENEW = "worker:lease.renew"
EV_RELEASE = "worker:lease.release"

LEASE_TTL_S = 30.0
SAFETY_S = 2.0
DISCONNECT_GRACE_S = 20.0


class LeaseManager:
    def __init__(
        self,
        call: CallFn,
        on_acquired: Callable[[], Awaitable[Any]],
        on_lost: Callable[[str], Awaitable[Any]],
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
        disconnect_grace_s: float = DISCONNECT_GRACE_S,
    ):
        self._call = call
        self._on_acquired = on_acquired
        self._on_lost = on_lost
        self._clock = clock
        self._sleep = sleep
        self._grace = disconnect_grace_s
        self.lease_id: Optional[str] = None
        self.renew_every_s = 10.0
        self.local_expiry = 0.0
        self.last_renew_at = 0.0
        self.next_acquire_after = 5.0
        self._next_acquire_at = 0.0
        self.pending_release: Optional[str] = None
        self.socket_up = False
        self.authed = False
        self.down_since: Optional[float] = None
        self._lock = asyncio.Lock()
        self._start_task: Optional[asyncio.Future] = None
        self._stopped = False

    @property
    def holding(self) -> bool:
        return self.lease_id is not None

    # ── socket holati ──
    def on_socket_up(self) -> None:
        self.socket_up = True
        self.down_since = None

    def on_socket_down(self) -> None:
        self.socket_up = False
        self.authed = False
        if self.down_since is None:
            self.down_since = self._clock()

    async def on_authenticated(self) -> None:
        """Har muvaffaqiyatli autentifikatsiyadan keyin (shu jumladan qayta ulanishda)."""
        self.authed = True
        self.on_socket_up()
        async with self._lock:
            if self.pending_release:
                r = await self._safe_call(EV_RELEASE, {"leaseId": self.pending_release})
                if r is not None:
                    self.pending_release = None
            if self.lease_id:
                ok = await self._renew_locked()
                if ok:
                    return
            await self._acquire_locked()

    async def on_revoked(self, lease_id: Any) -> None:
        if not self.lease_id or (isinstance(lease_id, str) and lease_id and lease_id != self.lease_id):
            return
        lid = self.lease_id
        await self._lose("revoked")
        self.pending_release = lid
        # Socket hali ochiq bo'lsa — darhol bo'shatamiz
        if self.socket_up and self.authed:
            r = await self._safe_call(EV_RELEASE, {"leaseId": lid})
            if r is not None:
                self.pending_release = None

    async def release(self) -> None:
        """To'xtatish (Ctrl+C): Telethon uzilgandan keyin chaqiriladi."""
        lid = self.lease_id
        await self._lose("shutdown")
        if lid and self.socket_up:
            await self._safe_call(EV_RELEASE, {"leaseId": lid})

    # ── ichki ──
    async def _safe_call(self, ev: str, data: dict) -> Optional[dict]:
        try:
            r = await self._call(ev, data)
            return r if isinstance(r, dict) else None
        except Exception as e:  # timeout / uzilish
            log.debug("lease %s: %s", ev, type(e).__name__)
            return None

    async def _acquire_locked(self) -> bool:
        if self.lease_id:
            return True
        t_sent = self._clock()
        r = await self._safe_call(EV_ACQUIRE, {})
        if r and r.get("ok") and isinstance(r.get("leaseId"), str):
            self.lease_id = r["leaseId"]
            self.renew_every_s = max(1.0, min(15.0, float(r.get("renewEveryMs") or 10_000) / 1000))
            self.local_expiry = t_sent + LEASE_TTL_S - SAFETY_S
            self.last_renew_at = t_sent
            log.info("lease olindi")
            # Telethon ulanishi sekin bo'lishi mumkin — yangilashlarni to'smaslik uchun alohida vazifa
            self._start_task = asyncio.ensure_future(self._run_acquired())
            return True
        self.next_acquire_after = (float((r or {}).get("retryAfterMs") or 5_000)) / 1000
        self._next_acquire_at = self._clock() + min(60.0, max(1.0, self.next_acquire_after))
        if r and r.get("reason") == "held":
            log.info("lease boshqa worker'da — %.0f s kutiladi", self.next_acquire_after)
        return False

    async def _run_acquired(self) -> None:
        try:
            await self._on_acquired()
        except Exception as e:
            log.error("Telegram ishga tushmadi: %s", type(e).__name__)

    async def _renew_locked(self) -> bool:
        lid = self.lease_id
        if not lid:
            return False
        t_sent = self._clock()
        r = await self._safe_call(EV_RENEW, {"leaseId": lid})
        if r and r.get("ok"):
            self.local_expiry = t_sent + LEASE_TTL_S - SAFETY_S
            self.last_renew_at = t_sent
            return True
        await self._lose("renew_failed")
        return False

    async def _lose(self, reason: str) -> None:
        if not self.lease_id:
            return
        self.lease_id = None
        log.warning("lease yo'qotildi (%s) — Telegram uziladi", reason)
        try:
            await self._on_lost(reason)
        except Exception as e:
            log.error("Telegram uzishda xato: %s", type(e).__name__)

    async def tick(self) -> None:
        """Bir qadam (testlar shuni to'g'ridan-to'g'ri chaqiradi)."""
        now = self._clock()
        async with self._lock:
            if self.lease_id:
                if self.down_since is not None and now - self.down_since >= self._grace:
                    await self._lose("socket_down")
                elif now >= self.local_expiry:
                    await self._lose("expired")
                elif self.authed and now - self.last_renew_at >= self.renew_every_s:
                    await self._renew_locked()
            elif self.authed and now >= self._next_acquire_at:
                await self._acquire_locked()

    async def run(self) -> None:
        self._stopped = False
        while not self._stopped:
            try:
                await self.tick()
            except Exception as e:  # pragma: no cover
                log.error("lease sikli: %s", type(e).__name__)
            await self._sleep(0.5)

    def stop(self) -> None:
        self._stopped = True
