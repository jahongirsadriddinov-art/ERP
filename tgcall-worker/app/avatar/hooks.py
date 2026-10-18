"""calls.py uchun ulanish nuqtasi: video qo'ng'iroqda avatar oqimini yoqish/o'chirish.

Rejim (env AVATAR_VIDEO): 'auto' (standart — faqat Telegram VIDEO qo'ng'iroqda yoki backend
'video': true so'rasa), 'always' (har qanday ulangan qo'ng'iroqda), 'off'.
Video qo'ng'iroqni aniqlash: Telethon UpdatePhoneCall(.video) — tg.py'ga tegmasdan qo'shimcha ishlovchi.
Engine'da enable_video/send_video_frame/is_video_call bo'lsa — o'shalar ishlatiladi (kelajak uchun).

pytgcalls 3.0: mavjud p2p qo'ng'iroqda pytg.play() → set_stream_sources(CAPTURE, ...) — oqim almashadi;
kamera manbai ExternalMedia.VIDEO, kadr send_frame(Device.CAMERA, I420, Frame.Info(width, height)).
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Optional

from .streamer import AvatarStreamer

log = logging.getLogger("tgw.avatar")

DETECT_WAIT_S = 3.0
AUDIO_GRACE_S = 1.5        # oqim almashayotganda audio yuborish xatosi qo'ng'iroqni uzmasin
_VIDEO_TTL_S = 120.0      # belgi faqat joriy qo'ng'iroq uchun kerak


def mode() -> str:
    m = os.environ.get("AVATAR_VIDEO", "auto").strip().lower()
    return m if m in ("auto", "always", "off") else "auto"


def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.environ.get(name, "") or default)))
    except ValueError:
        return default


# ── Video qo'ng'iroqlarni kuzatish (Telethon raw) ──
class VideoCallTracker:
    def __init__(self):
        self._users: dict[int, float] = {}
        self._client_id: Optional[int] = None

    def mark(self, user_id: int) -> None:
        self._users[int(user_id)] = time.monotonic()

    def forget(self, user_id: int) -> None:
        self._users.pop(int(user_id), None)

    def is_video(self, user_id: int) -> bool:
        t = self._users.get(int(user_id))
        return t is not None and time.monotonic() - t < _VIDEO_TTL_S

    def on_phone_call(self, pc: Any, me_id: Optional[int]) -> None:
        if not getattr(pc, "video", False) or type(pc).__name__ == "PhoneCallDiscarded":
            return
        ids = {getattr(pc, "admin_id", None), getattr(pc, "participant_id", None)}
        for uid in ids:
            if isinstance(uid, int) and uid > 0 and uid != me_id:
                self.mark(uid)

    def attach(self, engine: Any) -> None:
        client = getattr(engine, "client", None)
        if client is None or id(client) == self._client_id:
            return
        try:
            from telethon import events, types
        except Exception:  # pragma: no cover
            return

        async def _on_raw(update) -> None:
            try:
                self.on_phone_call(update.phone_call, getattr(engine, "me_id", None))
            except Exception:
                pass

        try:
            client.add_event_handler(_on_raw, events.Raw(types.UpdatePhoneCall))
            self._client_id = id(client)
        except Exception as e:
            log.debug("video kuzatuvchi ulanmadi: %s", type(e).__name__)


tracker = VideoCallTracker()


def watch(engine: Any) -> None:
    """place()/on_incoming() boshida — video belgisi o'tkazib yuborilmasin."""
    if mode() != "off":
        tracker.attach(engine)


def _engine_is_video(engine: Any, user_id: int) -> bool:
    fn = getattr(engine, "is_video_call", None)
    if fn is not None:
        try:
            return bool(fn(user_id))
        except Exception:
            return False
    return tracker.is_video(user_id)


async def enable_video(engine: Any, user_id: int, size: int, fps: int) -> None:
    fn = getattr(engine, "enable_video", None)
    if fn is not None:
        await fn(user_id, size, size, fps)
        return
    from pytgcalls.types import ExternalMedia, MediaStream
    from pytgcalls.types.raw import VideoParameters
    pytg = getattr(engine, "pytg", None)
    ap = getattr(engine, "_ap", None)
    if pytg is None or ap is None:
        raise RuntimeError("NO_ENGINE")
    await pytg.play(user_id, MediaStream(ExternalMedia.AUDIO | ExternalMedia.VIDEO, ap,
                                         VideoParameters(size, size, fps, adjust_by_height=False)))


