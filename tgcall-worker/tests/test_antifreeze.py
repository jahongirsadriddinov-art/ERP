"""Anti-freeze (owner 2026-10-23): qurilma izi, proksi, muzlatish aniqlash, xulq-atvor chegaralari.

Telethon import qilinmaydi — xatolar sinf NOMI bo'yicha soxtalashtiriladi.
"""
import asyncio
import json
import random
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet

from app import fingerprint as fp
from app import proxy as px
from app.errors import flood_seconds, map_call_error
from app.freeze import Health, classify, json_value, parse_freeze
from app.limits import DAY, HOUR, ImportGate, UsageLimiter


# ── soxta Telethon xatolari (meros zanjiri Telethon'dagidek) ──
class RPCError(Exception):
    def __init__(self, message=""):
        super().__init__(message)
        self.message = message


class FloodError(RPCError): pass
class BadRequestError(RPCError): pass
class UnauthorizedError(RPCError): pass
class FrozenMethodInvalidError(FloodError): pass          # Telethon'da aynan FloodError'dan meros!
class FrozenParticipantMissingError(BadRequestError): pass
class PeerFloodError(BadRequestError): pass
class UserDeactivatedBanError(UnauthorizedError): pass
class AuthKeyUnregisteredError(UnauthorizedError): pass


class FloodWaitError(FloodError):
    def __init__(self, seconds):
        super().__init__("FLOOD_WAIT")
        self.seconds = seconds


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


# ───────────── qurilma izi ─────────────

def test_fingerprint_realistic_stable_and_persisted(tmp_path):
    path = fp.fp_path(tmp_path / "accounts" / "aaaaaaaaaaaaaaaaaaaaaaaa.enc")
    assert path.name == "aaaaaaaaaaaaaaaaaaaaaaaa.device.json"
    a = fp.load_or_create(path, "aaaaaaaaaaaaaaaaaaaaaaaa", now_ms=1000)
    assert path.exists()
    # Nostandart "QurilishERP AI"/"Windows" emas — Telegram Desktop'ga o'xshash
    assert "QurilishERP" not in json.dumps(a)
    assert a["device_model"] in fp.DEVICE_MODELS
    assert a["system_version"] in ("Windows 10 x64", "Windows 11 x64")
    assert a["app_version"].endswith(" x64") and a["app_version"].split(" ")[0].count(".") == 2
    assert (a["lang_code"], a["system_lang_code"]) in (("ru", "ru-RU"), ("uz", "uz-UZ"), ("en", "en-US"))
    assert a["addedAt"] == 1000
    # Qayta o'qilganda O'ZGARMAYDI (vaqt boshqa bo'lsa ham)
    b = fp.load_or_create(path, "aaaaaaaaaaaaaaaaaaaaaaaa", now_ms=999_999)
    assert b == a
    # Fayl yo'qolsa ham seed bo'yicha bir xil qurilma
    path.unlink()
    c = fp.load_or_create(path, "aaaaaaaaaaaaaaaaaaaaaaaa", now_ms=5)
    assert {k: c[k] for k in fp.FIELDS} == {k: a[k] for k in fp.FIELDS}
    assert set(fp.client_kwargs(a)) == set(fp.FIELDS)


def test_fingerprint_differs_between_accounts():
    seen = {tuple(fp.generate(f"{i:024x}")[k] for k in fp.FIELDS) for i in range(30)}
    assert len(seen) > 10
    models = {fp.generate(f"{i:024x}")["device_model"] for i in range(60)}
    assert len(models) > 8


def test_fingerprint_manual_edit_kept_and_outdated_version_upgraded(tmp_path, monkeypatch):
    path = tmp_path / "x.device.json"
    path.write_text(json.dumps({"device_model": "MyPC", "system_version": "Windows 10 x64", "app_version": "4.0.0 x64",
                                "lang_code": "uz", "system_lang_code": "uz-UZ", "addedAt": 7}), "utf-8")
    monkeypatch.setenv("TG_APP_VERSIONS", "6.2.4,6.3.0")
    out = fp.load_or_create(path, "seed")
    assert out["device_model"] == "MyPC" and out["lang_code"] == "uz" and out["addedAt"] == 7
    assert out["app_version"] in ("6.2.4 x64", "6.3.0 x64")
    assert json.loads(path.read_text("utf-8"))["app_version"] == out["app_version"]


