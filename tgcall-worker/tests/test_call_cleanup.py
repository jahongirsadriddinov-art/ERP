"""Owner 2026-10-17: ulanmagan qo'ng'iroq darhol tozalanadi (keyingisi "band" emas), bosqich backendga yuboriladi."""
import asyncio

from app import calls as C
from app.calls import CallManager
from app.tg import BindingProbe, summarize_servers

SID = "0123456789abcdef01234567"
SID2 = "abcdefabcdefabcdefabcdef"


class TelegramServerError(Exception):
    pass


class Eng:
    def __init__(self, fail=None, hang=False):
        self.ready = True
        self.fail = fail
        self.hang = hang
        self.hangups = []
        self.declined = []
        self.stages = {}
        self.cleared = []

    async def has_peer(self, uid):
        return True

    async def play(self, uid, timeout):
        self.stages[uid] = "p2p_connect"
        if self.hang:
            await asyncio.sleep(3600)
        if self.fail:
            raise self.fail

    async def record(self, uid):
        pass

    async def send_frame(self, uid, pcm):
        pass

    async def hangup(self, uid):
        self.hangups.append(uid)

    async def decline_incoming(self, uid):
        self.declined.append(uid)

    def stage_of(self, uid):
        return self.stages.get(uid)

    def clear_stage(self, uid):
        self.cleared.append(uid)
        self.stages.pop(uid, None)


def make(eng, ack=None):
    events = []

    async def emit(ev):
        events.append(ev)

    async def send_up(_f):
        pass

    async def ask(_d):
        return ack

    cm = CallManager(eng, emit, send_up, ask_incoming=ask)
    cm.open_incoming = True
    return cm, events


async def _until(cond, n=400):
    for _ in range(n):
        if cond():
            return True
        await asyncio.sleep(0.005)
    return False


async def test_incoming_network_failure_hangs_up_reports_stage_and_frees_slot():
    eng = Eng(fail=TelegramServerError())
    cm, events = make(eng, {"accept": True, "sessionId": SID, "maxDurationSec": 120})
    assert await cm.on_incoming(555) == "accepted"
    assert await _until(lambda: events and events[-1]["state"] == "ended")
    end = events[-1]
    assert end["reason"] == "network" and end["stage"] == "p2p_connect"
    # Telegram'dagi qo'ng'iroq yopildi, slot darhol bo'sh, bosqich tozalandi
    assert eng.hangups == [555] and cm.active is None and cm.active_count == 0 and eng.cleared == [555]
    # Keyingi qo'ng'iroq "band" emas
    cm._ask_incoming = None
    async def ask2(d):
        assert d["workerBusy"] is False and d["activeCount"] == 0
        return {"accept": True, "sessionId": SID2}
    cm._ask_incoming = ask2
    eng.fail = None
    assert await cm.on_incoming(556) == "accepted"


async def test_play_hanging_is_cut_by_connect_watchdog(monkeypatch):
    monkeypatch.setattr(C, "CONNECT_GRACE_S", 0.05)
    eng = Eng(hang=True)
    cm, events = make(eng)
    c = C.ActiveCall(session_id=SID2, user_id=601, frame_uuid=C.A.session_frame_uuid(SID2), timeout_sec=0, max_duration_sec=30)
    cm.active = c
    await asyncio.wait_for(cm._run(c), timeout=2)
    assert events[-1]["state"] == "ended" and events[-1]["reason"] == "network" and events[-1]["stage"] == "connect_timeout"
    assert eng.hangups == [601] and cm.active is None


class _Inner:
    def __init__(self):
        self.calls_seen = []
        self.flag = None

    async def init_exchange(self, chat_id, dh, g):
        self.calls_seen.append("init_exchange")
        return b"g"

    async def connect_p2p(self, chat_id, servers, versions, p2p, custom):
        self.calls_seen.append(("connect_p2p", p2p))

    async def calls(self):
        return {}


class _Srv:
    def __init__(self, **kw):
        self.peer_tag = kw.get("peer_tag")
        self.turn = kw.get("turn", False)
        self.stun = kw.get("stun", False)
        self.tcp = kw.get("tcp", False)


async def test_binding_probe_marks_stages_and_forwards():
    stages = {}
    inner = _Inner()
    b = BindingProbe(inner, stages)
    assert await b.init_exchange(42, None, None) == b"g"
    assert stages[42] == "key_exchange"
    await b.connect_p2p(42, [_Srv(peer_tag=b"x", turn=True), _Srv(turn=True), _Srv(stun=True)], ["9.0.0"], True, None)
    assert stages[42] == "p2p_connect" and inner.calls_seen[-1] == ("connect_p2p", True)
    assert await b.calls() == {}
    b.flag = 1                       # atributlar ichki obyektga yoziladi
    assert inner.flag == 1
    await b.init_exchange(-100, None, None)   # guruh chat — bosqich yozilmaydi
    assert -100 not in stages


def test_summarize_servers_has_no_addresses():
    s = summarize_servers([_Srv(peer_tag=b"x", turn=True, tcp=True), _Srv(turn=True), _Srv(stun=True)])
    assert s == "reflector=1 turn=1 stun=1 tcp=1"
