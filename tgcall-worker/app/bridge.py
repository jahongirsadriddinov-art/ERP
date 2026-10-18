"""Backend bilan aloqa: socket.io "/aiv-worker" (FAQAT websocket, faqat CHIQUVCHI ulanish — NAT ortida ishlaydi).

Oqim: ulanish (auth: workerId, version) → server 'worker:challenge' {nonce} → Ed25519 imzo →
'worker:auth' (ack) → lease (lease.py) → RPC ('worker:rpc', ack bilan javob), voqealar, binary audio.
Uzilishda qayta ulanish (eksponensial kutish, 1 → 30 s).
"""
from __future__ import annotations

import asyncio
import logging
import random
from typing import Any, Awaitable, Callable, Optional

import socketio

from . import __version__
from .keys import public_key_b64, sign_challenge

log = logging.getLogger("tgw.bridge")

NAMESPACE = "/aiv-worker"
EV = {
    "challenge": "worker:challenge",
    "auth": "worker:auth",
    "lease_revoked": "worker:lease.revoked",
    "rpc": "worker:rpc",
    "event": "worker:event",
    "audio": "worker:audio",
}


class Bridge:
    def __init__(
        self,
        url: str,
        worker_id: str,
        private_key: Any,
        on_rpc: Callable[[Any], Awaitable[dict]],
        on_audio: Callable[[bytes], None],
        on_authenticated: Callable[[], Awaitable[None]],
        on_down: Callable[[], None],
        on_revoked: Callable[[Any], Awaitable[None]],
        sio: Optional[Any] = None,
    ):
        self.url = url
        self.worker_id = worker_id
        self._key = private_key
        self._on_rpc = on_rpc
        self._on_audio = on_audio
        self._on_authenticated = on_authenticated
        self._on_down = on_down
        self._on_revoked = on_revoked
        self.authed = False
        self.auth_failures = 0
        self._stopping = False
        self.sio = sio or socketio.AsyncClient(
            reconnection=True, reconnection_delay=1, reconnection_delay_max=30,
            # logger=False SHART: True bo'lsa kutubxona INFO'da paket mazmunini (login RPC'dagi
            # telefon/kod/parol) chiqaradi va bizning WARNING filtrimizni chetlab o'tadi
            randomization_factor=0.5, logger=False, engineio_logger=False,
        )
        self._register()

    def _register(self) -> None:
        sio = self.sio

        @sio.on("connect", namespace=NAMESPACE)
        async def _connect():
            log.info("backendga ulandi")

        @sio.on("disconnect", namespace=NAMESPACE)
        async def _disconnect(*_args):
            self.authed = False
            log.warning("backend aloqasi uzildi")
            self._on_down()

        @sio.on("connect_error", namespace=NAMESPACE)
        async def _connect_error(data=None):
            msg = data.get("message") if isinstance(data, dict) else str(data or "")
            if msg in ("not_configured", "bad_handshake", "websocket_only"):
                log.error("backend ulanishni rad etdi: %s (Render'da AIV_WORKER_PUBKEY va AI_VOICE_ENABLED ni tekshiring)", msg)

        @sio.on(EV["challenge"], namespace=NAMESPACE)
        async def _challenge(ch):
            asyncio.ensure_future(self._authenticate(ch))

        @sio.on(EV["rpc"], namespace=NAMESPACE)
        async def _rpc(req):
            if not self.authed:
                rid = req.get("requestId", "") if isinstance(req, dict) else ""
                return {"requestId": rid, "ok": False, "error": {"code": "unauthenticated", "message": "unauthenticated"}}
            return await self._on_rpc(req)

        @sio.on(EV["audio"], namespace=NAMESPACE)
        async def _audio(data):
            if self.authed and isinstance(data, (bytes, bytearray)):
                self._on_audio(bytes(data))

        @sio.on(EV["lease_revoked"], namespace=NAMESPACE)
        async def _revoked(data):
            lease_id = data.get("leaseId") if isinstance(data, dict) else None
            await self._on_revoked(lease_id)

    async def _authenticate(self, ch: Any) -> None:
        nonce = ch.get("nonce") if isinstance(ch, dict) else None
        if not isinstance(nonce, str) or not nonce:
            return
        sig = sign_challenge(self._key, self.worker_id, nonce)
        try:
            ack = await self.sio.call(EV["auth"], {"workerId": self.worker_id, "nonce": nonce, "signature": sig},
                                      namespace=NAMESPACE, timeout=15)
        except Exception as e:
            log.warning("autentifikatsiya javobi kelmadi: %s", type(e).__name__)
            return
        if isinstance(ack, dict) and ack.get("ok"):
            self.authed = True
            self.auth_failures = 0
            log.info("autentifikatsiya o'tdi")
            try:
                await self._on_authenticated()
            except Exception as e:
                log.error("lease xatosi: %s", type(e).__name__)
        else:
            self.auth_failures += 1
            err = ack.get("error") if isinstance(ack, dict) else "no_ack"
            hint = ack.get("keyHint") if isinstance(ack, dict) else None
            if hint:
                log.error("autentifikatsiya rad etildi: %s — Render'dagi AIV_WORKER_PUBKEY '%s…' bilan boshlanadi, bu workerniki esa '%s…'",
                          err, hint, public_key_b64(self._key)[:12])
            else:
                log.error("autentifikatsiya rad etildi: %s — Render'dagi AIV_WORKER_PUBKEY shu worker kalitiga mosmi?", err)

    # ── backendga yuborish ──
    async def call(self, event: str, data: dict, timeout: float = 10) -> Optional[dict]:
        if not self.sio.connected:
            return None
        r = await self.sio.call(event, data, namespace=NAMESPACE, timeout=timeout)
        return r if isinstance(r, dict) else None

    async def emit_event(self, ev: dict) -> None:
        if self.authed and self.sio.connected:
            await self.sio.emit(EV["event"], ev, namespace=NAMESPACE)

    async def send_audio(self, frame: bytes) -> None:
        if self.authed and self.sio.connected:
            await self.sio.emit(EV["audio"], frame, namespace=NAMESPACE)

    # ── hayot sikli ──
    async def run(self) -> None:
        delay = 1.0
        while not self._stopping:
            try:
                await self.sio.connect(
                    self.url, namespaces=[NAMESPACE], transports=["websocket"],
                    auth={"workerId": self.worker_id, "version": __version__}, wait_timeout=20,
                )
                delay = 1.0
                await self.sio.wait()   # ichki qayta ulanish tugaguncha (yoki disconnect())
            except Exception as e:
                # Xato matni (ulanish rad etildi, DNS, TLS) — paket mazmuni emas, xavfsiz
                log.warning("backendga ulanib bo'lmadi (%s: %s) — %.0f s'dan keyin qayta", type(e).__name__, str(e)[:160], delay)
            if self._stopping:
                break
            await asyncio.sleep(delay + random.random())
            delay = min(30.0, delay * 2)

    async def stop(self) -> None:
        self._stopping = True
        try:
            await self.sio.disconnect()
        except Exception:
            pass
