"""Video avatar: kadr formati, lab sinxroni, ko'z qisish, kayfiyat, subtitr, CPU byudjeti, calls.py ulanishi."""
import asyncio
import math
import struct
import time

import numpy as np
import pytest
from PIL import Image

from app.avatar import emotion as E
from app.avatar import hooks as H
from app.avatar.face import FaceRenderer, i420_size, rgb_to_i420
from app.avatar.state import AvatarState, Blinker, EmotionBlend, FaceParams, pcm_features
from app.avatar.streamer import AvatarStreamer
from app.avatar.subtitles import SubtitleRenderer, clean_text, wrap_text


class Clock:
    def __init__(self, t=100.0):
        self.t = t

    def __call__(self):
        return self.t


def tone(freq=220.0, amp=0.5, ms=10, rate=48000):
    n = rate * ms // 1000
    x = (np.sin(2 * np.pi * freq * np.arange(n) / rate) * amp * 32767).astype(np.int16)
    return x.tobytes()


SILENCE = b"\0" * 960


# ── kadr ──
def test_frame_size_and_format():
    r = FaceRenderer(480)
    img = r.render(FaceParams())
    assert img.size == (480, 480) and img.mode == "RGB"
    buf = r.render_i420(FaceParams())
    assert len(buf) == i420_size(480, 480) == 345600


def test_i420_conversion_values():
    img = Image.new("RGB", (4, 4), (255, 255, 255))
    b = rgb_to_i420(img)
    assert len(b) == 24
    assert b[0] == 235 and b[16] == 128 and b[20] == 128       # oq: Y=235, U=V=128 (cheklangan diapazon)
    b = rgb_to_i420(Image.new("RGB", (2, 2), (0, 0, 0)))
    assert b[0] == 16
    with pytest.raises(ValueError):
        rgb_to_i420(Image.new("RGB", (3, 2)))


def test_mouth_region_changes_with_open():
    r = FaceRenderer(480)
    a = np.asarray(r.render(FaceParams(mouth_open=0.0)), dtype=np.int16)
    b = np.asarray(r.render(FaceParams(mouth_open=0.9, viseme="A")), dtype=np.int16)
    diff = np.abs(a - b).sum(axis=2) > 30
    ys, xs = np.nonzero(diff)
    assert len(ys) > 300
    assert 250 < ys.mean() < 330 and 200 < xs.mean() < 280       # o'zgarish og'iz atrofida


# ── lab sinxroni ──
def test_pcm_features():
    db_quiet, _ = pcm_features(SILENCE)
    db_loud, br_low = pcm_features(tone(200, 0.5))
    _, br_high = pcm_features(tone(9000, 0.5))
    assert db_quiet < -90 and db_loud > -12
    assert br_high > 0.5 > br_low


def test_lipsync_follows_audio_energy():
    clk = Clock()
    st = AvatarState(clk, seed=1)
    for _ in range(20):
        clk.t += 0.01
        st.feed_audio(SILENCE)
    assert st.params().mouth_open < 0.05
    for _ in range(15):
        clk.t += 0.01
        st.feed_audio(tone(300, 0.6))
    p_loud = st.params()
    assert p_loud.mouth_open > 0.5 and p_loud.viseme != "rest"
    for _ in range(40):
        clk.t += 0.01
        st.feed_audio(SILENCE)
    assert st.params().mouth_open < 0.1
    # Ovoz kelmay qolsa ham og'iz yopiladi
    for _ in range(10):
        clk.t += 0.01
        st.feed_audio(tone(300, 0.6))
    clk.t += 0.6
    assert st.params().mouth_open < 0.1


def test_visemes_from_spectrum():
    clk = Clock()
    st = AvatarState(clk, seed=2)
    for _ in range(30):
        clk.t += 0.01
        st.feed_audio(tone(9000, 0.5))
    assert st.lips.viseme(clk.t) == "E"
    for _ in range(60):
        clk.t += 0.01
        st.feed_audio(tone(150, 0.6))
    assert st.lips.viseme(clk.t) == "O"


# ── ko'z qisish / harakat ──
def test_blink_timing():
    import random
    b = Blinker(random.Random(7), 0.0)
    t, closed = 0.0, 0
    while t < 120.0:
        if b.value(t) >= 0.99:
            closed += 1
        t += 1 / 15
    gaps = [y - x for x, y in zip(b.starts, b.starts[1:])]
    normal = [g for g in gaps if g > 1.0]
    assert len(b.starts) >= 18
    assert all(3.0 <= g - b.duration + 1e-6 <= 6.0 + 1e-6 for g in normal)
    assert all(g > 0.3 for g in gaps)                    # ikki martalik ham juda tez emas
    assert closed >= len(b.starts) * 0.8                 # 15 fps'da yopiq holat kadrga tushadi


