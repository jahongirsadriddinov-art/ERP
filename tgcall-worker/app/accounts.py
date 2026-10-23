"""Bir nechta Telegram akkaunti (owner 2026-10-19): platforma akkaunti + har firmaning o'z akkauntlari.

Har akkaunt — alohida Telethon mijozi + py-tgcalls (TelegramRuntime), o'z CallManager'i (bir vaqtda 1 qo'ng'iroq)
va o'z LoginFlow'i. Sessiyalar alohida shifrlangan fayllarda: platforma — TG_SESSION_PATH, firma akkauntlari —
data/accounts/<id>.enc (o'sha TG_SESSION_KEY bilan). Backend akkauntlarni `accounts.sync` bilan bildiradi;
o'chirish faqat aniq `accounts.remove` bilan (bo'sh ro'yxat kelsa ham sessiyalar o'chmaydi).
"""
from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from .auth_flow import LoginFlow
from .binding import BindingMatcher
from .calls import CallManager
from .errors import RpcError, flood_seconds
from .fingerprint import fp_path
from .health import build_status
from .proxy import ProxyConfigError
from .session_store import SessionStore
from .tg import TelegramRuntime

log = logging.getLogger("tgw.accounts")

PLATFORM = ""
ACCOUNT_ID_RE = re.compile(r"^[0-9a-f]{24}$")
MAX_ACCOUNTS = 50

EmitFn = Callable[[dict], Awaitable[Any]]

# Qo'ng'iroq tugash sababi → akkaunt holati (anti-freeze: shu akkaunt chiquvchi ish uchun to'xtatiladi)
_CALL_REASON_STATE = {"spam_limited": "spam_limited", "account_frozen": "frozen"}
# DM: kutish shundan qisqa bo'lsa — rad etmasdan kutamiz (tabiiy "yozish" pauzasi)
DM_WAIT_MAX_S = 8


