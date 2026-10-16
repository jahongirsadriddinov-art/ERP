"""Ochiq muloqot: kiruvchi qo'ng'iroq faqat backend ruxsat bersa qabul qilinadi (bog'langan + rozilik)."""
import asyncio

from app import audio as A
from app.calls import CallManager
from app.tg import handle_phone_call_update

SID = "0123456789abcdef01234567"
SID2 = "abcdefabcdefabcdefabcdef"


def obj(name, **kw):
    return type(name, (), kw)()


class Eng:
    def __init__(self, play_delay=0.0):
        self.ready = True
        self.play_delay = play_delay
        self.played = []
        self.declined = []
        self.hangups = []
        self.frames = []

    async def has_peer(self, uid):
        return True

    async def play(self, uid, timeout):
        self.played.append((uid, timeout))
        if self.play_delay:
            await asyncio.sleep(self.play_delay)

    async def record(self, uid):
        pass

    async def send_frame(self, uid, pcm):
        self.frames.append(pcm)

    async def hangup(self, uid):
        self.hangups.append(uid)

    async def decline_incoming(self, uid):
        self.declined.append(uid)


async def _until(cond, n=300):
    for _ in range(n):
        if cond():
            return True
        await asyncio.sleep(0.005)
    return False


def make(ask, eng=None, open_=True):
    eng = eng or Eng()
    events, up, asks = [], [], []

    async def emit(ev):
        events.append(ev)

    async def send_up(f):
        up.append(f)

    async def _ask(data):
        asks.append(data)
        return await ask(data) if asyncio.iscoroutinefunction(ask) else ask(data)

    cm = CallManager(eng, emit, send_up, ask_incoming=_ask)
    cm.open_incoming = open_
    return cm, eng, events, up, asks


async def test_accepted_for_bound_caller_bridges_audio_like_outgoing():
    cm, eng, events, up, asks = make(lambda d: {"accept": True, "sessionId": SID, "maxDurationSec": 120})
    assert await cm.on_incoming(555) == "accepted"
    assert asks == [{"tgUserId": "555", "workerBusy": False, "at": asks[0]["at"]}]
    assert await _until(lambda: any(e["state"] == "connected" for e in events))
    assert eng.played and eng.played[0][0] == 555 and cm.active.incoming and cm.active.session_id == SID
    # Audio: Telegram → backend va backend → Telegram (chiquvchi bilan bir xil yo'l)
    await cm.on_frames(555, [b"\x10\x00" * 480] * 8)
    assert up and len(up[0]) == 20 + 1280
    cm.on_backend_audio(A.encode_frame(A.session_frame_uuid(SID), 0, b"\x01\x00" * 2400))
    assert cm.active.sender.buffered_ms > 0
    # Bir vaqtda faqat bitta: chiquvchi ham rad
    assert (await cm.place({"sessionId": SID2, "tgUserId": "777"})) == {"accepted": False, "reason": "busy_worker"}
    await cm.hangup({"sessionId": SID, "reason": "completed"})
    assert await _until(lambda: events[-1]["state"] == "ended")
    assert [e["state"] for e in events] == ["dialing", "connected", "ended"]
    assert eng.declined == [] and cm.incoming_accepted == 1


async def test_declined_when_backend_refuses_unbound_caller():
    cm, eng, events, _up, asks = make(lambda d: {"accept": False, "reason": "unknown_caller"})
    assert await cm.on_incoming(999) == "declined"
    assert asks and eng.declined == [999] and eng.played == [] and cm.active is None and events == []


async def test_declined_without_asking_when_off_or_no_answer():
    cm, eng, _ev, _up, asks = make(lambda d: {"accept": True, "sessionId": SID}, open_=False)
    assert await cm.on_incoming(555) == "declined"
    assert asks == [] and eng.declined == [555] and eng.played == []
    # Backend javob bermadi (None) — rad
    cm2, eng2, _e2, _u2, _a2 = make(lambda d: None)
    assert await cm2.on_incoming(555) == "declined" and eng2.declined == [555]
    # Noto'g'ri sessionId — rad
    cm3, eng3, _e3, _u3, _a3 = make(lambda d: {"accept": True, "sessionId": "x"})
    assert await cm3.on_incoming(555) == "declined" and eng3.declined == [555]


