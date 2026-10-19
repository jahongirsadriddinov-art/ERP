"""Peer aniqlash (owner 2026-10-16): xodim Telegram id'si ERP bot'dan ma'lum, lekin worker'da access_hash yo'q bo'lishi mumkin.

Tartib: kesh → dialoglar (cheklangan tezlikda yangilanadi) → @username → bitta contacts.importContacts (telefon
FAQAT shu qo'ng'iroq/so'rov uchun backend'dan keladi, saqlanmaydi, log qilinmaydi). Import natijasi faqat qaytgan
user id kutilgan id'ga TENG bo'lsa qabul qilinadi; avval kontakt bo'lmagan import qilingan foydalanuvchilar darhol
o'chiriladi (Telethon entity keshida access_hash qoladi). Import chegarasi — xotirada, soatiga 5 ta.
Log'larda faqat maskalangan id.
"""
from __future__ import annotations

import logging
import time
from collections import deque
from typing import Any, Callable, Optional, Protocol

log = logging.getLogger("tgw.peers")

IMPORT_MAX_PER_HOUR = 5
IMPORT_WINDOW_S = 3600.0
DIALOG_REFRESH_S = 300.0


def mask_id(uid: Any) -> str:
    s = str(uid or "")
    return f"…{s[-4:]}" if len(s) > 4 else "…"


class PeerOps(Protocol):
    """Telegram amallari (tg.py amalga oshiradi; testlar soxtasini beradi)."""
    async def has_peer(self, user_id: int) -> bool: ...
    async def refresh_dialogs(self) -> None: ...
    async def username_id(self, username: str) -> Optional[int]: ...
    async def contact_ids(self) -> set[int]: ...
    async def import_phone(self, phone: str) -> list[int]: ...
    async def delete_contacts(self, user_ids: list[int]) -> None: ...


class ImportLimiter:
    """Sirpanuvchi oyna: soatiga ko'pi bilan N ta import (faqat xotirada)."""

    def __init__(self, max_per_window: int = IMPORT_MAX_PER_HOUR, window_s: float = IMPORT_WINDOW_S,
                 clock: Callable[[], float] = time.monotonic):
        self.max = max_per_window
        self.window = window_s
        self.clock = clock
        self._hits: deque[float] = deque()

    def _trim(self) -> None:
        now = self.clock()
        while self._hits and now - self._hits[0] >= self.window:
            self._hits.popleft()

    def allowed(self) -> bool:
        self._trim()
        return len(self._hits) < self.max

    def take(self) -> bool:
        if not self.allowed():
            return False
        self._hits.append(self.clock())
        return True

    @property
    def used(self) -> int:
        self._trim()
        return len(self._hits)


def _clean_username(u: Any) -> Optional[str]:
    s = str(u or "").strip().lstrip("@")
    return s if 4 <= len(s) <= 32 and s.replace("_", "").isalnum() else None


def _clean_phone(p: Any) -> Optional[str]:
    s = "".join(ch for ch in str(p or "") if ch.isdigit() or ch == "+")
    digits = s.lstrip("+")
    return s if digits.isdigit() and 9 <= len(digits) <= 15 else None


class PeerResolver:
    def __init__(self, ops: PeerOps, limiter: Optional[ImportLimiter] = None,
                 clock: Callable[[], float] = time.monotonic, dialog_refresh_s: float = DIALOG_REFRESH_S):
        self.ops = ops
        self.limiter = limiter or ImportLimiter(clock=clock)
        self.clock = clock
        self.dialog_refresh_s = dialog_refresh_s
        self._dialogs_at: Optional[float] = None

    async def _known(self, uid: int) -> bool:
        try:
            return await self.ops.has_peer(uid)
        except Exception:
            return False

    async def resolve(self, expected: int, username: Any = None, phone: Any = None) -> str:
        """'resolved' | 'not_found' | 'mismatch' | 'import_limited'. Telegram xatolari (flood/privacy) yuqoriga."""
        if expected <= 0:
            return "not_found"
        # 1) kesh
        if await self._known(expected):
            return "resolved"
        # 2) dialoglar (xodim akkauntga yozgan/qo'ng'iroq qilgan bo'lsa) — tez-tez emas
        now = self.clock()
        if self._dialogs_at is None or now - self._dialogs_at >= self.dialog_refresh_s:
            self._dialogs_at = now
            try:
                await self.ops.refresh_dialogs()
            except Exception as e:
                log.debug("dialoglar: %s", type(e).__name__)
            if await self._known(expected):
                return "resolved"
        # 3) @username
        result = "not_found"
        un = _clean_username(username)
        if un:
            try:
                got = await self.ops.username_id(un)
            except (ValueError, TypeError):
                got = None
            if got == expected:
                return "resolved"
            if got:
                result = "mismatch"
        # 4) bitta import (faqat telefon berilsa)
        ph = _clean_phone(phone)
        if not ph:
            return result
        if not self.limiter.take():
            log.info("import chegarasi (soatiga %d) — %s keyinroq", self.limiter.max, mask_id(expected))
            return "import_limited"
        before = await self.ops.contact_ids()
        ids = await self.ops.import_phone(ph)
        added = [i for i in ids if i not in before]
        if added:
            try:
                await self.ops.delete_contacts(added)
            except Exception as e:
                log.debug("kontakt o'chirilmadi: %s", type(e).__name__)
        if expected in ids:
            log.info("peer telefon orqali aniqlandi: %s", mask_id(expected))
            return "resolved"
        if ids:
            log.info("telefon boshqa foydalanuvchiga tegishli — rad: kutilgan %s", mask_id(expected))
            return "mismatch"
        return "not_found" if result == "not_found" else result

    async def lookup(self, username: Any = None, phone: Any = None) -> tuple[str, Optional[int]]:
        """Mehmon sinov qo'ng'irog'i (owner 2026-10-19): kutilgan id'siz — @username yoki telefon bo'yicha id.
        ('resolved', id) | ('not_found', None) | ('import_limited', None). Import qilingan kontakt darhol o'chiriladi."""
        un = _clean_username(username)
        if un:
            try:
                got = await self.ops.username_id(un)
            except (ValueError, TypeError):
                got = None
            if got:
                return "resolved", int(got)
        ph = _clean_phone(phone)
        if not ph:
            return "not_found", None
        if not self.limiter.take():
            log.info("import chegarasi (soatiga %d) — mehmon keyinroq", self.limiter.max)
            return "import_limited", None
        before = await self.ops.contact_ids()
        ids = await self.ops.import_phone(ph)
        added = [i for i in ids if i not in before]
        if added:
            try:
                await self.ops.delete_contacts(added)
            except Exception as e:
                log.debug("kontakt o'chirilmadi: %s", type(e).__name__)
        if len(ids) == 1:
            log.info("mehmon telefon orqali aniqlandi: %s", mask_id(ids[0]))
            return "resolved", int(ids[0])
        return "not_found", None
