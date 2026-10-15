"""Telegram qatlami: Telethon + py-tgcalls. FAQAT lease bo'lganda ishga tushadi (lease.py).

  • sessiya — session_store (shifrlangan, faqat shu diskda);
  • kiruvchi qo'ng'iroqlar darhol "band" deb rad etiladi (A3);
  • DM'lar AI'ga uzatilmaydi — faqat bog'lash kodi tekshiriladi (binding.py), boshqasi e'tiborsiz;
  • kontakt aniqlash tartibi (A2): kesh → @username → (ruxsat bo'lsa) bitta importContacts, faqat id mos bo'lsa.
"""
from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any, Awaitable, Callable, Optional

from . import __version__
from .binding import BindingMatcher
from .errors import discard_reason_name, flood_seconds, map_call_error
from .session_store import SessionStore, SessionStoreError

log = logging.getLogger("tgw.tg")

EmitFn = Callable[[dict], Awaitable[Any]]


def _type_name(o: Any) -> str:
    return type(o).__name__


async def handle_phone_call_update(rt: "TelegramRuntime", pc: Any) -> None:
    """Raw UpdatePhoneCall ishlovchisi (testlar soxta obyektlar bilan chaqiradi — sinf nomi bo'yicha)."""
    name = _type_name(pc)
    if name == "PhoneCallRequested":
        # A3: kiruvchi qo'ng'iroq — darhol rad (busy). Hech qachon javob berilmaydi.
        await rt.discard_raw(pc.id, pc.access_hash, busy=True)
        rt.incoming_discarded += 1
        log.info("kiruvchi qo'ng'iroq rad etildi")
        return
    if name in ("PhoneCallWaiting", "PhoneCallAccepted", "PhoneCall"):
        uid = int(getattr(pc, "participant_id", 0) or 0)
        if uid:
            rt.call_users[pc.id] = (uid, pc.access_hash)
        if name == "PhoneCallWaiting" and getattr(pc, "receive_date", None) and rt.calls:
            await rt.calls.on_ringing(uid)
        return
    if name == "PhoneCallDiscarded":
        entry = rt.call_users.pop(pc.id, None)
        if entry and rt.calls:
            rt.calls.on_discarded(entry[0], discard_reason_name(getattr(pc, "reason", None)))


async def handle_private_message(rt: "TelegramRuntime", sender_id: int, text: str, username: Optional[str]) -> bool:
    """DM: faqat bog'lash kodi. True — mos keldi (binding.matched yuborildi)."""
    emp = rt.binding.match(sender_id, text or "")
    if not emp:
        return False
    ev = {"type": "binding.matched", "employeeId": emp, "tgUserId": str(sender_id), "at": int(time.time() * 1000)}
    if username:
        ev["username"] = username
    await rt.emit(ev)
    log.info("bog'lash kodi mos keldi")
    return True


