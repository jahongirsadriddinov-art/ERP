import asyncio

from app.errors import RpcError, discard_reason_name, flood_seconds, map_auth_error, map_call_error


def mk(name, **attrs):
    cls = type(name, (Exception,), {})
    e = cls("matnda +998901234567 va 12345 bo'lishi mumkin")
    for k, v in attrs.items():
        setattr(e, k, v)
    return e


def test_call_errors():
    assert map_call_error(mk("CallBusy")) == "busy"
    assert map_call_error(mk("TimedOutAnswer")) == "timeout"
    assert map_call_error(asyncio.TimeoutError()) == "timeout"
    assert map_call_error(mk("CallDeclined")) == "declined"
    assert map_call_error(mk("CallDeclined"), "missed") == "timeout"
    assert map_call_error(mk("CallDeclined"), "busy") == "busy"
    assert map_call_error(mk("CallDeclined"), "disconnect") == "network"
    assert map_call_error(mk("CallDiscarded")) == "declined"
    assert map_call_error(mk("UserPrivacyRestrictedError")) == "privacy"
    assert map_call_error(mk("UserIsBlockedError")) == "blocked"
    assert map_call_error(mk("ParticipantVersionOutdatedError")) == "outdated"
    assert map_call_error(mk("TelegramServerError")) == "network"
    assert map_call_error(mk("FloodWaitError", seconds=42)) == "flood_wait"
    assert map_call_error(mk("Weird")) == "error"


def test_subclass_names_are_matched():
    base = type("CallBusy", (Exception,), {})
    sub = type("SomethingElse", (base,), {})
    assert map_call_error(sub()) == "busy"


def test_flood_seconds():
    assert flood_seconds(mk("FloodWaitError", seconds=42)) == 42
    assert flood_seconds(mk("FloodWaitError")) == 60
    assert flood_seconds(mk("Other")) is None


def test_auth_errors_never_leak_text():
    cases = {
        "PhoneNumberInvalidError": "phone_invalid",
        "PhoneNumberBannedError": "phone_banned",
        "PhoneCodeInvalidError": "code_invalid",
        "PhoneCodeExpiredError": "code_expired",
        "PasswordHashInvalidError": "password_invalid",
        "SessionPasswordNeededError": "password_required",
        "Mystery": "error",
    }
    for name, code in cases.items():
        r = map_auth_error(mk(name))
        assert isinstance(r, RpcError) and r.code == code
        assert "998901234567" not in r.message and "12345" not in r.message
    fw = map_auth_error(mk("FloodWaitError", seconds=300))
    assert fw.code == "flood_wait" and fw.retry_after_sec == 300


def test_discard_reason_names():
    assert discard_reason_name(type("PhoneCallDiscardReasonMissed", (), {})()) == "missed"
    assert discard_reason_name(type("PhoneCallDiscardReasonBusy", (), {})()) == "busy"
    assert discard_reason_name(None) is None
    assert discard_reason_name(object()) == "other"