# ───────────── proksi ─────────────

def test_proxy_parse_formats():
    s = px.parse("socks5://us%40er:p%3Ass@10.0.0.1:1080")
    assert s == {"type": "socks5", "host": "10.0.0.1", "port": 1080, "username": "us@er", "password": "p:ss"}
    assert px.parse("http://proxy.uz:8080")["type"] == "http"
    assert px.parse("socks5h://h:1")["type"] == "socks5"
    m = px.parse("mtproto://" + "ab" * 16 + "@mt.example:443")
    assert m == {"type": "mtproto", "host": "mt.example", "port": 443, "secret": "ab" * 16}
    t = px.parse("tg://proxy?server=1.2.3.4&port=443&secret=dd" + "0f" * 16)
    assert t["type"] == "mtproto" and t["port"] == 443 and t["secret"].startswith("dd")
    for bad in ("", "ftp://h:1", "socks5://h", "socks5://:1080", "mtproto://zz@h:1", "http://h:99999"):
        with pytest.raises(px.ProxyConfigError):
            px.parse(bad)


def test_proxy_table_and_client_kwargs():
    table = px.table_from_env({"TG_PROXIES": json.dumps({"a" * 24: "socks5://u:secretpw@h:1080", "*": "http://d:8080"})})
    p = px.for_account("a" * 24, table)
    kw = px.client_kwargs(p)
    assert kw == {"proxy": {"proxy_type": "socks5", "addr": "h", "port": 1080, "rdns": True, "username": "u", "password": "secretpw"}}
    assert px.describe(p) == "socks5 h:1080"          # parol panelga/backendga chiqmaydi
    assert px.for_account("b" * 24, table)["host"] == "d"   # "*" — qolganlar
    assert px.for_account("", {}) is None and px.client_kwargs(None) == {}
    assert px.for_account("", {"platform": "http://p:1"})["host"] == "p"
    with pytest.raises(px.ProxyConfigError):
        px.table_from_env({"TG_PROXIES": "{not json"})


# ───────────── muzlatish aniqlash ─────────────

def test_classify_restriction_errors():
    assert classify(FrozenMethodInvalidError("FROZEN_METHOD_INVALID")) == "frozen"
    assert classify(FrozenParticipantMissingError()) == "frozen"
    assert classify(PeerFloodError()) == "spam_limited"
    assert classify(UserDeactivatedBanError()) == "banned"
    assert classify(AuthKeyUnregisteredError()) == "unauthorized"
    assert classify(RPCError("FROZEN_SOMETHING_NEW")) == "frozen"     # noma'lum sinf — kod bo'yicha
    assert classify(FloodWaitError(30)) is None
    assert classify(ValueError("x")) is None


def test_frozen_is_not_flood_wait():
    # Telethon'da FrozenMethodInvalidError FloodError'dan meros — FloodWait deb 60 s kutib qayta urinmaslik kerak
    assert flood_seconds(FrozenMethodInvalidError()) is None
    assert flood_seconds(FloodWaitError(42)) == 42
    assert map_call_error(FrozenMethodInvalidError()) == "account_frozen"
    assert map_call_error(PeerFloodError()) == "spam_limited"


def _jo(**kv):
    JsonObjectValue = type("JsonObjectValue", (), {})
    items = []
    for k, v in kv.items():
        it = JsonObjectValue()
        it.key, it.value = k, v
        items.append(it)
    return type("JsonObject", (), {"value": items})()


def _jv(name, value=None):
    return type(name, (), {"value": value})()


def test_app_config_freeze_parsing():
    cfg = json_value(_jo(freeze_since_date=_jv("JsonNumber", 1_760_000_000.0), freeze_until_date=_jv("JsonNumber", 1_790_000_000),
                         freeze_appeal_url=_jv("JsonString", "https://t.me/spambot?start=appeal"),
                         other=_jv("JsonArray", [_jv("JsonBool", True), _jv("JsonNull")])))
    assert cfg["other"] == [True, None]
    assert parse_freeze(cfg) == {"since": 1_760_000_000_000, "until": 1_790_000_000_000, "appealUrl": "https://t.me/spambot?start=appeal"}
    assert parse_freeze({"some": 1}) is None
    assert parse_freeze({"freeze_until_date": 5, "freeze_appeal_url": "javascript:alert(1)"}) == {"until": 5000}


