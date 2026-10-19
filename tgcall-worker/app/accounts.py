"""Bir nechta Telegram akkaunti (owner 2026-10-19): platforma akkaunti + har firmaning o'z akkauntlari.

Har akkaunt — alohida Telethon mijozi + py-tgcalls (TelegramRuntime), o'z CallManager'i (bir vaqtda 1 qo'ng'iroq)
va o'z LoginFlow'i. Sessiyalar alohida shifrlangan fayllarda: platforma — TG_SESSION_PATH, firma akkauntlari —
data/accounts/<id>.enc (o'sha TG_SESSION_KEY bilan). Backend akkauntlarni `accounts.sync` bilan bildiradi;
o'chirish faqat aniq `accounts.remove` bilan (bo'sh ro'yxat kelsa ham sessiyalar o'chmaydi).
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from .auth_flow import LoginFlow
from .binding import BindingMatcher
from .calls import CallManager
from .errors import RpcError
from .health import build_status
from .session_store import SessionStore
from .tg import TelegramRuntime

log = logging.getLogger("tgw.accounts")

PLATFORM = ""
ACCOUNT_ID_RE = re.compile(r"^[0-9a-f]{24}$")
MAX_ACCOUNTS = 50

EmitFn = Callable[[dict], Awaitable[Any]]


class Account:
    def __init__(self, acc_id: str, cfg: Any, store: SessionStore, emit: EmitFn, binding: BindingMatcher,
                 send_up: Callable[[bytes], Awaitable[None]], send_video: Callable[[bytes], Awaitable[None]],
                 ask_incoming: Callable[[dict], Awaitable[Any]], can_login: Callable[[], bool]):
        self.id = acc_id
        self.store = store
        self.runtime = TelegramRuntime(cfg, store, emit, binding)

        async def ask(data: dict):
            return await ask_incoming({**data, "account": acc_id} if acc_id else data)

        self.calls = CallManager(self.runtime, emit, send_up, ask_incoming=ask, send_video=send_video)
        self.runtime.calls = self.calls
        # Firma akkaunti shu firma uchun ajratilgan — kiruvchi qo'ng'iroqlar doim backend qaroriga boradi
        if acc_id:
            self.calls.open_incoming = True
        self.login = LoginFlow(lambda: self.runtime.make_client(None), self.runtime.adopt_session, can_login)

    @property
    def label(self) -> str:
        return f"firma akkaunti …{self.id[-4:]}" if self.id else "platforma akkaunti"

    def status(self) -> dict:
        st = build_status(self.runtime, self.calls, None)
        st.pop("version", None)
        st["id"] = self.id
        if not st.get("connected") and self.runtime.last_error:
            st["error"] = str(self.runtime.last_error)[:40]
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
        others = [a.status() for a in self.all() if a.id]
        if others:
            st["accounts"] = others
        return st
