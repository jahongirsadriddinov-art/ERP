import asyncio
import io

import numpy as np
from PIL import Image

from app.avatar.emoji3d import EmojiRenderer, TOOL_LOOK
from app.avatar.premium import LOOKS, OrbRenderer, get_renderer, normalize_look
from app.avatar.real3d import RealRenderer
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
        assert isinstance(r, OrbRenderer if lk == "orb" else RealRenderer)
        for p in (FaceParams(t=1), FaceParams(t=2, mouth_open=0.8, smile=0.7, blink=1.0, tilt_deg=4, caption=("Salom",))):
            im = r.render(p)
            assert im.size == (320, 320) and im.mode == "RGB"
            assert len(r.render_i420(p)) == i420_size(320, 320)
    assert normalize_look("xyz") == "female" and get_renderer("female", 320) is get_renderer("female", 320)


def test_emoji_avatar_reacts_to_voice_and_activity():
    r = EmojiRenderer("male", 320)
    a = np.asarray(r.render(FaceParams(t=20, mouth_open=0.0, stream_age=20)), dtype=np.int16)
    b = np.asarray(r.render(FaceParams(t=20.3, mouth_open=0.9, viseme="A", stream_age=20.3)), dtype=np.int16)
    assert np.abs(a - b).sum() > 1000                       # gapirganda harakat + ovoz to'lqini
    assert r.choose(FaceParams(t=1, stream_age=1)) == ("wave", "")
    assert r.choose(FaceParams(t=30, stream_age=30, activity="searchWeb", activity_phase="start")) == ("detective", "globe")
    assert r.choose(FaceParams(t=30, stream_age=30, activity="getWeather", activity_phase="end", activity_status="ok", activity_age=0.5)) == ("ok", "done")
    assert r.choose(FaceParams(t=30, stream_age=30, activity="x", activity_phase="end", activity_status="error", activity_age=0.5)) == ("shrug", "question")
    assert r.choose(FaceParams(t=30, stream_age=30, emotion="thinking")) == ("office", "thinking")
    assert r.choose(FaceParams(t=30, stream_age=30, emotion="concerned")) == ("sad", "")
    assert TOOL_LOOK["getExchangeRate"] == ("explain", "dollar")


def test_state_activity_window():
    from app.avatar.state import AvatarState

    class Clk:
        t = 0.0

        def __call__(self):
            return self.t

    c = Clk()
    st = AvatarState(c, seed=1)
    st.set_activity("searchWeb", "start")
    c.t = 2
    p = st.params()
    assert p.activity == "searchWeb" and p.activity_phase == "start"
    st.set_activity("searchWeb", "end", "ok")
    c.t = 3
    assert st.params().activity_status == "ok"
    c.t = 9
    assert st.params().activity == ""


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


def test_real3d_frames_follow_voice_emotion_and_activity():
    r = RealRenderer("female", 320)
    assert len(r.frames) == 40
    assert r.choose(FaceParams(t=1, stream_age=1))[0] == "happy_rest_open"            # salom — tabassum
    assert r.choose(FaceParams(t=20, stream_age=20, mouth_open=0.8, viseme="A"))[0] == "neutral_A_open"
    assert r.choose(FaceParams(t=20, stream_age=20, mouth_open=0.35, viseme="O"))[0] == "neutral_U_open"
    assert r.choose(FaceParams(t=20, stream_age=20, blink=1.0))[0] == "neutral_rest_closed"
    assert r.choose(FaceParams(t=20, stream_age=20, emotion="concerned"))[0] == "concerned_rest_open"
    assert r.choose(FaceParams(t=20, stream_age=20, activity="searchWeb", activity_phase="start")) == ("thinking_rest_open", "globe")
    a = np.asarray(r.render(FaceParams(t=20, stream_age=20)), dtype=np.int16)
    b = np.asarray(r.render(FaceParams(t=21, stream_age=21, mouth_open=0.9, viseme="A")), dtype=np.int16)
    assert np.abs(a - b).sum() > 1000