def test_health_marks_expires_and_ranks():
    clk = Clock(1000.0)
    h = Health(clock=lambda: clk.t * 1000)
    assert h.blocked() is None and h.to_dict() == {"state": "ok"}
    assert h.mark("spam_limited") is True
    assert h.blocked() == "spam_limited"
    assert h.to_dict()["until"] == int((1000 + 24 * 3600) * 1000)
    assert h.mark("spam_limited") is False                # o'zgarmadi — qayta xabar yo'q
    assert h.mark("frozen", until=int(5000 * 1000), appeal_url="https://t.me/spambot") is True
    assert h.mark("spam_limited") is False                # kuchsizroq holat bosib ketmaydi
    assert h.to_dict() == {"state": "frozen", "reason": "account_frozen", "since": 1_000_000, "until": 5_000_000, "appealUrl": "https://t.me/spambot"}
    clk.t = 6000.0                                         # muddat tugadi — avtomatik ochiladi
    assert h.blocked() is None and h.state == "ok"
    h.mark("banned")
    clk.t = 10 ** 9
    assert h.blocked() == "account_banned"                 # ban muddatsiz


# ───────────── chegaralar ─────────────

def _lim(tmp_path, clk, added_days_ago=30, **kw):
    return UsageLimiter(tmp_path / "u.usage.json", "seed", (clk.t - added_days_ago * DAY) * 1000, clock=clk,
                        rng=random.Random(1), overrides=kw.pop("overrides", {}), **kw)


def test_hourly_and_daily_caps_with_gap_jitter(tmp_path):
    clk = Clock()
    u = _lim(tmp_path, clk)
    assert not u.warming
    cap = u.cap("call")
    assert cap["hour"] == 12 and 48 <= cap["day"] <= 60          # kunlik — 80..100% (jitter)
    u.take("call", 1)
    r = u.check("call", 2)
    assert r and r[0] == "rate_limited" and 40 <= r[1] <= 91       # qo'ng'iroqlar orasida 40–90 s pauza
    for i in range(11):
        clk.t += 100
        assert u.check("call", 100 + i) is None
        u.take("call", 100 + i)
    clk.t += 100
    r = u.check("call", 999)
    assert r[0] == "rate_limited" and r[1] > 1000                  # soatiga 12 tadan oshmaydi
    clk.t += HOUR
    assert u.check("call", 999) is None


def test_warmup_caps_much_lower_then_normal(tmp_path):
    clk = Clock()
    u = _lim(tmp_path, clk, added_days_ago=1)
    assert u.warming and u.snapshot()["warmup"] is True
    assert u.cap("call")["hour"] == 3 and u.cap("call")["day"] <= 10
    assert u.cap("import")["day"] <= 3
    clk.t += 7 * DAY
    assert not u.warming and u.cap("call")["hour"] == 12


def test_same_person_not_too_often(tmp_path):
    clk = Clock()
    u = _lim(tmp_path, clk)
    u.take("call", 42)
    clk.t += 200                                    # umumiy pauza o'tdi, lekin shu odamga 10 daqiqa bo'lmadi
    assert u.check("call", 7) is None
    r = u.check("call", 42)
    assert r[0] == "peer_limited" and 390 <= r[1] <= 401
    for _ in range(3):
        clk.t += 700
        assert u.check("call", 42) is None
        u.take("call", 42)
    clk.t += 700
    assert u.check("call", 42)[0] == "peer_limited"  # kuniga 4 tadan ko'p emas


def test_flood_wait_exact_and_persistence(tmp_path):
    clk = Clock()
    u = _lim(tmp_path, clk)
    u.flood("dm", 37)
    assert u.check("dm") == ("flood_wait", 38)
    u.take("import")
    u.note_inbound(5)
    # Worker qayta ishga tushdi — hisob saqlangan
    u2 = _lim(tmp_path, clk)
    assert u2.check("dm")[0] == "flood_wait"
    assert u2.snapshot()["import"]["day"] == 1
    assert u2.wrote_recently(5) and not u2.wrote_recently(6)
    clk.t += DAY + 1
    assert not u2.wrote_recently(5)