def make_sender(engine: Any, user_id: int):
    fn = getattr(engine, "send_video_frame", None)
    if fn is not None:
        async def send_custom(data: bytes, w: int, h: int) -> None:
            await fn(user_id, data, w, h)
        return send_custom
    from pytgcalls.types import Device, Frame

    async def send(data: bytes, w: int, h: int) -> None:
        await engine.pytg.send_frame(user_id, Device.CAMERA, data,
                                     Frame.Info(capture_time=int(time.time() * 1000), width=w, height=h))
    return send


class AvatarSession:
    """Bitta qo'ng'iroq uchun: video kerakligini aniqlaydi, oqimni yoqadi, ovoz/subtitrni uzatadi."""

    def __init__(self, engine: Any, user_id: int, want_video: bool = False, look: str = ""):
        self.engine = engine
        self.look = look
        self.user_id = int(user_id)
        self.want_video = bool(want_video)
        # Telegram p2p video: ko'pi bilan 720p / 30 kadr/s. Standart 640 / 30 (sekin CPU'da streamer o'zi pasaytiradi)
        self.size = _int_env("AVATAR_SIZE", 640, 160, 720) // 2 * 2
        self.fps = _int_env("AVATAR_FPS", 30, 5, 30)
        self.subtitles = False
        self.streamer: Optional[AvatarStreamer] = None
        self.active = False
        self._grace_until = 0.0
        self._task: Optional[asyncio.Task] = None
        self._pending_caption: Optional[tuple[str, Optional[str]]] = None

    def start(self) -> None:
        self._task = asyncio.ensure_future(self._main())

    async def _decide(self) -> bool:
        m = mode()
        if m == "off":
            return False
        if m == "always" or self.want_video:
            return True
        # Owner 2026-10-18: oddiy qo'ng'iroqda ham suhbatdosh kamerasini YOQSA — avatar ham yoqiladi.
        # Shuning uchun butun qo'ng'iroq davomida kutamiz (stop() bekor qiladi); boshida tez, keyin sekinroq.
        t0 = time.monotonic()
        while True:
            if _engine_is_video(self.engine, self.user_id):
                return True
            await asyncio.sleep(0.25 if time.monotonic() - t0 < DETECT_WAIT_S else 0.5)

    async def _main(self) -> None:
        try:
            if not await self._decide():
                return
            from .premium import get_renderer
            # Renderer qurilishi (~0.3 s) audio siklini to'xtatmasin — alohida oqimda
            renderer = await asyncio.get_running_loop().run_in_executor(None, get_renderer, self.look, self.size)
            self.streamer = AvatarStreamer(make_sender(self.engine, self.user_id), size=self.size, fps=self.fps, renderer=renderer)
            self.streamer.state.show_captions = self.subtitles
            if self._pending_caption:
                self.streamer.set_caption(*self._pending_caption)
            self._grace_until = time.monotonic() + 30.0
            try:
                await enable_video(self.engine, self.user_id, self.size, self.fps)
            finally:
                self._grace_until = time.monotonic() + AUDIO_GRACE_S
            self.active = True
            log.info("avatar video yoqildi (%dx%d, %d fps)", self.size, self.size, self.fps)
            await self.streamer.run()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.info("avatar video yoqilmadi: %s", type(e).__name__)
        finally:
            self.active = False

    # ── calls.py chaqiradi ──
    def tolerate_audio_error(self) -> bool:
        return time.monotonic() < self._grace_until

    def feed_audio(self, pcm48: bytes) -> None:
        if self.streamer is not None:
            self.streamer.feed_audio(pcm48)

    def feed_user_audio(self, pcm48: bytes) -> None:
        if self.streamer is not None:
            self.streamer.feed_user_audio(pcm48)

    def set_activity(self, tool: str, phase: str, status: str = "") -> None:
        if self.streamer is not None:
            self.streamer.state.set_activity(tool, phase, status)

    def set_subtitles(self, on: bool) -> None:
        self.subtitles = bool(on)
        if self.streamer is not None:
            self.streamer.state.show_captions = self.subtitles

    def set_caption(self, text: str, emotion: Optional[str] = None) -> None:
        if self.streamer is not None:
            self.streamer.set_caption(text, emotion)
        else:
            self._pending_caption = (text, emotion)

    async def stop(self) -> None:
        if self.streamer is not None:
            self.streamer.stop()
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout=2)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                pass
        tracker.forget(self.user_id)


def start_for_call(engine: Any, user_id: int, want_video: bool = False, look: str = "") -> Optional[AvatarSession]:
    if mode() == "off":
        return None
    s = AvatarSession(engine, user_id, want_video, look)
    s.start()
    return s
