"""Akkaunt "muzlatilgan"/cheklangan/bloklanganini aniqlash (anti-freeze, owner 2026-10-23).

Manbalar:
  • Telegram xatolari (sinf NOMI bo'yicha — testlar telethon'siz): FROZEN_METHOD_INVALID / FROZEN_PARTICIPANT_MISSING
    → frozen; PEER_FLOOD → spam_limited (notanishlarga yozish/qo'ng'iroq cheklangan); USER_DEACTIVATED_BAN /
    PHONE_NUMBER_BANNED → banned; AUTH_KEY_UNREGISTERED / SESSION_REVOKED → unauthorized (sessiya bekor);
  • help.getAppConfig: freeze_since_date / freeze_until_date / freeze_appeal_url (Telegram muzlatilgan akkauntga
    shu kalitlarni beradi) — ishga tushganda va har 30 daqiqada tekshiriladi.
Cheklangan akkaunt chiquvchi qo'ng'iroq/DM/import uchun ISHLATILMAYDI (accounts.py), backend boshqa akkauntga yo'naltiradi
va dasturchiga Telegram bot orqali yo'riqnoma yuboradi.
"""
from __future__ import annotations

import time
from typing import Any, Optional

FROZEN = {"FrozenMethodInvalidError", "FrozenParticipantMissingError"}
SPAM = {"PeerFloodError"}
BANNED = {"UserDeactivatedBanError", "PhoneNumberBannedError", "UserDeactivatedError"}
UNAUTH = {"AuthKeyUnregisteredError", "SessionRevokedError", "SessionExpiredError", "AuthKeyDuplicatedError"}

# Kod (RPC xabari) bo'yicha zaxira — sinf nomi noma'lum bo'lsa (masalan yangi Telegram xatosi)
_CODES = (("FROZEN_", "frozen"), ("PEER_FLOOD", "spam_limited"), ("USER_DEACTIVATED_BAN", "banned"),
          ("PHONE_NUMBER_BANNED", "banned"), ("AUTH_KEY_UNREGISTERED", "unauthorized"), ("SESSION_REVOKED", "unauthorized"))

# PEER_FLOOD muddati noma'lum — 24 soat chiquvchi ish to'xtatiladi (keyin avtomatik qayta sinaladi)
SPAM_PAUSE_S = 24 * 3600
# getAppConfig "muzlatilgan" desa, lekin tugash sanasi bo'lmasa — 24 soatdan keyin qayta tekshiriladi
FROZEN_RECHECK_S = 24 * 3600

STATES = ("ok", "frozen", "spam_limited", "banned", "unauthorized")
# Shu holatlarda akkaunt chiquvchi ish uchun ishlatilmaydi
BLOCKING = {"frozen", "spam_limited", "banned", "unauthorized"}
REASON = {"frozen": "account_frozen", "spam_limited": "spam_limited", "banned": "account_banned", "unauthorized": "account_unauthorized"}


def _names(exc: BaseException) -> set[str]:
    return {c.__name__ for c in type(exc).__mro__}


def classify(exc: BaseException) -> Optional[str]:
    """Xato → 'frozen' | 'spam_limited' | 'banned' | 'unauthorized' | None."""
    n = _names(exc)
    if n & FROZEN:
        return "frozen"
    if n & SPAM:
        return "spam_limited"
    if n & BANNED:
        return "banned"
    if n & UNAUTH:
        return "unauthorized"
    msg = str(getattr(exc, "message", "") or "").upper()
    if msg:
        for prefix, st in _CODES:
            if msg.startswith(prefix):
                return st
    return None