def test_import_gate_respects_health_and_caps(tmp_path):
    clk = Clock()
    u = _lim(tmp_path, clk)
    state = {"b": None}
    g = ImportGate(lambda: u, lambda: state["b"])
    assert g.take() is True and g.used == 1
    assert g.take() is False                         # 60–180 s pauza
    clk.t += 200
    state["b"] = "spam_limited"
    assert g.take() is False                         # cheklangan akkaunt kontakt import qilmaydi
    state["b"] = None
    assert g.take() is True


def test_env_overrides(tmp_path):
    clk = Clock()
    u = _lim(tmp_path, clk, overrides={"call": {"hour": 2, "day": 3}, "warmupDays": 0})
    assert not u.warming and u.cap("call")["hour"] == 2 and u.cap("call")["day"] <= 3


# ───────────── Account integratsiyasi (Telethon'siz) ─────────────

def _account(tmp_path, acc_id="a" * 24, events=None):
    from app.accounts import Account
    from app.binding import BindingMatcher
    from app.session_store import SessionStore
    cfg = SimpleNamespace(api_id=1, api_hash="0" * 32, worker_id="tgw-test")
    store = SessionStore(tmp_path / "accounts" / f"{acc_id}.enc", Fernet.generate_key().decode())
    store.save("dummy-session")
    out = events if events is not None else []

    async def emit(ev):
        out.append(ev)

    async def nop(*_a, **_k):
        return None

    a = Account(acc_id, cfg, store, emit, BindingMatcher(), nop, nop, nop, lambda: True)
    a.runtime.usage.warmup_days = 0
    return a, out


async def test_account_place_refuses_frozen_and_limits(tmp_path):
    a, events = _account(tmp_path)
    placed = []

    async def fake_place(p):
        placed.append(p["tgUserId"])
        return {"accepted": True}

    a.calls.place = fake_place
    a.runtime.warm_peers.add(11)
    assert (await a.place({"tgUserId": "11", "sessionId": "s"}))["accepted"] is True
    r = await a.place({"tgUserId": "12", "sessionId": "s"})
    assert r["accepted"] is False and r["reason"] == "rate_limited" and r["retryAfterSec"] > 0
    a.runtime.usage.next_at.clear()
    a.runtime.note_error(FrozenMethodInvalidError("FROZEN_METHOD_INVALID"))
    await asyncio.sleep(0)
    r = await a.place({"tgUserId": "12", "sessionId": "s"})
    assert r == {"accepted": False, "reason": "account_frozen"}
    assert placed == ["11"]
    # Holat o'zgarishi backendga darhol yuborildi
    ev = [e for e in events if e.get("type") == "account.health"]
    assert ev and ev[-1]["account"] == "a" * 24 and ev[-1]["health"]["state"] == "frozen"
    st = a.status()
    assert st["health"]["state"] == "frozen"
    assert "TDesktop" in st["device"] and st["usage"]["call"]["day"] == 1


async def test_cold_calls_have_separate_lower_cap(tmp_path):
    a, _ = _account(tmp_path)

    async def ok(_p):
        return {"accepted": True}

    a.calls.place = ok
    u = a.runtime.usage
    u.caps["cold"] = {"hour": 1, "day": 1}
    assert (await a.place({"tgUserId": "500", "sessionId": "s"}))["accepted"]
    u.next_at.clear()
    r = await a.place({"tgUserId": "501", "sessionId": "s"})          # notanish — sovuq chegara to'ldi
    assert r["accepted"] is False and r["reason"] == "rate_limited"
    a.runtime.note_inbound(501)                                       # o'zi yozdi — endi "issiq"
    assert (await a.place({"tgUserId": "501", "sessionId": "s"}))["accepted"]


async def test_call_ended_with_peer_flood_marks_account(tmp_path):
    a, events = _account(tmp_path)
    await a.calls._emit({"type": "call.state", "sessionId": "s", "state": "ended", "reason": "spam_limited", "at": 1})
    await asyncio.sleep(0)
    assert a.runtime.health.state == "spam_limited"
    assert any(e.get("type") == "account.health" for e in events)


