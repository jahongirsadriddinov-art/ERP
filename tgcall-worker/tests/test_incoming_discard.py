"""A3: kiruvchi qo'ng'iroqlar rad etiladi, DM'lar AI'ga uzatilmaydi (faqat bog'lash kodi)."""
import asyncio
import hashlib
import time

from app.binding import BindingMatcher, code_hash, extract_code
from app.calls import CallManager
from app.tg import handle_phone_call_update, handle_private_message

EMP = "0123456789abcdef01234567"


def obj(name, **kw):
    return type(name, (), {})() if not kw else type(name, (), kw)()


class FakeRt:
    def __init__(self):
        self.discarded = []
        self.events = []
        self.call_users = {}
        self.incoming_discarded = 0
        self.binding = BindingMatcher()
        self.calls = None

    async def discard_raw(self, cid, ah, busy):
        self.discarded.append((cid, ah, busy))

    async def emit(self, ev):
        self.events.append(ev)


async def test_incoming_call_is_discarded_busy():
    rt = FakeRt()
    await handle_phone_call_update(rt, obj("PhoneCallRequested", id=11, access_hash=22, admin_id=5, participant_id=1))
    assert rt.discarded == [(11, 22, True)] and rt.incoming_discarded == 1


async def test_waiting_ringing_and_discard_reason_routed_to_calls():
    rt = FakeRt()
    got = []

    class Calls:
        async def on_ringing(self, uid):
            got.append(("ring", uid))

        def on_discarded(self, uid, reason):
            got.append(("disc", uid, reason))

    rt.calls = Calls()
    await handle_phone_call_update(rt, obj("PhoneCallWaiting", id=1, access_hash=2, participant_id=777, receive_date=None))
    assert got == [] and rt.call_users[1] == (777, 2)
    await handle_phone_call_update(rt, obj("PhoneCallWaiting", id=1, access_hash=2, participant_id=777, receive_date=123))
    assert got == [("ring", 777)]
    await handle_phone_call_update(rt, obj("PhoneCallDiscarded", id=1, reason=obj("PhoneCallDiscardReasonMissed")))
    assert got[-1] == ("disc", 777, "missed") and 1 not in rt.call_users
    assert rt.discarded == []


def test_code_extraction():
    assert extract_code("salom AI-4821") == "AI-4821"
    assert extract_code("ai 4821") == "AI-4821"
    assert extract_code("AI4821!") == "AI-4821"
    assert extract_code("4821") is None
    assert extract_code("x" * 500 + " AI-4821") is None
    # backend consentFlow.bindingCodeHash bilan bir xil
    assert code_hash(" ai-4821 ") == hashlib.sha256(b"AI-4821").hexdigest()


async def test_dm_only_binding_code_from_expected_user():
    rt = FakeRt()
    exp = time.time() * 1000 + 60_000
    rt.binding.expect(EMP, code_hash("AI-4821"), "555", exp)
    # Oddiy xabar — e'tiborsiz
    assert await handle_private_message(rt, 555, "Salom, qalesan?", None) is False
    # Boshqa odam to'g'ri kod bilan — e'tiborsiz (bot bilgan id emas)
    assert await handle_private_message(rt, 999, "AI-4821", None) is False
    # Noto'g'ri kod
    assert await handle_private_message(rt, 555, "AI-1111", None) is False
    assert rt.events == []
    assert await handle_private_message(rt, 555, "kod: ai-4821", "ali_usta") is True
    ev = rt.events[-1]
    assert ev["type"] == "binding.matched" and ev["employeeId"] == EMP and ev["tgUserId"] == "555" and ev["username"] == "ali_usta"
    # Bir martalik
    assert await handle_private_message(rt, 555, "AI-4821", None) is False


def test_binding_expiry_and_validation():
    now = {"t": 1000.0}
    m = BindingMatcher(now_ms=lambda: now["t"])
    m.expect(EMP, code_hash("AI-1234"), "42", 2000)
    assert m.pending() == 1
    now["t"] = 2500
    assert m.match(42, "AI-1234") is None and m.pending() == 0
    for bad in [("x", code_hash("AI-1"), "42", 9e12), (EMP, "zz", "42", 9e12), (EMP, code_hash("AI-1"), "0", 9e12)]:
        try:
            m.expect(*bad)
            raise AssertionError("ValueError kutilgan edi")
        except ValueError:
            pass


