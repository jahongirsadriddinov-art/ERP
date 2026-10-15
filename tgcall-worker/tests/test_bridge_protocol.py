import base64

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from app.bridge import EV, NAMESPACE, Bridge
from app.errors import RpcError
from app.keys import challenge_message, public_key_b64, sign_challenge
from app.rpc import dispatch

RID = "3f1c2a9e-1111-4222-8333-944455556666"


def test_challenge_message_matches_backend_format():
    # backend contracts.ts: `aiv-worker\n${workerId}\n${nonce}`
    assert challenge_message("tgw-pc", "abc") == b"aiv-worker\ntgw-pc\nabc"


def test_signature_verifies_with_published_raw_pubkey():
    k = Ed25519PrivateKey.generate()
    pub_raw = base64.b64decode(public_key_b64(k))
    assert len(pub_raw) == 32  # backend: 32 baytli xom kalit base64 qabul qiladi
    sig = base64.b64decode(sign_challenge(k, "tgw-pc", "n" * 43))
    assert len(sig) == 64
    Ed25519PublicKey.from_public_bytes(pub_raw).verify(sig, challenge_message("tgw-pc", "n" * 43))


async def test_rpc_dispatch_ok_and_errors_do_not_leak_params():
    async def ok(p):
        return {"echo": 1}

    async def fails(p):
        raise RpcError("code_invalid", "Kod noto'g'ri")

    async def boom(p):
        raise RuntimeError(f"secret {p.get('password')}")

    h = {"status": ok, "auth.code": fails, "auth.password": boom}
    r = await dispatch(h, {"requestId": RID, "method": "status", "params": {}, "deadlineMs": 0})
    assert r["ok"] is False and r["error"]["code"] == "deadline"  # deadline 0 — juda eski
    r = await dispatch(h, {"requestId": RID, "method": "status", "params": {}})
    assert r == {"requestId": RID, "ok": True, "result": {"echo": 1}}
    r = await dispatch(h, {"requestId": RID, "method": "auth.code", "params": {"code": "12345"}})
    assert r["ok"] is False and r["error"]["code"] == "code_invalid" and "12345" not in str(r)
    r = await dispatch(h, {"requestId": RID, "method": "auth.password", "params": {"password": "hunter2"}})
    assert r["ok"] is False and r["error"]["code"] == "error" and "hunter2" not in str(r)
    r = await dispatch(h, {"requestId": RID, "method": "nope", "params": {}})
    assert r["error"]["code"] == "unknown_method"
    r = await dispatch(h, {"requestId": "bad id!", "method": "status"})
    assert r["error"]["code"] == "bad_request"
    r = await dispatch(h, "junk")
    assert r["error"]["code"] == "bad_request"


async def test_rpc_deadline_expired():
    async def ok(p):
        return {}

    r = await dispatch({"status": ok}, {"requestId": RID, "method": "status", "params": {}, "deadlineMs": 1000}, now_ms=lambda: 10_000_000)
    assert r["error"]["code"] == "deadline"


class FakeSio:
    def __init__(self, auth_ack):
        self.handlers = {}
        self.connected = True
        self.calls = []
        self.emits = []
        self.auth_ack = auth_ack

    def on(self, event, namespace=None):
        def deco(fn):
            self.handlers[(event, namespace)] = fn
            return fn
        return deco

    async def call(self, event, data, namespace=None, timeout=None):
        self.calls.append((event, data, namespace))
        return self.auth_ack if event == EV["auth"] else {"ok": True}

    async def emit(self, event, data, namespace=None):
        self.emits.append((event, data, namespace))


async def _mk_bridge(ack):
    k = Ed25519PrivateKey.generate()
    state = {"authed": 0, "down": 0, "audio": [], "revoked": []}

    async def on_rpc(req):
        return {"requestId": req["requestId"], "ok": True, "result": {"x": 1}}

    async def on_auth():
        state["authed"] += 1

    async def on_revoked(lid):
        state["revoked"].append(lid)

    sio = FakeSio(ack)
    b = Bridge("https://example.test", "tgw-pc", k, on_rpc, lambda f: state["audio"].append(f), on_auth,
               lambda: state.__setitem__("down", state["down"] + 1), on_revoked, sio=sio)
    return b, sio, state, k


async def test_bridge_auth_flow_and_rpc_gate():
    b, sio, state, k = await _mk_bridge({"ok": True})
    rpc = sio.handlers[(EV["rpc"], NAMESPACE)]
    # Autentifikatsiyadan oldin RPC rad etiladi
    r = await rpc({"requestId": RID, "method": "status"})
    assert r["ok"] is False and r["error"]["code"] == "unauthenticated"
    await b._authenticate({"nonce": "N" * 43, "expiresAt": 0, "instanceId": "i"})
    ev, data, ns = sio.calls[-1]
    assert ev == EV["auth"] and ns == NAMESPACE and data["workerId"] == "tgw-pc" and data["nonce"] == "N" * 43
    k.public_key().verify(base64.b64decode(data["signature"]), challenge_message("tgw-pc", "N" * 43))
    assert b.authed and state["authed"] == 1
    assert (await rpc({"requestId": RID, "method": "status"}))["ok"] is True
    # Audio faqat autentifikatsiyadan keyin
    await sio.handlers[(EV["audio"], NAMESPACE)](b"\x00" * 22)
    assert state["audio"] == [b"\x00" * 22]
    await b.send_audio(b"abc")
    assert sio.emits[-1] == (EV["audio"], b"abc", NAMESPACE)
    # Uzilish
    await sio.handlers[("disconnect", NAMESPACE)]("transport close")
    assert not b.authed and state["down"] == 1
    await b.send_audio(b"x")
    assert sio.emits[-1][1] == b"abc"   # uzilganda yuborilmaydi
    await sio.handlers[(EV["lease_revoked"], NAMESPACE)]({"leaseId": "L1"})
    assert state["revoked"] == ["L1"]


async def test_bridge_auth_rejected():
    b, sio, state, _ = await _mk_bridge({"ok": False, "error": "bad_signature"})
    await b._authenticate({"nonce": "N" * 43})
    assert not b.authed and state["authed"] == 0 and b.auth_failures == 1


def test_default_socketio_client_never_logs_packets():
    # logger=True bo'lsa python-socketio/engineio INFO'da paket mazmunini (login RPC: telefon/kod/parol) yozadi
    import logging

    async def _noop(*_a):
        return None

    b = Bridge("http://127.0.0.1:1", "tgw-test", Ed25519PrivateKey.generate(), on_rpc=_noop, on_audio=lambda _b: None,
               on_authenticated=_noop, on_down=lambda: None, on_revoked=_noop)
    assert not b.sio.logger.isEnabledFor(logging.INFO)
    assert not b.sio.eio.logger.isEnabledFor(logging.INFO)
