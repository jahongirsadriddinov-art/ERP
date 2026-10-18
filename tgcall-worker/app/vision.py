"""Suhbatdosh kamerasi (owner 2026-10-18): Telegram video qo'ng'irog'idagi kiruvchi I420 kadr → JPEG.

Backend kadrni Gemini Live'ga beradi (AI ko'radi) va "rasmga ol / videoga ol" uchun saqlaydi.
Odatda 1 kadr/s; videoga olishda backend 'call.video_rate' bilan vaqtincha ko'proq so'raydi.
Kodlash alohida oqimda (run_in_executor) — audio sikli to'xtamaydi.
"""
from __future__ import annotations

import io
import struct
import uuid as uuidlib

import numpy as np
from PIL import Image

MAX_SIDE = 640
JPEG_QUALITY = 72
MAX_JPEG_BYTES = 590 * 1024


def video_frame(frame_uuid: str, jpeg: bytes) -> bytes:
    """Backendga: 16 bayt kadr UUID + 4 bayt (0) + JPEG (audio kadri sarlavhasi bilan bir xil shakl)."""
    return uuidlib.UUID(frame_uuid).bytes + struct.pack("<I", 0) + jpeg


def i420_to_jpeg(data: bytes, w: int, h: int, rotation: int = 0, max_side: int = MAX_SIDE, quality: int = JPEG_QUALITY) -> bytes:
    if w <= 0 or h <= 0:
        raise ValueError("BAD_SIZE")
    cw, ch = (w + 1) // 2, (h + 1) // 2
    need = w * h + 2 * cw * ch
    if len(data) < need:
        raise ValueError("SHORT_FRAME")
    buf = np.frombuffer(data, dtype=np.uint8, count=need)
    y = buf[: w * h].reshape(h, w).astype(np.float32)
    u = buf[w * h: w * h + cw * ch].reshape(ch, cw).astype(np.float32) - 128.0
    v = buf[w * h + cw * ch:].reshape(ch, cw).astype(np.float32) - 128.0
    u = np.repeat(np.repeat(u, 2, axis=0), 2, axis=1)[:h, :w]
    v = np.repeat(np.repeat(v, 2, axis=0), 2, axis=1)[:h, :w]
    yy = (y - 16.0) * 1.164                              # BT.601 cheklangan diapazon (WebRTC)
    r = yy + 1.596 * v
    g = yy - 0.392 * u - 0.813 * v
    b = yy + 2.017 * u
    rgb = np.clip(np.dstack([r, g, b]), 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB")
    rot = int(getattr(rotation, "value", rotation) or 0)
    if rot in (90, 180, 270):
        img = img.rotate(-rot, expand=True)
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=quality, optimize=False)
    data_out = out.getvalue()
    if len(data_out) > MAX_JPEG_BYTES:
        out = io.BytesIO()
        img.save(out, "JPEG", quality=50)
        data_out = out.getvalue()
    return data_out
