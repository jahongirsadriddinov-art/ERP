"""tgcall-worker kirish nuqtasi: `python -m app.main`.

Tartib: .env → kalitlar (birinchi marta yaratiladi, ochiq kalit ekranga chiqadi) → backendga ulanish →
Ed25519 autentifikatsiya → lease → (lease bilan) Telethon + py-tgcalls → RPC/qo'ng'iroqlar.
Ctrl+C: qo'ng'iroq yopiladi, Telethon uziladi, lease bo'shatiladi.
"""
from __future__ import annotations

import asyncio
import logging
import signal
import sys
import time

from . import __version__
from . import config as cfgmod
from .auth_flow import LoginFlow
from .binding import BindingMatcher
from .bridge import Bridge
from .calls import CallManager
from .errors import RpcError
from .health import build_status, health_loop
from .keys import ensure_session_key, load_or_create_private_key, print_public_key, public_key_b64
from .lease import LeaseManager
from .rpc import dispatch
from .session_store import SessionStore, SessionStoreError
from .tg import TelegramRuntime
from .udp_probe import probe

log = logging.getLogger("tgw")

EV_INCOMING = "worker:incoming.call"


class _NoSecretsFilter(logging.Filter):
    """Kutubxona loglari DEBUG'da so'rov tanalarini chiqarmasligi uchun — faqat INFO+ ruxsat."""

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno >= logging.INFO or record.name.startswith("tgw")


def setup_logging(level: str) -> None:
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", "%H:%M:%S"))
    h.addFilter(_NoSecretsFilter())
    root = logging.getLogger()
    root.handlers[:] = [h]
    root.setLevel(getattr(logging, level, logging.INFO))
    # Shovqinli kutubxonalar
    for name in ("telethon", "pytgcalls", "socketio", "engineio", "aiohttp"):
        logging.getLogger(name).setLevel(logging.WARNING)