async def test_dm_reply_allowed_when_spam_limited_but_not_when_frozen(tmp_path):
    from app.errors import RpcError
    a, _ = _account(tmp_path)
    sent = []

    async def fake_send(uid, text):
        sent.append(uid)

    a.runtime.send_dm = fake_send
    a.runtime.note_inbound(77)
    a.runtime.note_state("spam_limited")
    await a.send_dm(77, "salom")                         # o'zi yozgan odamga javob — mumkin
    with pytest.raises(RpcError) as e:
        await a.send_dm(78, "salom")                     # o'zi boshlagan DM — yo'q
    assert e.value.code == "spam_limited"
    a.runtime.health.mark("frozen")
    with pytest.raises(RpcError) as e:
        await a.send_dm(77, "salom")
    assert e.value.code == "account_frozen"
    assert sent == [77]


async def test_dm_flood_wait_respected(tmp_path):
    from app.errors import RpcError
    a, _ = _account(tmp_path)

    async def flood(uid, text):
        raise FloodWaitError(120)

    a.runtime.send_dm = flood
    a.runtime.note_inbound(5)
    with pytest.raises(RpcError) as e:
        await a.send_dm(5, "x")
    assert e.value.code == "flood_wait" and e.value.retry_after_sec == 120
    with pytest.raises(RpcError) as e:
        await a.send_dm(5, "x")                          # Telegram aytgan muddat tugaguncha urinilmaydi
    assert e.value.code == "flood_wait"


async def test_check_freeze_from_app_config(tmp_path):
    pytest.importorskip("telethon")
    a, events = _account(tmp_path)
    rt = a.runtime
    cfg = _jo(freeze_until_date=_jv("JsonNumber", 4_000_000_000), freeze_appeal_url=_jv("JsonString", "https://t.me/spambot"))
    calls = []

    async def client(req):
        calls.append(type(req).__name__)
        return SimpleNamespace(config=cfg)

    rt.client = client
    info = await rt.check_freeze()
    assert calls == ["GetAppConfigRequest"]
    assert info["until"] == 4_000_000_000_000
    assert rt.health.to_dict()["appealUrl"] == "https://t.me/spambot"
    assert a.runtime.health.blocked() == "account_frozen"
    # Muzlatish olib tashlandi — holat tiklanadi
    cfg2 = _jo(other=_jv("JsonNumber", 1))

    async def client2(req):
        return SimpleNamespace(config=cfg2)

    rt.client = client2
    await rt.check_freeze()
    assert rt.health.state == "ok"
    assert [e["health"]["state"] for e in events if e.get("type") == "account.health"][-2:] == ["frozen", "ok"]


def test_remove_forgets_device_and_usage_files(tmp_path):
    a, _ = _account(tmp_path)
    a.runtime.usage.take("import")
    p = a.store.path
    dev, usage = p.with_name(p.stem + ".device.json"), p.with_name(p.stem + ".usage.json")
    assert dev.exists() and usage.exists()
    a.forget_files()
    assert not dev.exists() and not usage.exists()


def test_make_client_uses_stable_fingerprint_and_proxy(tmp_path, monkeypatch):
    telethon = pytest.importorskip("telethon")
    seen = []

    class FakeClient:
        def __init__(self, session, api_id, api_hash, **kw):
            seen.append(kw)

    monkeypatch.setattr(telethon, "TelegramClient", FakeClient)
    monkeypatch.setenv("TG_PROXIES", json.dumps({"a" * 24: "mtproto://" + "ab" * 16 + "@mt.uz:443"}))
    a, _ = _account(tmp_path)
    a.runtime.make_client(None)
    a.runtime.make_client(None)
    assert seen[0]["device_model"] != "QurilishERP AI" and seen[0]["system_version"].startswith("Windows 1")
    assert {k: seen[0][k] for k in fp.FIELDS} == {k: seen[1][k] for k in fp.FIELDS}   # har safar bir xil
    assert seen[0]["proxy"] == ("mt.uz", 443, "ab" * 16)
    assert a.status()["proxy"] == "mtproto mt.uz:443"
    monkeypatch.setenv("TG_PROXIES", json.dumps({"*": "socks5://h"}))
    with pytest.raises(px.ProxyConfigError):
        a.runtime.make_client(None)          # xato proksi — proksisiz "jimgina" ulanmaydi
    from app.errors import RpcError
    with pytest.raises(RpcError) as e:
        a._login_client()
    assert e.value.code == "proxy_invalid"
