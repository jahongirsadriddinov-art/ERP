"""Xatolarni backend kodlariga xaritalash (contracts.ts WorkerCallEndReason / RPC xato kodlari).

Sinf NOMI bo'yicha ishlaydi — testlar pytgcalls/telethon'ni import qilmasdan tekshira oladi.
Xato matnlari (ularda telefon/kod bo'lishi mumkin) HECH QACHON tashqariga chiqmaydi — faqat kod.
"""
from __future__ import annotations

import asyncio
from typing import Optional


class RpcError(Exception):
    def __init__(self, code: str, message: str = "", retry_after_sec: Optional[int] = None):
        super().__init__(code)
        self.code = code
        self.message = message or code
        self.retry_after_sec = retry_after_sec


def _names(exc: BaseException) -> set[str]:
    return {c.__name__ for c in type(exc).__mro__}


def flood_seconds(exc: BaseException) -> Optional[int]:
    if _names(exc) & {"FloodWaitError", "FloodPremiumWaitError", "FloodError", "SlowModeWaitError"}:
        try:
            s = int(getattr(exc, "seconds", 0) or 0)
        except (TypeError, ValueError):
            s = 0
        return max(1, s) if s else 60
    return None


# Telethon raw "PhoneCallDiscardReason*" → qisqa nom
DISCARD_REASONS = {
    "PhoneCallDiscardReasonMissed": "missed",
    "PhoneCallDiscardReasonBusy": "busy",
    "PhoneCallDiscardReasonHangup": "hangup",
    "PhoneCallDiscardReasonDisconnect": "disconnect",
}


def discard_reason_name(reason_obj) -> Optional[str]:
    if reason_obj is None:
        return None
    return DISCARD_REASONS.get(type(reason_obj).__name__, "other")


def map_call_error(exc: BaseException, discard_reason: Optional[str] = None) -> str:
    """Qo'ng'iroq (play) xatosi → WorkerCallEndReason."""
    n = _names(exc)
    if flood_seconds(exc) is not None:
        return "flood_wait"
    if "CallBusy" in n or discard_reason == "busy":
        return "busy"
    if "TimedOutAnswer" in n or isinstance(exc, asyncio.TimeoutError):
        return "timeout"
    if "CallDeclined" in n or "CallDiscarded" in n:
        # pytgcalls "missed" va "declined"ni ajratmaydi — raw sababga qaraymiz
        if discard_reason == "missed":
            return "timeout"
        if discard_reason == "disconnect":
            return "network"
        return "declined"
    if n & {"UserPrivacyRestrictedError", "PrivacyRestrictedError"}:
        return "privacy"
    if n & {"UserIsBlockedError", "InputUserDeactivatedError", "UserDeactivatedError", "UserBlockedError"}:
        return "blocked"
    if n & {"ParticipantVersionOutdatedError", "CallProtocolFlagsInvalidError", "CallProtocolLayerInvalidError"}:
        return "outdated"
    if n & {"TelegramServerError", "ConnectionError", "ConnectionNotFound", "NotInCallError", "OSError"}:
        return "network"
    return "error"


def map_auth_error(exc: BaseException) -> RpcError:
    """Telethon login xatosi → RpcError (faqat kod; kiritilgan qiymatlar yo'q)."""
    fs = flood_seconds(exc)
    if fs is not None:
        return RpcError("flood_wait", "Telegram vaqtincha cheklov qo'ydi", fs)
    n = _names(exc)
    table = [
        ({"PhoneNumberInvalidError", "PhoneNumberUnoccupiedError"}, "phone_invalid"),
        ({"PhoneNumberBannedError", "AuthKeyUnregisteredError", "UserDeactivatedBanError"}, "phone_banned"),
        ({"PhoneCodeInvalidError", "PhoneCodeEmptyError"}, "code_invalid"),
        ({"PhoneCodeExpiredError"}, "code_expired"),
        ({"PasswordHashInvalidError"}, "password_invalid"),
        ({"SessionPasswordNeededError"}, "password_required"),
        ({"ApiIdInvalidError", "ApiIdPublishedFloodError"}, "api_id_invalid"),
        ({"ConnectionError", "OSError", "TimeoutError"}, "telegram_unavailable"),
    ]
    for names, code in table:
        if n & names:
            return RpcError(code)
    return RpcError("error", "Telegram xatosi")