class Account:
    def __init__(self, acc_id: str, cfg: Any, store: SessionStore, emit: EmitFn, binding: BindingMatcher,
                 send_up: Callable[[bytes], Awaitable[None]], send_video: Callable[[bytes], Awaitable[None]],
                 ask_incoming: Callable[[dict], Awaitable[Any]], can_login: Callable[[], bool]):
        self.id = acc_id
        self.store = store
        self.runtime = TelegramRuntime(cfg, store, emit, binding)
        self.runtime.label = f"akkaunt …{acc_id[-4:]}" if acc_id else "platforma akkaunti"
        self.runtime.account_id = acc_id

        async def ask(data: dict):
            return await ask_incoming({**data, "account": acc_id} if acc_id else data)

        rt = self.runtime

        async def emit_call(ev: dict):
            # Qo'ng'iroq PEER_FLOOD/FROZEN bilan tugasa — akkaunt darhol cheklangan deb belgilanadi
            if ev.get("type") == "call.state" and ev.get("reason") in _CALL_REASON_STATE:
                rt.note_state(_CALL_REASON_STATE[ev["reason"]])
            return await emit(ev)

        self.calls = CallManager(self.runtime, emit_call, send_up, ask_incoming=ask, send_video=send_video)
        self.runtime.calls = self.calls
        # Firma akkaunti shu firma uchun ajratilgan — kiruvchi qo'ng'iroqlar doim backend qaroriga boradi
        if acc_id:
            self.calls.open_incoming = True
        self.login = LoginFlow(self._login_client, self.runtime.adopt_session, can_login)

    def _login_client(self):
        try:
            return self.runtime.make_client(None)
        except ProxyConfigError as e:
            raise RpcError("proxy_lib_missing" if str(e) == "proxy_lib_missing" else "proxy_invalid", "TG_PROXIES xato")

    # ── anti-freeze: chiquvchi qo'ng'iroq / DM shu yerdan o'tadi (holat + chegaralar) ──
    async def place(self, p: dict) -> dict:
        rt = self.runtime
        blocked = rt.health.blocked()
        if blocked:
            return {"accepted": False, "reason": blocked}
        try:
            uid = int(str(p.get("tgUserId") or "0"))
        except ValueError:
            uid = 0
        warm = True
        if uid > 0:
            warm = rt.is_warm(uid)
            lim = rt.usage.check("call", uid) or (None if warm else rt.usage.check("cold"))
            if lim:
                return {"accepted": False, "reason": lim[0], "retryAfterSec": lim[1]}
        res = await self.calls.place(p)
        if res.get("accepted") and uid > 0:
            rt.usage.take("call", uid)
            if not warm:
                rt.usage.take("cold")
        return res

    async def send_dm(self, uid: int, text: str) -> None:
        rt = self.runtime
        kind = "reply" if rt.usage.wrote_recently(uid) else "dm"
        blocked = rt.health.blocked()
        # Spam cheklovida ham o'zi yozgan odamga javob berish mumkin; muzlatilgan/bloklangan — hech narsa
        if blocked and not (blocked == "spam_limited" and kind == "reply"):
            raise RpcError(blocked)

        def limit():
            lim = rt.usage.check(kind, uid if kind == "dm" else None)
            if lim is None and kind == "dm" and not rt.is_warm(uid):
                lim = rt.usage.check("cold")
            return lim

        lim = limit()
        if lim and lim[0] == "rate_limited" and lim[1] <= DM_WAIT_MAX_S:
            await asyncio.sleep(lim[1])
            lim = limit()
        if lim:
            raise RpcError(lim[0], "Akkaunt chegarasi", lim[1])
        try:
            await rt.send_dm(uid, text)
        except RpcError:
            raise
        except Exception as e:
            fs = flood_seconds(e)
            if fs:
                rt.usage.flood(kind, fs)
                raise RpcError("flood_wait", "Telegram vaqtincha chekladi", fs)
            st = rt.health.blocked()
            if st:
                raise RpcError(st)
            raise RpcError("send_failed", type(e).__name__[:60])
        rt.usage.take(kind, uid if kind == "dm" else None)
        if kind == "dm" and not rt.is_warm(uid):
            rt.usage.take("cold")

    def antifreeze_status(self) -> dict:
        """Panel uchun: holat (ok/frozen/…), bugungi ishlatilish va chegaralar, qurilma izi, proksi turi."""
        rt = self.runtime
        out: dict = {"health": rt.health.to_dict()}
        if self.store.exists() or rt.ready:
            try:
                fp = rt.fingerprint
                out["device"] = f"{fp['device_model']} · {fp['system_version']} · TDesktop {fp['app_version']}"[:120]
                out["usage"] = rt.usage.snapshot()
            except Exception:
                pass
        if rt.proxy_desc:
            out["proxy"] = rt.proxy_desc
        return out

    def forget_files(self) -> None:
        """Akkaunt o'chirilganda: qurilma izi va hisoblagichlar ham (yangi raqam — yangi iz)."""
        p = Path(self.store.path)
        for f in (fp_path(p), p.with_name(p.stem + ".usage.json")):
            try:
                f.unlink()
            except OSError:
                pass

    @property
    def label(self) -> str:
        return f"firma akkaunti …{self.id[-4:]}" if self.id else "platforma akkaunti"

    def status(self) -> dict:
        st = build_status(self.runtime, self.calls, None)
        st.pop("version", None)
        st["id"] = self.id
        if not st.get("connected") and self.runtime.last_error:
            st["error"] = str(self.runtime.last_error)[:40]
        st.update(self.antifreeze_status())
        return st