def test_idle_motion_is_not_static():
    clk = Clock()
    st = AvatarState(clk, seed=3)
    ps = []
    for _ in range(150):
        clk.t += 1 / 15
        ps.append(st.params())
    dxs = [p.dx for p in ps]
    gazes = {(round(p.gaze_x, 2), round(p.gaze_y, 2)) for p in ps}
    assert max(dxs) - min(dxs) > 2.0
    assert max(p.dy for p in ps) - min(p.dy for p in ps) > 1.0
    assert len(gazes) > 5
    assert any(p.blink > 0.9 for p in ps)


# ── kayfiyat ──
@pytest.mark.parametrize("text,emo", [
    ("Rahmat, hammasi ajoyib bajarildi!", "happy"),
    ("Afsuski, bugun 3 ta xodim kelmadi, muammo bor.", "concerned"),
    ("Bir daqiqa, hozir tekshirib ko'raman", "thinking"),
    ("Ertaga soat 9 da yig'ilish.", "neutral"),
    ("Kechirasiz, ulanmadi", "concerned"),
    ("К сожалению, произошла ошибка", "concerned"),
    ("", "neutral"),
])
def test_emotion_classify(text, emo):
    assert E.classify(text) == emo


def test_emotion_switches_smoothly():
    clk = Clock()
    st = AvatarState(clk, seed=4)
    st.set_caption("Rahmat, zo'r!")
    smiles = []
    for _ in range(30):
        clk.t += 1 / 15
        smiles.append(st.params().smile)
    assert smiles[-1] > 0.75
    steps = [b - a for a, b in zip(smiles, smiles[1:])]
    assert max(abs(s) for s in steps) < 0.25           # sakrashsiz
    st.set_caption("Afsuski, muammo bor")
    for _ in range(30):
        clk.t += 1 / 15
        p = st.params()
    assert p.emotion == "concerned" and p.smile < -0.3 and p.brow_tilt > 0.6


def test_thinking_after_user_speaks():
    clk = Clock()
    st = AvatarState(clk, seed=5)
    for _ in range(50):
        clk.t += 0.01
        st.feed_user_audio(tone(250, 0.5))
    for _ in range(20):
        clk.t += 1 / 15
        st.feed_user_audio(SILENCE)
        p = st.params()
    assert p.emotion == "thinking"


def test_emotion_blend_normalized():
    b = EmotionBlend(0.0)
    w = b.update(0.2, "happy")
    assert abs(sum(w.values()) - 1) < 1e-6 and 0 < w["happy"] < 1


# ── subtitr ──
def test_wrap_text_fits_and_keeps_words():
    measure = lambda s: len(s) * 10.0
    lines = wrap_text("Assalomu alaykum, men kompaniyaning AI yordamchisiman", measure, 150)
    assert all(measure(l) <= 150 for l in lines)
    assert " ".join(lines) == "Assalomu alaykum, men kompaniyaning AI yordamchisiman"
    long = wrap_text("a" * 40, measure, 100)
    assert all(len(l) <= 10 for l in long) and "".join(long) == "a" * 40
    assert clean_text("o‘zbek  ʻtil\n") == "o'zbek 'til"


def test_subtitle_pages_and_render():
    r = SubtitleRenderer(480)
    pages = r.pages("Assalomu alaykum! Bugun obyektda o'n ikki nafar xodim ishladi, ikki kishi kechikdi. "
                    "Ertangi reja bo'yicha beton quyish soat sakkizda boshlanadi.")
    assert len(pages) >= 2 and all(1 <= len(p) <= 2 for p in pages)
    img = r.render(pages[0])
    assert img.mode == "RGBA" and img.width <= 480 - 2 * r.margin
    assert r.render(pages[0]) is img                    # kesh


def test_caption_shown_paged_and_hidden():
    clk = Clock()
    st = AvatarStreamer(lambda *a: None, clock=clk, seed=6).state
    long = " ".join(["Bugun obyektda beton quyish ishlari davom etdi"] * 4)
    st.set_caption(long)
    assert st.params().caption == ()                    # owner 2026-10-19: subtitr standart o'chiq
    st.show_captions = True
    first = st.params().caption
    assert first
    for _ in range(600):                                # 6 s gapirish
        clk.t += 0.01
        st.feed_audio(tone(300, 0.5))
    later = st.params().caption
    assert later and later != first
    for _ in range(40):                                 # sukunat > 2.5 s
        clk.t += 0.1
        st.feed_audio(SILENCE)
    assert st.params().caption == ()