def json_value(v: Any) -> Any:
    """Telethon JSONValue (JsonObject/JsonArray/JsonString/...) → oddiy Python qiymati."""
    name = type(v).__name__
    if name == "JsonObject":
        return {str(getattr(x, "key", "")): json_value(getattr(x, "value", None)) for x in (getattr(v, "value", None) or [])}
    if name == "JsonArray":
        return [json_value(x) for x in (getattr(v, "value", None) or [])]
    if name in ("JsonString", "JsonNumber", "JsonBool"):
        return getattr(v, "value", None)
    if name == "JsonNull":
        return None
    if isinstance(v, (dict, list, str, int, float, bool)) or v is None:
        return v
    return None


def parse_freeze(cfg: Any) -> Optional[dict]:
    """getAppConfig lug'atidan muzlatish ma'lumoti: {'since': ms?, 'until': ms?, 'appealUrl': str?} yoki None."""
    if not isinstance(cfg, dict):
        return None
    since, until, url = cfg.get("freeze_since_date"), cfg.get("freeze_until_date"), cfg.get("freeze_appeal_url")
    if not since and not until:
        return None
    out: dict = {}
    for k, v in (("since", since), ("until", until)):
        try:
            n = int(float(v or 0))
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            out[k] = n * 1000
    if isinstance(url, str) and url.startswith(("https://", "http://", "tg://")):
        out["appealUrl"] = url[:300]
    return out


class Health:
    """Akkaunt holati. mark() — holat o'zgarganda True (backendga darhol xabar beriladi)."""

    def __init__(self, clock=lambda: time.time() * 1000):
        self.clock = clock
        self.state = "ok"
        self.reason: Optional[str] = None
        self.since: Optional[int] = None
        self.until: Optional[int] = None
        self.appeal_url: Optional[str] = None
        self.source: Optional[str] = None     # 'error' | 'app_config'
        self.at: Optional[int] = None

    def mark(self, state: str, reason: Optional[str] = None, *, since: Optional[int] = None, until: Optional[int] = None,
             appeal_url: Optional[str] = None, source: str = "error") -> bool:
        if state not in STATES:
            return False
        if state == "ok":
            return self.clear()
        before = (self.state, self.until, self.appeal_url)
        # Kuchsizroq holat kuchliroqni bosib ketmasin (banned > unauthorized > frozen > spam_limited)
        rank = {"spam_limited": 1, "frozen": 2, "unauthorized": 3, "banned": 4}
        if self.state != "ok" and self.active() and rank.get(state, 0) < rank.get(self.state, 0):
            return False
        now = int(self.clock())
        self.state = state
        self.reason = reason or REASON.get(state)
        self.source = source
        self.at = now
        self.since = since or (self.since if before[0] == state else now)
        if until is None and state in ("spam_limited", "frozen"):
            until = now + (SPAM_PAUSE_S if state == "spam_limited" else FROZEN_RECHECK_S) * 1000
        self.until = until
        if appeal_url is not None or before[0] != state:
            self.appeal_url = appeal_url
        return (self.state, self.until, self.appeal_url) != before

    def clear(self) -> bool:
        changed = self.state != "ok"
        self.state, self.reason, self.since, self.until, self.appeal_url, self.source = "ok", None, None, None, None, None
        return changed

    def active(self) -> bool:
        """Cheklov hozir amaldami (muddati o'tgan spam_limited/frozen — avtomatik tugaydi)."""
        if self.state == "ok":
            return False
        if self.until and self.until <= self.clock() and self.state in ("spam_limited", "frozen"):
            return False
        return True

    def blocked(self) -> Optional[str]:
        """Chiquvchi ish taqiqlangan bo'lsa — rad sababi kodi, aks holda None."""
        if not self.active():
            if self.state in ("spam_limited", "frozen"):
                self.clear()
            return None
        return REASON.get(self.state) if self.state in BLOCKING else None

    def to_dict(self) -> dict:
        self.blocked()
        d: dict = {"state": self.state}
        if self.state != "ok":
            for k, v in (("reason", self.reason), ("since", self.since), ("until", self.until), ("appealUrl", self.appeal_url)):
                if v:
                    d[k] = v
        return d