async def test_busy_when_call_active():
    def ask(d):
        return {"accept": False, "reason": "busy"} if d["workerBusy"] else {"accept": True, "sessionId": SID2}

    cm, eng, events, _up, asks = make(ask)
    await cm.place({"sessionId": SID, "tgUserId": "777"})
    assert await _until(lambda: any(e["state"] == "connected" for e in events))
    assert await cm.on_incoming(555) == "declined"
    assert asks[-1]["workerBusy"] is True and eng.declined == [555] and cm.active.user_id == 777


async def test_race_active_call_started_during_decision_ends_backend_session():
    gate = asyncio.Event()

    async def ask(d):
        await gate.wait()
        return {"accept": True, "sessionId": SID2}

    cm, eng, events, _up, _asks = make(ask)
    t = asyncio.ensure_future(cm.on_incoming(555))
    await asyncio.sleep(0.01)
    await cm.place({"sessionId": SID, "tgUserId": "777"})
    gate.set()
    assert await t == "declined"
    assert eng.declined == [555]
    assert {"sessionId": SID2, "state": "ended", "reason": "busy"}.items() <= next(e for e in events if e["sessionId"] == SID2).items()


async def test_caller_hung_up_while_deciding():
    gate = asyncio.Event()

    async def ask(d):
        await gate.wait()
        return {"accept": True, "sessionId": SID}

    cm, eng, events, _up, _asks = make(ask)
    t = asyncio.ensure_future(cm.on_incoming(555))
    await asyncio.sleep(0.01)
    cm.on_discarded(555, "hangup")
    gate.set()
    assert await t == "declined"
    assert eng.played == [] and events[-1]["state"] == "ended" and events[-1]["reason"] == "hangup"


async def test_caller_hung_up_while_accepting():
    cm, eng, events, _up, _asks = make(lambda d: {"accept": True, "sessionId": SID}, eng=Eng(play_delay=10))
    assert await cm.on_incoming(555) == "accepted"
    await asyncio.sleep(0.01)
    cm.on_discarded(555, "hangup")
    assert await _until(lambda: events and events[-1]["state"] == "ended")
    assert events[-1]["reason"] == "hangup" and cm.active is None


class Rt:
    def __init__(self, calls):
        self.calls = calls
        self.call_users = {}
        self.discarded = []
        self.guarded = []
        self.incoming_discarded = 0
        self.me_id = 42

    async def discard_raw(self, cid, ah, busy):
        self.discarded.append((cid, ah, busy))

    def guard_incoming(self, uid, cid, ah):
        self.guarded.append((uid, cid))


async def test_raw_requested_off_discards_on_keeps_for_decision():
    cm, *_ = make(lambda d: None, open_=False)
    rt = Rt(cm)
    req = obj("PhoneCallRequested", id=11, access_hash=22, admin_id=555, participant_id=42)
    await handle_phone_call_update(rt, req)
    assert rt.discarded == [(11, 22, True)] and rt.guarded == []
    cm.open_incoming = True
    await handle_phone_call_update(rt, obj("PhoneCallRequested", id=12, access_hash=23, admin_id=555, participant_id=42))
    assert rt.discarded == [(11, 22, True)] and rt.guarded == [(555, 12)] and rt.call_users[12] == (555, 23)
    # Kiruvchi PhoneCall: suhbatdosh — admin_id (qo'ng'iroq qiluvchi), o'zimiz emas
    await handle_phone_call_update(rt, obj("PhoneCall", id=12, access_hash=23, admin_id=555, participant_id=42))
    assert rt.call_users[12] == (555, 23)