# ── CPU byudjeti ──
def test_cpu_budget_60_frames():
    clk = Clock()
    s = AvatarStreamer(lambda *a: None, clock=clk, seed=8)
    s.set_caption("Salom! Bugungi hisobotni tayyorladim, ko'rib chiqing.")
    t0 = time.perf_counter()
    for i in range(60):
        clk.t += 1 / 15
        for _ in range(6):
            s.feed_audio(tone(250 + 30 * (i % 5), 0.4 if i % 3 else 0.05))
        assert len(s.render_once()) == 345600
    elapsed = time.perf_counter() - t0
    assert elapsed < 6.0, elapsed                         # 15 fps uchun ~4 s real vaqt; odatda ~1.5 s


# ── oqim ──
def test_streamer_sends_frames_and_stops_on_errors():
    sent = []

    async def send(data, w, h):
        sent.append((len(data), w, h))

    async def main():
        s = AvatarStreamer(send, size=240, fps=30)
        await s.run(max_frames=5)
        return s

    s = asyncio.run(main())
    assert sent == [(240 * 240 * 3 // 2, 240, 240)] * 5 and s.frames_sent == 5

    async def bad(data, w, h):
        raise RuntimeError("x")

    async def main2():
        s = AvatarStreamer(bad, size=240, fps=30)
        await asyncio.wait_for(s.run(), 5)
        return s

    s = asyncio.run(main2())
    assert s.send_errors == 5


# ── hooks / calls.py ──
class FakePC:
    def __init__(self, video, admin_id=5, participant_id=999):
        self.video, self.admin_id, self.participant_id = video, admin_id, participant_id


def test_tracker_marks_video_calls():
    t = H.VideoCallTracker()
    t.on_phone_call(FakePC(False), me_id=999)
    assert not t.is_video(5)
    t.on_phone_call(FakePC(True), me_id=999)
    assert t.is_video(5) and not t.is_video(999)
    t.forget(5)
    assert not t.is_video(5)


def test_session_decides_video(monkeypatch):
    class Eng:
        def __init__(self, vid):
            self.vid = vid
            self.enabled = []
            self.frames = 0

        def is_video_call(self, uid):
            return self.vid

        async def enable_video(self, uid, w, h, fps):
            self.enabled.append((uid, w, h, fps))

        async def send_video_frame(self, uid, data, w, h):
            self.frames += 1

    async def run(eng, want=False):
        s = H.AvatarSession(eng, 42, want)
        s.start()
        for _ in range(80):                       # renderer tayyorlanishi (540p) — 8 s gacha kutamiz
            await asyncio.sleep(0.1)
            if eng.frames >= 2 or (not eng.vid and not want and _ > 15):
                break
        s.set_caption("Rahmat!")
        await s.stop()
        return s

    monkeypatch.setenv("AVATAR_VIDEO", "auto")
    monkeypatch.setattr(H, "DETECT_WAIT_S", 0.1)
    e = Eng(True)
    asyncio.run(run(e))
    assert e.enabled and e.enabled[0][1] == 540 and e.enabled[0][3] == 24 and e.frames >= 2
    e = Eng(False)
    asyncio.run(run(e))
    assert not e.enabled and e.frames == 0
    e = Eng(False)
    asyncio.run(run(e, want=True))
    assert e.enabled
    assert H.start_for_call(Eng(True), 1, look="off") is None      # dasturchi panelida avatar o'chirilgan
    monkeypatch.setenv("AVATAR_VIDEO", "off")
    assert H.start_for_call(Eng(True), 1) is None


def test_calls_feed_and_caption_hooks():
    from app.calls import ActiveCall, CallManager

    class Av:
        def __init__(self):
            self.ai = self.user = 0
            self.caption = None

        def feed_audio(self, pcm):
            self.ai += 1

        def feed_user_audio(self, pcm):
            self.user += 1

        def set_caption(self, text, emotion=None):
            self.caption = (text, emotion)

        def tolerate_audio_error(self):
            return False

        async def stop(self):
            self.stopped = True

    class Eng:
        ready = True

    async def emit(ev):
        pass

    async def up(b):
        pass

    async def main():
        m = CallManager(Eng(), emit, up)
        sid = "a" * 24
        from app import audio as A
        c = ActiveCall(session_id=sid, user_id=7, frame_uuid=A.session_frame_uuid(sid), timeout_sec=30, max_duration_sec=60)
        c.state = "connected"
        av = Av()
        c.avatar = av
        m.active = c
        await m.on_frames(7, [b"\0" * 960, b"\0" * 960])
        r = await m.caption({"sessionId": sid, "text": "Salom", "emotion": "happy"})
        assert r == {"ok": True} and av.caption == ("Salom", "happy")
        assert (await m.caption({"sessionId": "b" * 24, "text": "x"})) == {"ok": True}
        await m._finish(c, "completed")
        await asyncio.sleep(0)
        assert c.avatar is None and getattr(av, "stopped", False)
        return av

    av = asyncio.run(main())
    assert av.user == 2
