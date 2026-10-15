"""Audio: kadr formati, resampling (48k <-> 16k/24k) va 10 ms'lik ritmli yuboruvchi.

Kadr (backend contracts.ts bilan bir xil): [16 bayt UUID][u32 LE seq][PCM16LE ...].
UUID — sessionId (24 hex) + '00000000' (backend callBridge.sessionFrameUuid).
Faqat sarlavhali kadr (PCM yo'q, seq = 0xFFFFFFFF) — "buferni tozalash" (barge-in).
Telegram tomoni: 48 kHz mono PCM16LE, 10 ms = 960 bayt.
Backendga: 16 kHz, 40 ms'lik bo'laklar (soniyasiga 25 kadr — chegara 60).
Backenddan: 24 kHz.
"""
from __future__ import annotations

import asyncio
import re
import struct
import time
import uuid as uuidlib
from typing import Awaitable, Callable, Optional

import numpy as np

try:  # soxr — sifatli oqimli resampler; bo'lmasa chiziqli interpolyatsiya
    import soxr  # type: ignore
except Exception:  # pragma: no cover
    soxr = None

HEADER_BYTES = 20
FRAME_MAX_BYTES = 8 * 1024
FLUSH_SEQ = 0xFFFFFFFF
TG_RATE = 48000
IN_RATE = 16000    # backendga (STT/VAD)
OUT_RATE = 24000   # backenddan (TTS)
TG_FRAME_MS = 10
TG_FRAME_BYTES = TG_RATE * 2 * TG_FRAME_MS // 1000  # 960
UP_CHUNK_MS = 40
UP_CHUNK_BYTES = IN_RATE * 2 * UP_CHUNK_MS // 1000  # 1280

_SID_RE = re.compile(r"^[0-9a-fA-F]{24}$")


def session_frame_uuid(session_id: str) -> str:
    if not _SID_RE.match(session_id or ""):
        raise ValueError("BAD_SESSION_ID")
    return str(uuidlib.UUID(hex=(session_id + "00000000").lower()))


def encode_frame(frame_uuid: str, seq: int, pcm: bytes) -> bytes:
    if len(pcm) % 2:
        raise ValueError("ODD_PCM_LENGTH")
    return uuidlib.UUID(frame_uuid).bytes + struct.pack("<I", seq & 0xFFFFFFFF) + pcm


def flush_frame(frame_uuid: str) -> bytes:
    return uuidlib.UUID(frame_uuid).bytes + struct.pack("<I", FLUSH_SEQ)


def decode_frame(buf: bytes) -> Optional[tuple[str, int, bytes]]:
    """(uuid, seq, pcm) yoki None. Flush kadri: pcm == b'' va seq == FLUSH_SEQ."""
    if not isinstance(buf, (bytes, bytearray, memoryview)):
        return None
    b = bytes(buf)
    if len(b) < HEADER_BYTES or len(b) > FRAME_MAX_BYTES:
        return None
    pcm = b[HEADER_BYTES:]
    seq = struct.unpack("<I", b[16:20])[0]
    if not pcm and seq != FLUSH_SEQ:
        return None
    if len(pcm) % 2:
        return None
    return str(uuidlib.UUID(bytes=b[:16])), seq, pcm


def resample_once(pcm: bytes, src: int, dst: int) -> bytes:
    """Bir martalik (oqimsiz) resampling — testlar va qisqa bo'laklar uchun."""
    if src == dst or not pcm:
        return bytes(pcm)
    x = np.frombuffer(pcm[: len(pcm) - len(pcm) % 2], dtype=np.int16)
    if soxr is not None:
        y = soxr.resample(x, src, dst)
    else:
        n = int(round(len(x) * dst / src))
        y = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x.astype(np.float32)) if len(x) else x
    return np.clip(np.asarray(y), -32768, 32767).astype(np.int16).tobytes()


class StreamResampler:
    """Oqimli resampler (bo'laklar orasida holat saqlanadi — chertish/uzilish yo'q)."""

    def __init__(self, src: int, dst: int):
        self.src, self.dst = src, dst
        self._s = soxr.ResampleStream(src, dst, 1, dtype="int16") if (soxr is not None and src != dst) else None
        self._odd = b""

    def process(self, pcm: bytes) -> bytes:
        data = self._odd + bytes(pcm)
        self._odd = data[-1:] if len(data) % 2 else b""
        data = data[: len(data) - len(self._odd)]
        if not data:
            return b""
        if self.src == self.dst:
            return data
        if self._s is not None:
            return self._s.resample_chunk(np.frombuffer(data, dtype=np.int16)).astype(np.int16).tobytes()
        return resample_once(data, self.src, self.dst)


class Chunker:
    """Baytlarni teng bo'laklarga yig'adi (backendga 40 ms'lik kadrlar)."""

    def __init__(self, size: int):
        self.size = size
        self._buf = bytearray()

    def push(self, data: bytes) -> list[bytes]:
        self._buf.extend(data)
        out = []
        while len(self._buf) >= self.size:
            out.append(bytes(self._buf[: self.size]))
            del self._buf[: self.size]
        return out

    def clear(self) -> None:
        self._buf.clear()


class PacedSender:
    """Telegram'ga har 10 ms'da 960 baytlik kadr: navbat bo'sh bo'lsa — sukunat (silence fill).

    Drift tuzatish: kadrlar t0 + n*10 ms jadvaliga qarab yuboriladi; 200 ms'dan ko'p orqada qolsa
    (masalan kompyuter "qotib" qolgan) jadval qayta boshlanadi — to'plangan kadrlar bir zumda yuborilmaydi.
    """

    MAX_BUFFER_BYTES = TG_RATE * 2 * 60  # 60 s

    def __init__(
        self,
        send: Callable[[bytes], Awaitable[None]],
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self._send = send
        self._clock = clock
        self._sleep = sleep
        self._buf = bytearray()
        self._running = False
        self.frames_sent = 0
        self.silence_frames = 0
        self.resyncs = 0

    @property
    def buffered_ms(self) -> int:
        return len(self._buf) * 1000 // (TG_RATE * 2)

    def push(self, pcm48: bytes) -> None:
        self._buf.extend(pcm48)
        over = len(self._buf) - self.MAX_BUFFER_BYTES
        if over > 0:
            del self._buf[: over + (over % 2)]

    def flush(self) -> None:
        self._buf.clear()

    def stop(self) -> None:
        self._running = False

    def next_frame(self) -> bytes:
        if len(self._buf) >= TG_FRAME_BYTES:
            f = bytes(self._buf[:TG_FRAME_BYTES])
            del self._buf[:TG_FRAME_BYTES]
            return f
        if self._buf:
            f = bytes(self._buf).ljust(TG_FRAME_BYTES, b"\0")
            self._buf.clear()
            return f
        self.silence_frames += 1
        return b"\0" * TG_FRAME_BYTES

    async def run(self, max_frames: Optional[int] = None) -> None:
        self._running = True
        t0 = self._clock()
        n = 0
        step = TG_FRAME_MS / 1000
        while self._running and (max_frames is None or self.frames_sent < max_frames):
            await self._send(self.next_frame())
            self.frames_sent += 1
            n += 1
            delay = t0 + n * step - self._clock()
            if delay < -0.2:
                self.resyncs += 1
                t0, n = self._clock(), 0
                delay = 0
            await self._sleep(max(0.0, delay))
