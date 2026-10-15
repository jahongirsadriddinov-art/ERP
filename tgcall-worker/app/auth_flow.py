"""Telegram'ga kirish: telefon → kod → (2FA parol). Dasturchi paneli → backend → shu RPC'lar.

Kutilayotgan holat FAQAT shu jarayon xotirasida, backend bergan loginAttemptId bo'yicha (review B8).
Telefon, kod va parol HECH QACHON log qilinmaydi, diskka yozilmaydi va javobga qo'shilmaydi.
Muvaffaqiyatda tayyor StringSession on_success'ga beriladi (u shifrlab saqlaydi) — backendga emas.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from .errors import RpcError, map_auth_error

log = logging.getLogger("tgw.auth")

ATTEMPT_TTL_S = 15 * 60
_ATTEMPT_RE = re.compile(r"^[0-9a-f-]{36}$")
_PHONE_RE = re.compile(r"^\+?[1-9]\d{8,14}$")


def mask_phone(phone: str) -> str:
    d = re.sub(r"[^\d+]", "", phone or "")
    if len(d) < 7:
        return "***"
    return d[:5] + "*" * max(3, len(d) - 7) + d[-2:]


@dataclass
class Pending:
    attempt_id: str
    client: Any
    phone: str
    phone_code_hash: str
    created: float
    stage: str = "awaiting_code"


class LoginFlow:
    def __init__(
        self,
        make_client: Callable[[], Any],
        on_success: Callable[[str], Awaitable[None]],
        can_login: Callable[[], bool],
        clock: Callable[[], float] = time.monotonic,
    ):
        self._make_client = make_client
        self._on_success = on_success
        self._can_login = can_login
        self._clock = clock
        self._pending: Optional[Pending] = None

    async def _drop(self) -> None:
        p, self._pending = self._pending, None
        if p is not None:
            try:
                await p.client.disconnect()
            except Exception:
                pass

    def _get(self, attempt_id: Any) -> Pending:
        p = self._pending
        if (
            p is None
            or not isinstance(attempt_id, str)
            or p.attempt_id != attempt_id
            or self._clock() - p.created > ATTEMPT_TTL_S
        ):
            raise RpcError("attempt_expired", "Kirish muddati tugadi — qaytadan boshlang")
        return p

    def _require_lease(self) -> None:
        if not self._can_login():
            raise RpcError("not_leased", "Worker hali lease olmagan")

    async def _success(self, p: Pending) -> dict:
        me = await p.client.get_me()
        session = p.client.session.save()
        self._pending = None
        try:
            await p.client.disconnect()
        except Exception:
            pass
        await self._on_success(session)
        log.info("Telegram'ga kirildi")
        name = " ".join(x for x in [getattr(me, "first_name", None), getattr(me, "last_name", None)] if x)
        out = {"status": "connected", "tgUserId": str(getattr(me, "id", "") or "")}
        if getattr(me, "username", None):
            out["username"] = me.username
        if name:
            out["displayName"] = name[:64]
        return out

    async def start(self, params: dict) -> dict:
        self._require_lease()
        attempt_id = params.get("loginAttemptId")
        phone = re.sub(r"[\s()-]", "", str(params.get("phone") or ""))
        if not isinstance(attempt_id, str) or not _ATTEMPT_RE.match(attempt_id):
            raise RpcError("bad_request")
        if not _PHONE_RE.match(phone):
            raise RpcError("phone_invalid")
        await self._drop()
        client = self._make_client()
        try:
            await client.connect()
            sent = await client.send_code_request(phone)
        except Exception as e:
            try:
                await client.disconnect()
            except Exception:
                pass
            raise map_auth_error(e)
        self._pending = Pending(attempt_id, client, phone, getattr(sent, "phone_code_hash", ""), self._clock())
        log.info("kirish kodi so'raldi")
        return {"status": "awaiting_code", "phoneMasked": mask_phone(phone)}

    async def code(self, params: dict) -> dict:
        self._require_lease()
        p = self._get(params.get("loginAttemptId"))
        code = re.sub(r"\D", "", str(params.get("code") or ""))
        if not 4 <= len(code) <= 8:
            raise RpcError("code_invalid")
        try:
            await p.client.sign_in(phone=p.phone, code=code, phone_code_hash=p.phone_code_hash)
        except Exception as e:
            err = map_auth_error(e)
            if err.code == "password_required":
                p.stage = "awaiting_password"
                return {"status": "awaiting_password"}
            if err.code in ("code_expired", "phone_banned"):
                await self._drop()
            raise err
        return await self._success(p)

    async def password(self, params: dict) -> dict:
        self._require_lease()
        p = self._get(params.get("loginAttemptId"))
        if p.stage != "awaiting_password":
            raise RpcError("bad_request")
        pw = params.get("password")
        if not isinstance(pw, str) or not pw or len(pw) > 256:
            raise RpcError("password_invalid")
        try:
            await p.client.sign_in(password=pw)
        except Exception as e:
            raise map_auth_error(e)
        finally:
            pw = None  # noqa: F841 — havolani tezroq tashlash
        return await self._success(p)

    async def cancel(self) -> None:
        await self._drop()