class TelegramRuntime:
    def __init__(self, cfg: Any, store: SessionStore, emit: EmitFn, binding: BindingMatcher):
        self.cfg = cfg
        self.store = store
        self.emit = emit
        self.binding = binding
        self.calls = None            # CallManager (main.py ulaydi)
        self.client = None
        self.pytg = None
        self.me_id: Optional[int] = None
        self.username: Optional[str] = None
        self.display_name: Optional[str] = None
        self.call_users: dict[int, tuple[int, int]] = {}
        self.incoming_discarded = 0
        self.last_error: Optional[str] = None
        self._lock = asyncio.Lock()
        self._ap = None

    # ── holat ──
    @property
    def ready(self) -> bool:
        return self.client is not None and self.pytg is not None and self.me_id is not None

    def make_client(self, session: Optional[str]):
        from telethon import TelegramClient
        from telethon.sessions import StringSession
        return TelegramClient(
            StringSession(session or None), self.cfg.api_id, self.cfg.api_hash,
            device_model="QurilishERP AI", system_version="Windows", app_version=__version__,
            lang_code="uz", system_lang_code="uz", receive_updates=True,
        )

    # ── ishga tushirish / to'xtatish ──
    async def start(self) -> None:
        async with self._lock:
            if self.client is not None:
                return
            try:
                s = self.store.load()
            except SessionStoreError as e:
                self.last_error = "session_key_mismatch"
                log.error("%s — Dasturchi panelidan qayta kiring", e)
                return
            if not s:
                self.last_error = "no_session"
                log.info("Telegram sessiyasi yo'q — Dasturchi panelidan kiring (telefon -> kod)")
                return
            await self._start_with(s)

    async def _start_with(self, session: str) -> None:
        client = self.make_client(session)
        await client.connect()
        if not await client.is_user_authorized():
            await client.disconnect()
            self.last_error = "not_authorized"
            log.warning("Telegram sessiyasi bekor qilingan — qayta kirish kerak")
            return
        me = await client.get_me()
        from telethon import events, types
        from pytgcalls import PyTgCalls, filters
        from pytgcalls.types import ChatUpdate, Device, Direction, StreamFrames
        from pytgcalls.types.raw import AudioParameters

        self._ap = AudioParameters(bitrate=48000, channels=1)

        async def on_raw(update):
            try:
                await handle_phone_call_update(self, update.phone_call)
            except Exception as e:
                log.debug("raw phone call: %s", type(e).__name__)

        async def on_dm(event):
            try:
                if not event.is_private or event.out:
                    return
                sender = await event.get_sender()
                if getattr(sender, "bot", False):
                    return
                await handle_private_message(self, int(event.sender_id), event.raw_text or "", getattr(sender, "username", None))
            except Exception as e:
                log.debug("dm: %s", type(e).__name__)

        client.add_event_handler(on_raw, events.Raw(types.UpdatePhoneCall))
        client.add_event_handler(on_dm, events.NewMessage(incoming=True))

        pytg = PyTgCalls(client)

        @pytg.on_update(filters.stream_frame(Direction.INCOMING, Device.MICROPHONE | Device.SPEAKER))
        async def on_frames(_, u: StreamFrames):
            if self.calls:
                await self.calls.on_frames(int(u.chat_id), [f.frame for f in u.frames])

        @pytg.on_update(filters.chat_update(ChatUpdate.Status.INCOMING_CALL))
        async def on_incoming(_, u: ChatUpdate):
            # pytgcalls holatini ham tozalash (raw ishlovchi allaqachon rad etgan)
            try:
                await pytg.leave_call(u.chat_id)
            except Exception:
                pass

        try:
            await pytg.start()
        except BaseException:
            try:
                await client.disconnect()
            finally:
                raise
        self.client, self.pytg = client, pytg
        self.me_id = int(me.id)
        self.username = getattr(me, "username", None)
        self.display_name = " ".join(x for x in [getattr(me, "first_name", None), getattr(me, "last_name", None)] if x) or None
        self.last_error = None
        log.info("Telegram ulandi")

    async def stop(self, reason: str = "stop") -> None:
        """Telethon uziladi va sessiya xotiradan tashlanadi (lease yo'qolganda — A4)."""
        async with self._lock:
            await self._stop_locked(reason)

    async def _stop_locked(self, reason: str) -> None:
        if self.calls:
            try:
                await self.calls.shutdown("network")
            except Exception:
                pass
        pytg, client = self.pytg, self.client
        self.pytg = self.client = None
        self.me_id = None
        self.call_users.clear()
        if pytg is not None:
            try:
                pytg.executor.shutdown(wait=False)
            except Exception:
                pass
        if client is not None:
            try:
                await asyncio.wait_for(client.disconnect(), timeout=10)
            except Exception:
                pass
            # Mijoz (va undagi StringSession) havolasi tashlanadi — xotirada qolmaydi
            log.info("Telegram uzildi (%s)", reason)

    async def adopt_session(self, session: str) -> None:
        """Login muvaffaqiyatli: sessiya shifrlab saqlanadi va asosiy mijoz ishga tushadi."""
        self.store.save(session)
        async with self._lock:
            await self._stop_locked("relogin")
            await self._start_with(session)

    async def logout(self) -> None:
        async with self._lock:
            client = self.client
            if client is not None:
                try:
                    await asyncio.wait_for(client.log_out(), timeout=15)
                except Exception:
                    pass
            await self._stop_locked("logout")
            self.store.clear()
            self.username = self.display_name = None

    # ── Engine (calls.py) ──
    async def has_peer(self, user_id: int) -> bool:
        if not self.client:
            return False
        try:
            await self.client.get_input_entity(user_id)
            return True
        except (ValueError, TypeError):
            return False

    async def play(self, user_id: int, timeout_sec: int) -> None:
        from pytgcalls.types import CallConfig, ExternalMedia, MediaStream
        await self.pytg.play(
            user_id,
            MediaStream(ExternalMedia.AUDIO, self._ap, video_flags=MediaStream.Flags.IGNORE),
            CallConfig(timeout=int(timeout_sec)),
        )

    async def record(self, user_id: int) -> None:
        from pytgcalls.types import RecordStream
        await self.pytg.record(user_id, RecordStream(True, self._ap))

    async def send_frame(self, user_id: int, pcm48: bytes) -> None:
        from pytgcalls.types import Device
        await self.pytg.send_frame(user_id, Device.MICROPHONE, pcm48)

    async def hangup(self, user_id: int) -> None:
        if self.pytg is None:
            return
        try:
            await self.pytg.leave_call(user_id)
            return
        except Exception:
            pass
        # pytgcalls qo'ng'iroqni bilmaydi (bekor qilingan terish) — raw discard
        for cid, (uid, ah) in list(self.call_users.items()):
            if uid == user_id:
                await self.discard_raw(cid, ah, busy=False)

    async def discard_raw(self, call_id: int, access_hash: int, busy: bool) -> None:
        if not self.client:
            return
        from telethon.tl import functions, types
        reason = types.PhoneCallDiscardReasonBusy() if busy else types.PhoneCallDiscardReasonHangup()
        try:
            await self.client(functions.phone.DiscardCallRequest(
                peer=types.InputPhoneCall(id=call_id, access_hash=access_hash),
                duration=0, reason=reason, connection_id=0, video=False,
            ))
        except Exception as e:
            log.debug("discard: %s", type(e).__name__)

    # ── contact.resolve (A2) ──
    async def resolve_contact(self, p: dict) -> dict:
        from .errors import RpcError
        if not self.client:
            raise RpcError("not_connected")
        try:
            expected = int(str(p.get("expectedTgUserId") or "0"))
        except ValueError:
            raise RpcError("bad_request")
        if expected <= 0:
            raise RpcError("bad_request")
        try:
            # 1) kesh / dialoglar (xodim akkauntga yozgan bo'lsa — access_hash bor)
            if await self.has_peer(expected):
                return {"status": "resolved", "tgUserId": str(expected)}
            # 2) @username
            un = str(p.get("username") or "").lstrip("@")
            if un:
                try:
                    ent = await self.client.get_entity(un)
                    if int(getattr(ent, "id", 0)) == expected:
                        return {"status": "resolved", "tgUserId": str(expected)}
                    return {"status": "mismatch"}
                except (ValueError, TypeError):
                    pass
            # 3) faqat ruxsat bo'lsa va bitta: importContacts (id mos kelishi SHART)
            phone = str(p.get("phone") or "")
            if p.get("allowImport") is True and phone:
                from telethon.tl import functions, types
                res = await self.client(functions.contacts.ImportContactsRequest([
                    types.InputPhoneContact(client_id=random.randint(1, 2**31 - 1), phone=phone, first_name="ERP", last_name="xodim"),
                ]))
                users = list(getattr(res, "users", []) or [])
                match = any(int(u.id) == expected for u in users)
                if users:
                    try:
                        await self.client(functions.contacts.DeleteContactsRequest(id=users))
                    except Exception:
                        pass
                if match:
                    return {"status": "resolved", "tgUserId": str(expected)}
                return {"status": "mismatch" if users else "not_found"}
            return {"status": "not_found"}
        except Exception as e:
            fs = flood_seconds(e)
            if fs:
                if self.calls:
                    self.calls.flood_wait_until_ms = max(self.calls.flood_wait_until_ms, time.time() * 1000 + fs * 1000)
                return {"status": "flood_wait", "retryAfterSec": fs}
            if map_call_error(e) == "privacy":
                return {"status": "privacy_restricted"}
            log.debug("resolve: %s", type(e).__name__)
            return {"status": "not_found"}
