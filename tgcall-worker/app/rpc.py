"""Backend → worker RPC dispetcheri (contracts.ts WorkerRpcRequest/Response).

Har so'rovda noyob requestId; javob ack orqali qaytadi. Parametrlar (telefon, kod, parol) HECH QACHON
log qilinmaydi va xato javobiga qo'shilmaydi.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Awaitable, Callable, Dict

from .errors import RpcError

log = logging.getLogger("tgw.rpc")

Handler = Callable[[Dict[str, Any]], Awaitable[Any]]
_REQ_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
_SAFE_MSG_RE = re.compile(r"[^\w\s.,:'()/-]", re.UNICODE)


def _err(request_id: str, code: str, message: str = "", retry: int | None = None) -> dict:
    e: Dict[str, Any] = {"code": code, "message": _SAFE_MSG_RE.sub("", (message or code))[:200]}
    if retry:
        e["retryAfterSec"] = int(retry)
    return {"requestId": request_id, "ok": False, "error": e}


async def dispatch(handlers: Dict[str, Handler], req: Any, now_ms: Callable[[], float] = lambda: time.time() * 1000) -> dict:
    if not isinstance(req, dict):
        return _err("", "bad_request")
    rid = req.get("requestId")
    if not isinstance(rid, str) or not _REQ_ID_RE.match(rid):
        return _err("", "bad_request")
    method = req.get("method")
    params = req.get("params") or {}
    if not isinstance(method, str) or method not in handlers or not isinstance(params, dict):
        return _err(rid, "unknown_method")
    deadline = req.get("deadlineMs")
    if isinstance(deadline, (int, float)) and deadline < now_ms() - 30_000:
        # Juda kech kelgan so'rov (soat farqiga 30 s chidam)
        return _err(rid, "deadline")
    try:
        result = await handlers[method](params)
        return {"requestId": rid, "ok": True, "result": result}
    except RpcError as e:
        return _err(rid, e.code, e.message, e.retry_after_sec)
    except Exception as e:  # tafsilot tashqariga chiqmaydi
        log.warning("RPC %s xatosi: %s", method, type(e).__name__)
        return _err(rid, "error", "ichki xato")