async def amain() -> int:
    cfgmod.load_env()
    cfg = cfgmod.from_env()
    setup_logging(cfg.log_level)
    key, created = load_or_create_private_key(cfg.private_key_path)
    _, sk_created = ensure_session_key(cfgmod.DEFAULT_ENV)
    if sk_created:
        log.info("TG_SESSION_KEY yaratildi va .env fayliga yozildi (uni yo'qotmang)")
    cfg = cfgmod.from_env()
    print_public_key(public_key_b64(key), created)
    # Video avatar ko'rinishlarini fonda oldindan tayyorlash (birinchi video qo'ng'iroqda kutish bo'lmasin)
    try:
        import threading
        from .avatar.premium import warm_up
        threading.Thread(target=warm_up, name="avatar-warmup", daemon=True).start()
    except Exception:
        pass
    bad = cfg.problems()
    if bad:
        log.error(".env faylida to'ldirilmagan/noto'g'ri qiymatlar: %s (README.md ga qarang)", ", ".join(bad))
        return 2
    try:
        store = SessionStore(cfg.session_path, cfg.session_key)
    except SessionStoreError as e:
        log.error("%s", e)
        return 2

    binding = BindingMatcher()
    udp_state: dict = {"ok": None}
    bridge: Bridge
    lease: LeaseManager

    async def emit(ev: dict) -> None:
        await bridge.emit_event(ev)

    runtime = TelegramRuntime(cfg, store, emit, binding)

    async def send_up(frame: bytes) -> None:
        await bridge.send_audio(frame)

    async def ask_incoming(data: dict):
        # Ochiq muloqot: backend qaror beradi (bog'langan xodim + rozilik); javob kelmasa — rad
        if not bridge.authed:
            return None
        return await bridge.call(EV_INCOMING, data, timeout=12)

    async def send_video(frame: bytes) -> None:
        await bridge.send_video(frame)

    calls = CallManager(runtime, emit, send_up, ask_incoming=ask_incoming, send_video=send_video)
    runtime.calls = calls

    async def on_login_success(session: str) -> None:
        await runtime.adopt_session(session)

    login = LoginFlow(lambda: runtime.make_client(None), on_login_success, lambda: lease.holding)

    def need_lease() -> None:
        if not lease.holding:
            raise RpcError("not_leased", "Worker lease olmagan")

    def need_tg() -> None:
        need_lease()
        if not runtime.ready:
            raise RpcError("not_authorized", "Telegram akkaunti ulanmagan")

    async def h_auth_start(p: dict) -> dict:
        need_lease()
        if runtime.ready:
            raise RpcError("already_connected", "Akkaunt allaqachon ulangan — avval chiqing")
        return await login.start(p)

    async def h_auth_code(p: dict) -> dict:
        return await login.code(p)

    async def h_auth_password(p: dict) -> dict:
        return await login.password(p)

    async def h_auth_logout(_p: dict) -> dict:
        need_lease()
        await login.cancel()
        await runtime.logout()
        return {"ok": True}

    async def h_status(_p: dict) -> dict:
        return build_status(runtime, calls, udp_state["ok"])

    async def h_resolve(p: dict) -> dict:
        need_tg()
        return await runtime.resolve_contact(p)

    async def h_binding(p: dict) -> dict:
        try:
            binding.expect(str(p.get("employeeId") or ""), str(p.get("codeHash") or ""),
                           str(p.get("expectedTgUserId") or ""), float(p.get("expiresAt") or 0))
        except (ValueError, TypeError):
            raise RpcError("bad_request")
        return {"ok": True}

    async def h_place(p: dict) -> dict:
        need_tg()
        return await calls.place(p)

    async def h_hangup(p: dict) -> dict:
        return await calls.hangup(p)

    async def h_incoming_config(p: dict) -> dict:
        v = p.get("open")
        if not isinstance(v, bool):
            raise RpcError("bad_request")
        if calls.open_incoming != v:
            log.info("Ochiq muloqot: %s", "yoqildi" if v else "o'chirildi")
        calls.open_incoming = v
        return {"ok": True, "open": v}

    async def h_udp(_p: dict) -> dict:
        r = await probe(cfg.stun_host, cfg.stun_port)
        udp_state["ok"] = bool(r.get("ok"))
        return r

    handlers = {
        "auth.start": h_auth_start, "auth.code": h_auth_code, "auth.password": h_auth_password,
        "auth.logout": h_auth_logout, "status": h_status, "contact.resolve": h_resolve,
        "binding.expect": h_binding, "call.place": h_place, "call.hangup": h_hangup, "udp.probe": h_udp,
        "incoming.config": h_incoming_config,
        "call.caption": lambda p: calls.caption(p), "call.video_rate": lambda p: calls.video_rate(p),
    }

    async def on_lost(reason: str) -> None:
        await login.cancel()
        await runtime.stop(reason)

    bridge = Bridge(
        cfg.backend_url, cfg.worker_id, key,
        on_rpc=lambda req: dispatch(handlers, req),
        on_audio=calls.on_backend_audio,
        on_authenticated=lambda: lease.on_authenticated(),
        on_down=lambda: lease.on_socket_down(),
        on_revoked=lambda lid: lease.on_revoked(lid),
    )
    lease = LeaseManager(call=lambda ev, data: bridge.call(ev, data), on_acquired=runtime.start, on_lost=on_lost)

    # Birinchi UDP tekshiruv (Telegram qo'ng'iroqlari uchun UDP chiqishi kerak)
    try:
        r = await probe(cfg.stun_host, cfg.stun_port)
        udp_state["ok"] = bool(r.get("ok"))
        log.info("UDP tekshiruv: %s", "OK" if r.get("ok") else f"MUAMMO ({r.get('details')})")
    except Exception:
        pass

    log.info("tgcall-worker %s ishga tushdi (worker: %s)", __version__, cfg.worker_id)
    stop = asyncio.Event()

    def _sig(*_a) -> None:
        stop.set()

    try:
        loop = asyncio.get_running_loop()
        for s in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(s, _sig)
    except (NotImplementedError, AttributeError, RuntimeError):
        pass  # Windows — Ctrl+C KeyboardInterrupt orqali

    tasks = [
        asyncio.ensure_future(bridge.run()),
        asyncio.ensure_future(lease.run()),
        asyncio.ensure_future(health_loop(lambda: build_status(runtime, calls, udp_state["ok"]), emit, lambda: bridge.authed)),
    ]
    try:
        await stop.wait()
    finally:
        log.info("to'xtatilmoqda...")
        lease.stop()
        try:
            await asyncio.wait_for(runtime.stop("shutdown"), timeout=15)
        except Exception:
            pass
        try:
            await asyncio.wait_for(lease.release(), timeout=5)
        except Exception:
            pass
        await bridge.stop()
        for t in tasks:
            t.cancel()
    return 0


def main() -> None:
    try:
        code = asyncio.run(amain())
    except KeyboardInterrupt:
        code = 0
    sys.exit(code)


if __name__ == "__main__":
    main()
