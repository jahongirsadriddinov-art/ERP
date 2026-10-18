"""Avatar video oqimi: har 1/fps soniyada kadr chizadi (alohida oqimda) va yuboradi.

Holat (AvatarState) asyncio oqimida yangilanadi; renderer'ga faqat o'zgarmas FaceParams beriladi.
Yuborish xatosi qo'ng'iroq audiosiga ta'sir qilmaydi — ketma-ket xatolarda video jim to'xtaydi.
"""
from __future__ import annotations

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Awaitable, Callable, Optional

from .state import AvatarState

log = logging.getLogger("tgw.avatar")

SendVideoFn = Callable[[bytes, int, int], Awaitable[None]]
MAX_SEND_ERRORS = 5


class AvatarStreamer:
    def __init__(self, send_video: SendVideoFn, size: int = 480, fps: int = 15,
                 clock: Callable[[], float] = time.monotonic, seed: Optional[int] = None,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep, renderer=None, look: str = "female"):
        self.size = size
        self.fps = max(5, min(30, int(fps)))
        self.max_fps = self.fps
        if renderer is None:
            from .premium import get_renderer
            renderer = get_renderer(look, size)
        self.renderer = renderer
        self.state = AvatarState(clock, seed=seed, paginate=self.renderer.subs.pages)
        self._send = send_video
        self._clock = clock
        self._sleep = sleep
        self._running = False
        self._pool: Optional[ThreadPoolExecutor] = None
        self.frames_sent = 0
        self.send_errors = 0
        self.render_ms_avg = 0.0

    # ── qo'ng'iroqdan kiruvchi ma'lumot ──
    def feed_audio(self, pcm48: bytes) -> None:
        self.state.feed_audio(pcm48)

    def feed_user_audio(self, pcm48: bytes) -> None:
        self.state.feed_user_audio(pcm48)

    def set_caption(self, text: str, emotion: Optional[str] = None) -> None:
        self.state.set_caption(text, emotion)

    def render_once(self) -> bytes:
        return self.renderer.render_i420(self.state.params())

    def stop(self) -> None:
        self._running = False

    async def run(self, max_frames: Optional[int] = None) -> None:
        self._running = True
        loop = asyncio.get_running_loop()
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="avatar")
        step = 1.0 / self.fps
        t0 = self._clock()
        n = 0
        errors_row = 0
        try:
            while self._running and (max_frames is None or self.frames_sent < max_frames):
                params = self.state.params()
                t_r = time.perf_counter()
                frame = await loop.run_in_executor(self._pool, self.renderer.render_i420, params)
                ms = (time.perf_counter() - t_r) * 1000
                self.render_ms_avg = ms if self.frames_sent == 0 else self.render_ms_avg * 0.9 + ms * 0.1
                if not self._running:
                    break
                try:
                    await self._send(frame, self.size, self.size)
                    errors_row = 0
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    self.send_errors += 1
                    errors_row += 1
                    if errors_row >= MAX_SEND_ERRORS:
                        log.info("avatar video to'xtadi: %s", type(e).__name__)
                        break
                self.frames_sent += 1
                n += 1
                delay = t0 + n * step - self._clock()
                if delay < -0.5:          # kompyuter sekinlashdi — jadval qayta boshlanadi
                    t0, n, delay = self._clock(), 0, 0.0
                # Moslashuvchan FPS: chizish kadr vaqtining 85% dan oshsa — tezlik pasayadi (≥12), bo'shasa — qaytadi
                if self.frames_sent and self.frames_sent % 30 == 0:
                    budget = 1000.0 / self.fps
                    if self.render_ms_avg > budget * 0.85 and self.fps > 12:
                        self.fps = max(12, self.fps - 4)
                    elif self.render_ms_avg < budget * 0.45 and self.fps < self.max_fps:
                        self.fps = min(self.max_fps, self.fps + 2)
                    if step != 1.0 / self.fps:
                        step = 1.0 / self.fps
                        t0, n = self._clock(), 0
                await self._sleep(max(0.0, delay))
        finally:
            self._running = False
            self._pool.shutdown(wait=False, cancel_futures=True)
