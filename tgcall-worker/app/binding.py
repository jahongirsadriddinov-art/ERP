"""Bog'lash kodlari (review A2): xodim bot ko'rsatgan bir martalik kodni (AI-4821) AI akkauntiga yozadi.

Worker kodni sha256(KATTA_HARF) bilan backend bergan xeshga va BOT BILGAN tgUserId'ga solishtiradi.
Mos kelsa — 'binding.matched' voqeasi. Boshqa barcha DM'lar e'tiborsiz (javob yo'q, AI'ga uzatilmaydi — A3).
"""
from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass
from typing import Callable, Optional

CODE_RE = re.compile(r"\bAI[\s_-]?(\d{4})\b", re.IGNORECASE)
_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_OID_RE = re.compile(r"^[0-9a-fA-F]{24}$")
MAX_ENTRIES = 2000


def code_hash(code: str) -> str:
    """Backend consentFlow.bindingCodeHash bilan bir xil."""
    return hashlib.sha256(code.strip().upper().encode("utf-8")).hexdigest()


def extract_code(text: str) -> Optional[str]:
    if not isinstance(text, str) or len(text) > 200:
        return None
    m = CODE_RE.search(text)
    return f"AI-{m.group(1)}" if m else None


@dataclass
class Expectation:
    employee_id: str
    code_hash: str
    tg_user_id: int
    expires_at_ms: float


class BindingMatcher:
    def __init__(self, now_ms: Callable[[], float] = lambda: time.time() * 1000):
        self._now = now_ms
        self._by_user: dict[int, list[Expectation]] = {}

    def expect(self, employee_id: str, code_hash_hex: str, expected_tg_user_id: str, expires_at_ms: float) -> None:
        if not _OID_RE.match(str(employee_id or "")) or not _HASH_RE.match(str(code_hash_hex or "")):
            raise ValueError("bad_params")
        uid = int(str(expected_tg_user_id))
        if uid <= 0 or float(expires_at_ms) <= self._now():
            raise ValueError("bad_params")
        self._prune()
        if sum(len(v) for v in self._by_user.values()) >= MAX_ENTRIES:
            raise ValueError("too_many")
        lst = [e for e in self._by_user.get(uid, []) if e.employee_id != employee_id]
        lst.append(Expectation(employee_id, code_hash_hex, uid, float(expires_at_ms)))
        self._by_user[uid] = lst

    def _prune(self) -> None:
        now = self._now()
        for uid in list(self._by_user):
            lst = [e for e in self._by_user[uid] if e.expires_at_ms > now]
            if lst:
                self._by_user[uid] = lst
            else:
                del self._by_user[uid]

    def pending(self) -> int:
        self._prune()
        return sum(len(v) for v in self._by_user.values())

    def match(self, sender_id: int, text: str) -> Optional[str]:
        """DM: mos kelsa employeeId (va kutish o'chiriladi), aks holda None."""
        code = extract_code(text)
        if not code:
            return None
        self._prune()
        lst = self._by_user.get(int(sender_id))
        if not lst:
            return None
        h = code_hash(code)
        for e in lst:
            if e.code_hash == h:
                lst.remove(e)
                if not lst:
                    del self._by_user[int(sender_id)]
                return e.employee_id
        return None