class AccountSet:
    def __init__(self, make: Callable[[str, SessionStore], Account], platform_store: SessionStore, accounts_dir: Path,
                 session_key: str, holding: Callable[[], bool]):
        self._make = make
        self._dir = Path(accounts_dir)
        self._key = session_key
        self._holding = holding
        self.items: dict[str, Account] = {}
        self._add(PLATFORM, platform_store)

    @property
    def platform(self) -> Account:
        return self.items[PLATFORM]

    def all(self) -> list[Account]:
        return list(self.items.values())

    def get(self, p: dict) -> Account:
        acc_id = str((p or {}).get("account") or "")
        if not acc_id:
            return self.platform
        if not ACCOUNT_ID_RE.match(acc_id):
            raise RpcError("bad_request")
        a = self.items.get(acc_id)
        if a is None:
            raise RpcError("unknown_account", "Akkaunt workerda yo'q")
        return a

    def by_session(self, session_id: str) -> Account:
        sid = str(session_id or "")
        for a in self.items.values():
            c = a.calls.active
            if c is not None and c.session_id == sid:
                return a
        return self.platform

    def _add(self, acc_id: str, store: SessionStore) -> Account:
        a = self._make(acc_id, store)
        # Login muvaffaqiyatli bo'lgach — bir xil Telegram akkaunti ikki marta ulanmasin (dedupe)
        inner = a.login._on_success

        async def on_success(session: str) -> None:
            await inner(session)
            await self.dedupe()

        a.login._on_success = on_success
        self.items[acc_id] = a
        return a

    async def dedupe(self) -> int:
        """Bitta Telegram akkaunti ikki joyda ulangan bo'lsa (masalan platforma akkaunti firma akkaunti sifatida ham
        qo'shilgan) — ikkala sessiya bir qo'ng'iroqni oladi, biri "band" deb rad etadi va Telegram butun qo'ng'iroqni
        "busy" bilan tugatadi (owner 2026-10-19). Birinchisi (platforma, keyin qo'shilish tartibi) qoladi, qolgani to'xtaydi."""
        seen: dict[int, Account] = {}
        stopped = 0
        for a in self.all():
            me = a.runtime.me_id
            if not me:
                continue
            if me in seen:
                log.warning("%s — %s bilan bir xil Telegram akkaunt: ikkinchi sessiya to'xtatildi", a.label, seen[me].label)
                await a.runtime.stop("duplicate")
                a.runtime.last_error = "duplicate_account"
                stopped += 1
            else:
                seen[me] = a
        return stopped

    def _store(self, acc_id: str) -> SessionStore:
        return SessionStore(self._dir / f"{acc_id}.enc", self._key)

    async def sync(self, ids: list) -> dict:
        """Backend bilgan firma akkauntlari — yangilari yaratiladi (lease bo'lsa ishga tushadi). Olib tashlash yo'q."""
        added = 0
        for raw in list(ids or [])[:MAX_ACCOUNTS]:
            acc_id = str(raw or "")
            if not ACCOUNT_ID_RE.match(acc_id) or acc_id in self.items:
                continue
            if len(self.items) > MAX_ACCOUNTS:
                break
            a = self._add(acc_id, self._store(acc_id))
            added += 1
            if self._holding():
                await a.runtime.start()
                await self.dedupe()
        if added:
            log.info("firma akkauntlari: +%d (jami %d)", added, len(self.items) - 1)
        return {"ok": True, "accounts": len(self.items) - 1}

    async def remove(self, p: dict) -> dict:
        a = self.get(p)
        if not a.id:
            raise RpcError("bad_request", "Platforma akkauntini o'chirib bo'lmaydi")
        await a.login.cancel()
        await a.runtime.logout()
        a.store.clear()
        a.forget_files()
        self.items.pop(a.id, None)
        log.info("%s olib tashlandi", a.label)
        return {"ok": True}

    async def start_all(self) -> None:
        for a in self.all():
            try:
                await a.runtime.start()
            except Exception as e:
                log.warning("%s ishga tushmadi: %s", a.label, type(e).__name__)
        await self.dedupe()

    async def stop_all(self, reason: str) -> None:
        for a in self.all():
            try:
                await a.login.cancel()
            except Exception:
                pass
            try:
                await a.runtime.stop(reason)
            except Exception:
                pass

    def on_backend_audio(self, buf: bytes) -> None:
        # Kadr sarlavhasidagi sessiya UUID'i bo'yicha har CallManager o'zinikini oladi
        for a in self.all():
            a.calls.on_backend_audio(buf)

    def status(self, udp_ok: Optional[bool]) -> dict:
        p = self.platform
        st = build_status(p.runtime, p.calls, udp_ok)
        st["activeCalls"] = sum(a.calls.active_count for a in self.all())
        st["platformActiveCalls"] = p.calls.active_count
        st.update(p.antifreeze_status())
        if not st.get("connected") and p.runtime.last_error:
            st["error"] = str(p.runtime.last_error)[:40]
        others = [a.status() for a in self.all() if a.id]
        if others:
            st["accounts"] = others
        return st
