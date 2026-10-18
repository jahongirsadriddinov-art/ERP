import asyncio
import io

import numpy as np
from PIL import Image

from app.avatar.premium import LOOKS, OrbRenderer, PersonRenderer, get_renderer, normalize_look
from app.avatar.state import FaceParams
from app.avatar.face import i420_size
from app.vision import i420_to_jpeg, video_frame


def _i420(w, h, y=120, u=128, v=128):
    cw, ch = (w + 1) // 2, (h + 1) // 2
    return bytes([y]) * (w * h) + bytes([u]) * (cw * ch) + bytes([v]) * (cw * ch)


def test_i420_to_jpeg_size_rotation_and_header():
    data = _i420(320, 240)
    jpg = i420_to_jpeg(data, 320, 240, 90)
    im = Image.open(io.BytesIO(jpg))
    assert im.size == (240, 320)             # 90° burilgan
    big = i420_to_jpeg(_i420(1280, 720), 1280, 720)
    assert max(Image.open(io.BytesIO(big)).size) == 640
    fr = video_frame("0123456789ab0123456789ab-0000-0000"[:0] or "01234567-89ab-0123-4567-89ab00000000", jpg)
    assert fr[16:20] == b"\x00\x00\x00\x00" and fr[20:22] == b"\xff\xd8"


def test_i420_odd_size_and_short_frame():
    jpg = i420_to_jpeg(_i420(321, 241), 321, 241)
    assert Image.open(io.BytesIO(jpg)).size == (321, 241)
    try:
        i420_to_jpeg(b"\x00" * 10, 320, 240)
        assert False
    except ValueError:
        pass


def test_premium_looks_render_valid_frames():
    for lk in LOOKS:
        r = get_renderer(lk, 320)
        assert isinstance(r, OrbRenderer if lk == "orb" else PersonRenderer)
        for p in (FaceParams(t=1), FaceParams(t=2, mouth_open=0.8, smile=0.7, blink=1.0, tilt_deg=4, caption=("Salom",))):
            im = r.render(p)
            assert im.size == (320, 320) and im.mode == "RGB"
            assert len(r.render_i420(p)) == i420_size(320, 320)
    assert normalize_look("xyz") == "female" and get_renderer("female", 320) is get_renderer("female", 320)


def test_mouth_moves_on_person():
    r = get_renderer("male", 320)
    a = np.asarray(r.render(FaceParams(t=1, mouth_open=0.0)), dtype=np.int16)
    b = np.asarray(r.render(FaceParams(t=1, mouth_open=0.9)), dtype=np.int16)
    assert np.abs(a - b).sum() > 1000


def test_calls_on_video_throttles_and_sends():
    from app.calls import ActiveCall, CallManager

    sent = []

    class Eng:
        ready = True

    async def emit(_):
        pass

    async def up(_):
        pass

    async def sv(b):
        sent.append(b)

    cm = CallManager(Eng(), emit, up, send_video=sv)
    c = ActiveCall(session_id="0123456789abcdef01234567", user_id=5, frame_uuid="01234567-89ab-cdef-0123-456700000000",
                   timeout_sec=30, max_duration_sec=60)
    c.state = "connected"
    cm.active = c

    async def go():
        await cm.on_video(5, _i420(64, 48), 64, 48)
        await cm.on_video(5, _i420(64, 48), 64, 48)      # 1 s ichida — tashlanadi
        await cm.on_video(6, _i420(64, 48), 64, 48)      # boshqa foydalanuvchi — e'tiborsiz
        await cm.video_rate({"sessionId": c.session_id, "fps": 8, "forSec": 5})
        assert c.video_fps == 8

    asyncio.run(go())
    assert len(sent) == 1 and sent[0][20:22] == b"\xff\xd8"
