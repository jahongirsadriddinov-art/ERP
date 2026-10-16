"""Peer aniqlash (owner 2026-10-16): kesh → dialoglar → username → bitta import (id mos kelishi shart), chegara 5/soat."""
import asyncio
import logging

from app.calls import CallManager
from app.peers import ImportLimiter, PeerResolver, mask_id

EXPECTED = 5550001234
OTHER = 5550009999
PHONE = "+998901234567"


class FakeOps:
    def __init__(self, phone_owner=None, contacts=(), dialogs=(), usernames=None):
        self.cache: set[int] = set()
        self.phone_owner = phone_owner          # telefon kimga tegishli (None — Telegram'da yo'q)
        self.contacts: set[int] = set(contacts)
        self.dialogs: set[int] = set(dialogs)
        self.usernames = usernames or {}
        self.imports: list[str] = []
        self.deleted: list[list[int]] = []
        self.dialog_refreshes = 0

    async def has_peer(self, uid):
        return uid in self.cache

    async def refresh_dialogs(self):
        self.dialog_refreshes += 1
        self.cache |= self.dialogs

    async def username_id(self, un):
        if un not in self.usernames:
            raise ValueError("no user")
        uid = self.usernames[un]
        self.cache.add(uid)
        return uid

    async def contact_ids(self):
        return set(self.contacts)

    async def import_phone(self, phone):
        self.imports.append(phone)
        if self.phone_owner is None:
            return []
        self.cache.add(self.phone_owner)       # Telethon javobdagi user'ni keshlaydi
        self.contacts.add(self.phone_owner)
        return [self.phone_owner]

    async def delete_contacts(self, ids):
        self.deleted.append(list(ids))
        self.contacts -= set(ids)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def run(coro):
    return asyncio.run(coro)


def test_cache_and_dialogs_without_import():
    ops = FakeOps(dialogs=[EXPECTED])
    r = PeerResolver(ops)
    assert run(r.resolve(EXPECTED, None, PHONE)) == "resolved"
    assert ops.imports == []
    ops2 = FakeOps()
    ops2.cache.add(EXPECTED)
    assert run(PeerResolver(ops2).resolve(EXPECTED)) == "resolved"
    assert ops2.dialog_refreshes == 0


def test_username_match_and_mismatch_falls_back_to_phone():
    ops = FakeOps(usernames={"ali_usta": EXPECTED})
    assert run(PeerResolver(ops).resolve(EXPECTED, "@ali_usta")) == "resolved"
    ops2 = FakeOps(usernames={"begona": OTHER}, phone_owner=EXPECTED)
    assert run(PeerResolver(ops2).resolve(EXPECTED, "begona", PHONE)) == "resolved"
    assert ops2.imports == [PHONE]
    ops3 = FakeOps(usernames={"begona": OTHER})
    assert run(PeerResolver(ops3).resolve(EXPECTED, "begona")) == "mismatch"


def test_import_accepts_only_expected_id_and_deletes_new_contact():
    ops = FakeOps(phone_owner=EXPECTED)
    assert run(PeerResolver(ops).resolve(EXPECTED, None, PHONE)) == "resolved"
    assert ops.imports == [PHONE]
    assert ops.deleted == [[EXPECTED]]             # avval kontakt emas edi — o'chirildi
    assert EXPECTED in ops.cache                   # access_hash keshda qoldi


def test_import_mismatch_rejected_and_cleaned():
    ops = FakeOps(phone_owner=OTHER)
    assert run(PeerResolver(ops).resolve(EXPECTED, None, PHONE)) == "mismatch"
    assert ops.deleted == [[OTHER]]
    assert EXPECTED not in ops.cache


def test_existing_contact_not_deleted_and_not_found():
    ops = FakeOps(phone_owner=EXPECTED, contacts=[EXPECTED])
    r = PeerResolver(ops)
    # kontakt bor, lekin keshda yo'q (masalan qayta ishga tushgandan keyin)
    assert run(r.resolve(EXPECTED, None, PHONE)) == "resolved"
    assert ops.deleted == []
    ops2 = FakeOps(phone_owner=None)
    assert run(PeerResolver(ops2).resolve(EXPECTED, None, PHONE)) == "not_found"
    assert run(PeerResolver(FakeOps()).resolve(EXPECTED, None, "abc")) == "not_found"   # yaroqsiz telefon — import yo'q


def test_rate_limit_five_per_hour():
    clock = Clock()
    ops = FakeOps(phone_owner=None)
    r = PeerResolver(ops, limiter=ImportLimiter(clock=clock), clock=clock)
    for _ in range(5):
        assert run(r.resolve(EXPECTED, None, PHONE)) == "not_found"
    assert run(r.resolve(EXPECTED, None, PHONE)) == "import_limited"
    assert len(ops.imports) == 5
    clock.t += 3601
    assert run(r.resolve(EXPECTED, None, PHONE)) == "not_found"
    assert len(ops.imports) == 6


def test_dialog_refresh_throttled():
    clock = Clock()
    ops = FakeOps()
    r = PeerResolver(ops, clock=clock)
    run(r.resolve(EXPECTED))
    run(r.resolve(EXPECTED))
    assert ops.dialog_refreshes == 1
    clock.t += 301
    run(r.resolve(EXPECTED))
    assert ops.dialog_refreshes == 2


def test_logs_mask_ids_and_never_phone(caplog):
    caplog.set_level(logging.DEBUG)
    ops = FakeOps(phone_owner=OTHER)
    run(PeerResolver(ops).resolve(EXPECTED, None, PHONE))
    text = caplog.text
    assert str(EXPECTED) not in text and str(OTHER) not in text
    assert PHONE not in text and "901234567" not in text
    assert mask_id(EXPECTED) == "…1234"


# ── CallManager.place: peer noma'lum → resolve_peer (telefon faqat shu chaqiruvda) ──
class Eng:
    def __init__(self, status):
        self.ready = True
        self.status = status
        self.calls = []
        self.played = []

    async def has_peer(self, uid):
        return False

    async def resolve_peer(self, uid, username, phone):
        self.calls.append((uid, username, phone))
        return self.status

    async def play(self, uid, timeout):
        self.played.append(uid)

    async def record(self, uid):
        pass

    async def send_frame(self, uid, pcm):
        pass

    async def hangup(self, uid):
        pass

    async def decline_incoming(self, uid):
        pass


SID = "0123456789abcdef01234567"


def _place(status, params):
    async def go():
        eng = Eng(status)

        async def emit(_ev):
            pass

        async def up(_b):
            pass

        cm = CallManager(eng, emit, up)
        res = await cm.place({"sessionId": SID, "tgUserId": str(EXPECTED), "timeoutSec": 30, "maxDurationSec": 60, **params})
        if cm.active:
            await cm.shutdown("network")
        return res, eng
    return asyncio.run(go())


def test_place_resolves_with_phone_and_maps_reasons():
    res, eng = _place("resolved", {"phone": PHONE})
    assert res == {"accepted": True}
    assert eng.calls == [(EXPECTED, None, PHONE)]
    assert _place("not_found", {})[0] == {"accepted": False, "reason": "peer_unknown"}
    assert _place("mismatch", {"phone": PHONE})[0] == {"accepted": False, "reason": "peer_mismatch"}
    assert _place("import_limited", {"phone": PHONE})[0] == {"accepted": False, "reason": "import_limited"}
    assert _place("flood_wait", {"phone": PHONE})[0] == {"accepted": False, "reason": "flood_wait"}
