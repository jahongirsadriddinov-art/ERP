"""Worker holati (contracts.ts WorkerStatus) va har 30 s 'health' voqeasi."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable, Optional

from . import __version__

log = logging.getLogger("tgw.health")
HEALTH_EVERY_S = 30.0


def build_status(runtime: Any, calls: Any, udp_ok: Optional[bool]) -> dict:
    st: dict = {
        "version": __version__,
        "connected": bool(getattr(runtime, "ready", False)),
        "activeCalls": int(getattr(calls, "active_count", 0) or 0),
        "openConversation": bool(getattr(calls, "open_incoming", False)),
    }
    if st["connected"]:
        if getattr(runtime, "me_id", None):
            st["tgUserId"] = str(runtime.me_id)
        if getattr(runtime, "username", None):
            st["username"] = runtime.username
    if udp_ok is not None:
        st["udpOk"] = bool(udp_ok)
    fw = float(getattr(calls, "flood_wait_until_ms", 0) or 0)
    if fw > time.time() * 1000:
        st["floodWaitUntil"] = int(fw)
    return st


async def health_loop(
    status: Callable[[], dict],
    emit: Callable[[dict], Awaitable[Any]],
    can_send: Callable[[], bool],
    every_s: float = HEALTH_EVERY_S,
) -> None:
    while True:
        if can_send():
            try:
                await emit({"type": "health", "status": status(), "at": int(time.time() * 1000)})
            except Exception as e:
                log.debug("health: %s", type(e).__name__)
        await asyncio.sleep(every_s)