class FakeEngine:
    def __init__(self, play_exc=None, play_delay=0.0, known=True):
        self.ready = True
        self.play_exc = play_exc
        self.play_delay = play_delay
        self.known = known
        self.frames = []
        self.hangups = []

    async def has_peer(self, uid):
        return self.known

    async def play(self, uid, timeout):
        if self.play_delay:
            await asyncio.sleep(self.play_delay)
        if self.play_exc:
            raise self.play_exc

    async def record(self, uid):
        pass

    async def send_frame(self, uid, pcm):
        self.frames.append(pcm)

    async def hangup(self, uid):
        self.hangups.append(uid)


SID = "0123456789abcdef01234567"


async def _until(cond, n=200):
    for _ in range(n):
        if cond():
            return True
        await asyncio.sleep(0.005)
    return False


async def test_call_flow_connect_audio_hangup():
    eng = FakeEngine()
    events, up = [], []

    async def emit(ev):
        events.append(ev)

    async def send_up(f):
        up.append(f)

    cm = CallManager(eng, emit, send_up)
    r = await cm.place({"sessionId": SID, "tgUserId": "777", "timeoutSec": 45, "maxDurationSec": 120})
    assert r == {"accepted": True}
    # Bir vaqtda faqat bitta
    assert (await cm.place({"sessionId": "f" * 24, "tgUserId": "778"})) == {"accepted": False, "reason": "busy_worker"}
    assert await _until(lambda: any(e["state"] == "connected" for e in events))
    # Telegram 48k → backend 16k kadrlar (40 ms)
    await cm.on_frames(777, [b"\x10\x00" * 480] * 8)
    assert up and len(up[0]) == 20 + 1280
    # Backend 24k → yuboruvchi
    from app import audio as A
    cm.on_backend_audio(A.encode_frame(A.session_frame_uuid(SID), 0, b"\x01\x00" * 2400))
    assert cm.active.sender.buffered_ms > 0
    cm.on_backend_audio(A.flush_frame(A.session_frame_uuid(SID)))
    assert cm.active.sender.buffered_ms == 0
    await cm.hangup({"sessionId": SID, "reason": "completed"})
    assert await _until(lambda: events[-1]["state"] == "ended")
    assert [e["state"] for e in events] == ["dialing", "connected", "ended"]
    assert events[-1]["reason"] == "hangup" and eng.hangups == [777] and cm.active is None


async def test_remote_hangup_is_completed():
    eng = FakeEngine()
    events = []

    async def emit(ev):
        events.append(ev)

    async def send_up(_f):
        pass

    cm = CallManager(eng, emit, send_up)
    await cm.place({"sessionId": SID, "tgUserId": "777"})
    assert await _until(lambda: any(e["state"] == "connected" for e in events))
    cm.on_discarded(777, "hangup")
    assert await _until(lambda: events[-1]["state"] == "ended")
    assert events[-1]["reason"] == "completed" and eng.hangups == []


async def test_place_errors_mapped():
    for exc_name, reason in [("CallBusy", "busy"), ("TimedOutAnswer", "timeout"), ("UserPrivacyRestrictedError", "privacy")]:
        events = []

        async def emit(ev):
            events.append(ev)

        async def send_up(_f):
            pass

        cm = CallManager(FakeEngine(play_exc=type(exc_name, (Exception,), {})()), emit, send_up)
        await cm.place({"sessionId": SID, "tgUserId": "777"})
        assert await _until(lambda: events and events[-1]["state"] == "ended")
        assert events[-1]["reason"] == reason and cm.active is None


async def test_hangup_while_dialing_and_peer_unknown():
    events = []

    async def emit(ev):
        events.append(ev)

    async def send_up(_f):
        pass

    eng = FakeEngine(play_delay=10)
    cm = CallManager(eng, emit, send_up)
    await cm.place({"sessionId": SID, "tgUserId": "777"})
    await asyncio.sleep(0.01)
    await cm.hangup({"sessionId": SID, "reason": "timeout"})
    assert await _until(lambda: events[-1]["state"] == "ended")
    assert events[-1]["reason"] == "hangup" and eng.hangups == [777] and cm.active is None
    cm2 = CallManager(FakeEngine(known=False), emit, send_up)
    assert (await cm2.place({"sessionId": SID, "tgUserId": "777"})) == {"accepted": False, "reason": "peer_unknown"}
