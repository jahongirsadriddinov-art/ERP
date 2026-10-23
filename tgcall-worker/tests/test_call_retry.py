"""Owner 2026-10-23: AI qo'ng'irog'ida "Ошибка соединения" — qayta urinish, aniq holatlar va tuzilgan log."""
import asyncio
import logging

from app import calls as C
from app.calls import CallManager
from app.tg import handle_phone_call_update

SID = "0123456789abcdef01234567"


class TelegramServerError(Exception):
    pass


class ConnectionError_(Exception):
    pass


class Eng:
    """play() natijalari ketma-ketligi: Exception — xato, None — muvaffaqiyat, 'accept' — avval javob berildi."""

    def __init__(self, script, cm_ref):
        self.ready = True
        self.script = list(script)
        self.cm_ref = cm_ref
        self.plays = 0
        self.hangups = []
        self.stages = {}

    async def has_peer(self, uid):
        return True

    async def play(self, uid, timeout):
        self.plays += 1
        step = self.script.pop(0) if self.script else None
        if isinstance(step, tuple) and step[0] == "accept":
            # suhbatdosh javob berdi, keyin media (p2p) ulanmadi
            await self.cm_ref[0].on_accepted(uid)
            self.stages[uid] = "p2p_connect"
            raise step[1]
        if isinstance(step, BaseException):
            self.stages[uid] = "signaling"
            raise step

    async def record(self, uid):
        pass

    async def send_frame(self, uid, pcm):
        pass

    async def hangup(self, uid):
        self.hangups.append(uid)

    async def decline_incoming(self, uid):
        pass

    def stage_of(self, uid):
        return self.stages.get(uid)

    def clear_stage(self, uid):
        self.stages.pop(uid, None)


def make(script, monkeypatch):
    monkeypatch.setattr(C, "RETRY_BACKOFF_S", (0.01, 0.01, 0.01))
    ref = [None]
    eng = Eng(script, ref)
    events = []

    async def emit(ev):
        events.append(ev)

    async def send_up(_f):
        pass

    cm = CallManager(eng, emit, send_up)
    ref[0] = cm
    return cm, eng, events


async def _until(cond, n=600):
    for _ in range(n):
        if cond():
            return True
        await asyncio.sleep(0.005)
    return False


def states(events):
    return [e["state"] for e in events]


async def test_pre_ring_transient_failure_is_redialed_and_connects(monkeypatch):
    cm, eng, events = make([TelegramServerError(), None], monkeypatch)
    r = await cm.place({"sessionId": SID, "tgUserId": "77", "timeoutSec": 30, "maxDurationSec": 60})
    assert r == {"accepted": True}
    assert await _until(lambda: "connected" in states(events))
    assert eng.plays == 2
    assert [e.get("stage") for e in events if e["state"] == "dialing"] == [None, "retry"]
    await cm.hangup({"sessionId": SID})
    assert await _until(lambda: states(events)[-1] == "ended")


async def test_media_failure_after_answer_reports_accepted_and_redials_once(monkeypatch):
    err = ConnectionError_()
    cm, eng, events = make([("accept", err), ("accept", err)], monkeypatch)
    await cm.place({"sessionId": SID, "tgUserId": "77", "timeoutSec": 30, "maxDurationSec": 60})
    assert await _until(lambda: states(events) and states(events)[-1] == "ended")
    assert eng.plays == 2                         # 1 marta qayta terildi, keyin to'xtadi
    assert states(events).count("accepted") == 2
    end = events[-1]
    assert end["reason"] in ("network", "error") and end["stage"] == "p2p_connect"
    assert end["attempts"] == 2 and end["errorClass"] == "ConnectionError_"
    assert cm.active is None and eng.hangups == [77, 77]


async def test_permanent_reasons_are_not_retried(monkeypatch):
    class UserPrivacyRestrictedError(Exception):
        pass
    cm, eng, events = make([UserPrivacyRestrictedError()], monkeypatch)
    await cm.place({"sessionId": SID, "tgUserId": "77", "timeoutSec": 30, "maxDurationSec": 60})
    assert await _until(lambda: states(events) and states(events)[-1] == "ended")
    assert eng.plays == 1 and events[-1]["reason"] == "privacy"


async def test_pre_ring_retries_are_bounded(monkeypatch):
    cm, eng, events = make([TelegramServerError()] * 10, monkeypatch)
    await cm.place({"sessionId": SID, "tgUserId": "77", "timeoutSec": 30, "maxDurationSec": 60})
    assert await _until(lambda: states(events) and states(events)[-1] == "ended")
    assert eng.plays == 1 + C.PRE_RING_RETRIES
    assert events[-1]["attempts"] == 1 + C.PRE_RING_RETRIES


async def test_hangup_during_backoff_ends_without_redial(monkeypatch):
    cm, eng, events = make([TelegramServerError(), None], monkeypatch)
    monkeypatch.setattr(C, "RETRY_BACKOFF_S", (0.3, 0.3, 0.3))
    await cm.place({"sessionId": SID, "tgUserId": "77", "timeoutSec": 30, "maxDurationSec": 60})
    assert await _until(lambda: eng.plays == 1 and eng.hangups)
    await cm.hangup({"sessionId": SID})
    assert await _until(lambda: states(events)[-1] == "ended")
    assert eng.plays == 1 and events[-1]["reason"] == "hangup"


async def test_structured_log_has_reason_and_stage(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="tgw.calls")
    cm, eng, events = make([("accept", ConnectionError_()), ("accept", ConnectionError_())], monkeypatch)
    await cm.place({"sessionId": SID, "tgUserId": "77", "timeoutSec": 30, "maxDurationSec": 60})
    assert await _until(lambda: states(events) and states(events)[-1] == "ended")
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("call_event=")]
    failed = [l for l in lines if l.startswith("call_event=connect_failed")]
    assert failed and "stage=p2p_connect" in failed[0] and "err=ConnectionError_" in failed[0] and "accepted=1" in failed[0]
    assert any(l.startswith("call_event=retry_scheduled") for l in lines)
    assert all("77" not in l.split("sid=")[0] for l in lines)   # foydalanuvchi id'si logda yo'q


class PhoneCallAccepted:
    def __init__(self, admin_id, participant_id):
        self.id, self.access_hash = 5, 6
        self.admin_id, self.participant_id = admin_id, participant_id


async def test_raw_accepted_update_emits_accepted(monkeypatch):
    cm, eng, events = make([], monkeypatch)
    c = C.ActiveCall(session_id=SID, user_id=77, frame_uuid=C.A.session_frame_uuid(SID), timeout_sec=30, max_duration_sec=60)
    cm.active = c

    class RT:
        me_id = 1
        calls = cm
        call_users = {}
    await handle_phone_call_update(RT(), PhoneCallAccepted(admin_id=1, participant_id=77))
    assert states(events) == ["accepted"] and c.accepted
