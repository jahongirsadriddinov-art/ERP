import asyncio

from app.lease import EV_ACQUIRE, EV_RELEASE, EV_RENEW, LeaseManager


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


class Server:
    """Soxta backend lease javoblari."""

    def __init__(self):
        self.calls = []
        self.acquire = {"ok": True, "leaseId": "L1", "leaseUntil": 0, "renewEveryMs": 10_000}
        self.renew = {"ok": True, "leaseId": "L1", "leaseUntil": 0, "renewEveryMs": 10_000}
        self.release = {"ok": True}
        self.fail = False

    async def call(self, ev, data):
        self.calls.append((ev, data))
        if self.fail:
            raise TimeoutError()
        return {EV_ACQUIRE: self.acquire, EV_RENEW: self.renew, EV_RELEASE: self.release}[ev]


def mk(server, clock, events):
    async def on_acquired():
        events.append("start")

    async def on_lost(reason):
        events.append(f"stop:{reason}")

    return LeaseManager(server.call, on_acquired, on_lost, clock=clock)


async def settle():
    for _ in range(5):
        await asyncio.sleep(0)


async def test_telegram_starts_only_after_lease():
    s, c, ev = Server(), Clock(), []
    s.acquire = {"ok": False, "reason": "held", "retryAfterMs": 15_000}
    lm = mk(s, c, ev)
    await lm.on_authenticated()
    await settle()
    assert ev == [] and not lm.holding
    # Backoff: darhol qayta so'ralmaydi
    await lm.tick()
    assert [x[0] for x in s.calls] == [EV_ACQUIRE]
    c.t += 16
    s.acquire = {"ok": True, "leaseId": "L1", "leaseUntil": 0, "renewEveryMs": 10_000}
    await lm.tick()
    await settle()
    assert ev == ["start"] and lm.holding and lm.lease_id == "L1"


async def test_renew_every_10s_and_failure_disconnects():
    s, c, ev = Server(), Clock(), []
    lm = mk(s, c, ev)
    await lm.on_authenticated()
    await settle()
    c.t += 5
    await lm.tick()
    assert [x[0] for x in s.calls] == [EV_ACQUIRE]
    c.t += 5
    await lm.tick()
    assert s.calls[-1] == (EV_RENEW, {"leaseId": "L1"})
    s.renew = {"ok": False, "reason": "lost"}
    c.t += 10
    await lm.tick()
    assert ev == ["start", "stop:renew_failed"] and not lm.holding


async def test_renew_timeout_disconnects():
    s, c, ev = Server(), Clock(), []
    lm = mk(s, c, ev)
    await lm.on_authenticated()
    await settle()
    s.fail = True
    c.t += 10
    await lm.tick()
    assert ev[-1] == "stop:renew_failed"


async def test_socket_down_over_20s_disconnects_but_short_blip_keeps_lease():
    s, c, ev = Server(), Clock(), []
    lm = mk(s, c, ev)
    await lm.on_authenticated()
    await settle()
    # Qisqa uzilish (5 s) va qayta autentifikatsiya — lease yangilanadi, Telethon qayta ishga tushmaydi
    lm.on_socket_down()
    c.t += 5
    await lm.tick()
    assert lm.holding
    await lm.on_authenticated()
    await settle()
    assert s.calls[-1] == (EV_RENEW, {"leaseId": "L1"}) and ev == ["start"]
    # Uzoq uzilish
    lm.on_socket_down()
    c.t += 20
    await lm.tick()
    assert ev == ["start", "stop:socket_down"] and not lm.holding


async def test_local_expiry_guard():
    s, c, ev = Server(), Clock(), []
    lm = mk(s, c, ev)
    await lm.on_authenticated()
    await settle()
    lm.authed = False      # yangilash imkoni yo'q, lekin socket "tirik" ko'rinadi
    c.t += 29
    await lm.tick()
    assert ev[-1] == "stop:expired"


async def test_revoked_stops_telegram_then_releases():
    s, c, ev = Server(), Clock(), []
    lm = mk(s, c, ev)
    await lm.on_authenticated()
    await settle()
    await lm.on_revoked("other-lease")
    assert lm.holding                       # boshqa lease — e'tiborsiz
    await lm.on_revoked("L1")
    assert ev == ["start", "stop:revoked"]
    assert s.calls[-1] == (EV_RELEASE, {"leaseId": "L1"}) and lm.pending_release is None


async def test_release_retried_after_reconnect():
    s, c, ev = Server(), Clock(), []
    lm = mk(s, c, ev)
    await lm.on_authenticated()
    await settle()
    lm.on_socket_down()                     # server yopilmoqda
    await lm.on_revoked("L1")
    assert lm.pending_release == "L1"
    s.acquire = {"ok": True, "leaseId": "L2", "leaseUntil": 0, "renewEveryMs": 10_000}
    await lm.on_authenticated()             # yangi instansiya
    await settle()
    evs = [x[0] for x in s.calls]
    assert evs[-2:] == [EV_RELEASE, EV_ACQUIRE] and lm.lease_id == "L2" and ev[-1] == "start"
