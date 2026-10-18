"""Avatar holati: lab sinxroni (TTS ovoz energiyasi), ko'z qisish, ko'z harakati, bosh tebranishi,
kayfiyatning silliq almashishi va subtitr sahifalari vaqti.

Hamma narsa soatga (clock) bog'liq — testlarda soxta vaqt beriladi. Renderer bu yerdan faqat
o'zgarmas FaceParams oladi (render boshqa oqimda — thread xavfsiz).
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

from .emotion import EMOTIONS, classify

# Kayfiyat → yuz parametrlari
_EMO_PARAMS: dict[str, dict[str, float]] = {
    "neutral":   {"smile": 0.18, "brow_raise": 0.0,  "brow_tilt": 0.0, "brow_asym": 0.0, "eye_open": 1.0,  "blush": 0.15, "tilt": 0.0,  "gaze_x": 0.0,  "gaze_y": 0.0},
    "happy":     {"smile": 0.9,  "brow_raise": 0.35, "brow_tilt": -0.1, "brow_asym": 0.0, "eye_open": 0.78, "blush": 1.0,  "tilt": 2.0,  "gaze_x": 0.0,  "gaze_y": 0.0},
    "thinking":  {"smile": -0.05, "brow_raise": 0.2, "brow_tilt": 0.0, "brow_asym": 0.9, "eye_open": 0.9,  "blush": 0.1,  "tilt": -3.0, "gaze_x": 0.45, "gaze_y": -0.55},
    "concerned": {"smile": -0.5, "brow_raise": 0.15, "brow_tilt": 0.9, "brow_asym": 0.0, "eye_open": 1.05, "blush": 0.0,  "tilt": 2.5,  "gaze_x": 0.0,  "gaze_y": 0.1},
}

VISEMES = ("rest", "A", "O", "E")
# viseme → (og'iz kengligi koeffitsienti, ochilish koeffitsienti)
_VISEME_SHAPE = {"rest": (1.0, 0.0), "A": (1.0, 1.0), "O": (0.68, 0.9), "E": (1.18, 0.55)}

SILENCE_DB = -48.0     # bundan past — sukunat
LOUD_DB = -14.0        # bundan baland — og'iz to'liq ochiq
VOICE_THRESHOLD = 0.08


@dataclass(frozen=True)
class FaceParams:
    t: float = 0.0
    dx: float = 0.0
    dy: float = 0.0
    tilt_deg: float = 0.0
    body_dx: float = 0.0
    breath: float = 0.0
    gaze_x: float = 0.0
    gaze_y: float = 0.0
    blink: float = 0.0          # 0 ochiq … 1 yopiq
    eye_open: float = 1.0
    brow_raise: float = 0.0
    brow_tilt: float = 0.0
    brow_asym: float = 0.0
    smile: float = 0.2
    blush: float = 0.0
    mouth_open: float = 0.0
    mouth_width: float = 1.0
    viseme: str = "rest"
    emotion: str = "neutral"
    caption: tuple[str, ...] = ()


def pcm_features(pcm: bytes) -> tuple[float, float]:
    """(dBFS, "yorqinlik" 0..1) — yorqinlik: yuqori chastota ulushi (s/sh/e/i tovushlari)."""
    n = len(pcm) - len(pcm) % 2
    if n < 4:
        return -100.0, 0.0
    x = np.frombuffer(pcm[:n], dtype=np.int16).astype(np.float32)
    e = float(np.mean(x * x))
    if e <= 1.0:
        return -100.0, 0.0
    db = 10.0 * math.log10(e / (32768.0 ** 2))
    d = np.diff(x)
    hf = float(np.mean(d * d)) / (4.0 * e)     # oq shovqin ≈ 0.5, past chastota ≈ 0
    return db, max(0.0, min(1.0, hf * 2.0))


class LipSync:
    """Ovoz energiyasi → og'iz ochilishi (tez ochilish, sekinroq yopilish) + oddiy visemalar."""

    def __init__(self):
        self.env = 0.0
        self.bright = 0.3
        self.last_feed_t = -1e9
        self.last_voice_t = -1e9

    def feed(self, pcm: bytes, t: float) -> None:
        db, br = pcm_features(pcm)
        target = (db - SILENCE_DB) / (LOUD_DB - SILENCE_DB)
        target = max(0.0, min(1.0, target))
        k = 0.55 if target > self.env else 0.22     # 10 ms bo'lak uchun
        self.env += (target - self.env) * k
        if target > 0.05:
            self.bright += (br - self.bright) * 0.3
        self.last_feed_t = t
        if self.env > VOICE_THRESHOLD:
            self.last_voice_t = t

    def level(self, t: float) -> float:
        # Ovoz kelmay qolsa (yuboruvchi to'xtagan) og'iz asta yopiladi
        gap = t - self.last_feed_t
        if gap > 0.05:
            return self.env * math.exp(-(gap - 0.05) / 0.08)
        return self.env

    def viseme(self, t: float) -> str:
        lv = self.level(t)
        if lv < VOICE_THRESHOLD:
            return "rest"
        if self.bright > 0.5:
            return "E"
        if self.bright < 0.16:
            return "O"
        return "A"

    def speaking(self, t: float, hold: float = 0.25) -> bool:
        return t - self.last_voice_t < hold


class Blinker:
    """Har 3–6 s'da ko'z qisish (ba'zan ikki marta). Yopiq holat 15 fps'da ham kadrga tushadi."""

    CLOSE = 0.07
    HOLD = 0.08
    OPEN = 0.10

    def __init__(self, rng: random.Random, t0: float, min_gap: float = 3.0, max_gap: float = 6.0):
        self.rng = rng
        self.min_gap, self.max_gap = min_gap, max_gap
        self.next_at = t0 + rng.uniform(1.0, 3.0)
        self.start: Optional[float] = None
        self.starts: list[float] = []     # testlar uchun (oxirgi 20 ta)

    @property
    def duration(self) -> float:
        return self.CLOSE + self.HOLD + self.OPEN

    def value(self, t: float) -> float:
        if self.start is None and t >= self.next_at:
            self.start = self.next_at
            self.starts.append(self.start)
            del self.starts[:-20]
        if self.start is None:
            return 0.0
        p = t - self.start
        if p >= self.duration:
            double = self.rng.random() < 0.12
            self.next_at = self.start + self.duration + (0.12 if double else self.rng.uniform(self.min_gap, self.max_gap))
            self.start = None
            return self.value(t) if t >= self.next_at else 0.0
        if p < self.CLOSE:
            return p / self.CLOSE
        if p < self.CLOSE + self.HOLD:
            return 1.0
        return max(0.0, 1.0 - (p - self.CLOSE - self.HOLD) / self.OPEN)


class Gaze:
    """Ko'z sakkadalari: 0.6–2.2 s'da yangi nuqta, tez (35 ms) o'tish."""

    def __init__(self, rng: random.Random, t0: float):
        self.rng = rng
        self.x = self.y = 0.0
        self.tx = self.ty = 0.0
        self.next_at = t0 + rng.uniform(0.6, 2.2)
        self.last_t = t0

    def update(self, t: float, speaking: bool) -> tuple[float, float]:
        if t >= self.next_at:
            s = 0.3 if speaking else 1.0                # gapirganda suhbatdoshga qaraydi
            if self.rng.random() < 0.35:
                self.tx, self.ty = 0.0, 0.0
            else:
                self.tx = self.rng.uniform(-0.6, 0.6) * s
                self.ty = self.rng.uniform(-0.35, 0.35) * s
            self.next_at = t + self.rng.uniform(0.6, 2.2)
        dt = max(0.0, t - self.last_t)
        self.last_t = t
        a = 1.0 - math.exp(-dt / 0.035)
        self.x += (self.tx - self.x) * a
        self.y += (self.ty - self.y) * a
        return self.x, self.y


class EmotionBlend:
    """Kayfiyatlar vazni maqsadga silliq yaqinlashadi (tau ≈ 0.35 s) — keskin sakrash yo'q."""

    TAU = 0.35

    def __init__(self, t0: float):
        self.w = {e: (1.0 if e == "neutral" else 0.0) for e in EMOTIONS}
        self.target = "neutral"
        self.last_t = t0

    def update(self, t: float, target: str) -> dict[str, float]:
        self.target = target if target in self.w else "neutral"
        dt = max(0.0, t - self.last_t)
        self.last_t = t
        a = 1.0 - math.exp(-dt / self.TAU)
        for e in self.w:
            goal = 1.0 if e == self.target else 0.0
            self.w[e] += (goal - self.w[e]) * a
        s = sum(self.w.values()) or 1.0
        for e in self.w:
            self.w[e] /= s
        return dict(self.w)

    def dominant(self) -> str:
        return max(self.w, key=self.w.get)

    def mix(self, key: str) -> float:
        return sum(_EMO_PARAMS[e][key] * w for e, w in self.w.items())


@dataclass
class Caption:
    pages: list[list[str]] = field(default_factory=list)
    set_t: float = -1e9
    spoken: float = 0.0          # shu gap uchun AI gapirgan vaqt (s)
    emotion: str = "neutral"


class AvatarState:
    CHARS_PER_SEC = 13.0          # o'zbekcha TTS taxminiy tezligi
    CAPTION_LINGER = 2.5          # gap tugagach subtitr shuncha turadi
    EMOTION_HOLD = 8.0

    def __init__(self, clock: Callable[[], float], seed: Optional[int] = None,
                 paginate: Optional[Callable[[str], list[list[str]]]] = None):
        self.clock = clock
        t0 = clock()
        self.rng = random.Random(seed)
        self.lips = LipSync()
        self.blinker = Blinker(self.rng, t0)
        self.gaze = Gaze(self.rng, t0)
        self.emo = EmotionBlend(t0)
        self.caption = Caption()
        self._paginate = paginate or (lambda s: [[s]] if s else [])
        self.user_last_voice_t = -1e9
        self._user_env = 0.0
        self._last_t = t0
        self._mouth = 0.0
        self._mouth_w = 1.0
        self.phase = self.rng.uniform(0, 100)

    # ── kirishlar ──
    def feed_audio(self, pcm: bytes) -> None:
        """AI ovozi: Telegram'ga haqiqatda yuborilgan 48 kHz PCM16 (10 ms bo'laklar)."""
        t = self.clock()
        self.lips.feed(pcm, t)
        if self.lips.env > VOICE_THRESHOLD:
            self.caption.spoken += len(pcm) / (48000 * 2)

    def feed_user_audio(self, pcm: bytes) -> None:
        t = self.clock()
        db, _ = pcm_features(pcm)
        lv = max(0.0, min(1.0, (db - SILENCE_DB) / (LOUD_DB - SILENCE_DB)))
        self._user_env += (lv - self._user_env) * (0.5 if lv > self._user_env else 0.2)
        if self._user_env > 0.15:
            self.user_last_voice_t = t

    def set_caption(self, text: str, emotion: Optional[str] = None) -> None:
        t = self.clock()
        pages = self._paginate(text or "")
        self.caption = Caption(pages=pages, set_t=t, spoken=0.0,
                               emotion=emotion if emotion in _EMO_PARAMS else classify(text or ""))

    # ── chiqish ──
    def _target_emotion(self, t: float, speaking: bool) -> str:
        c = self.caption
        if t - c.set_t < self.EMOTION_HOLD or (speaking and t - c.set_t < 30):
            return c.emotion
        # Foydalanuvchi gapirib bo'ldi, AI hali javob bermadi — "o'ylayapti"
        since_user = t - self.user_last_voice_t
        if 0.5 < since_user < 6.0 and not speaking and self.lips.last_voice_t < self.user_last_voice_t:
            return "thinking"
        return "neutral"

    def _caption_page(self, t: float) -> tuple[str, ...]:
        c = self.caption
        if not c.pages:
            return ()
        last_activity = max(c.set_t, self.lips.last_voice_t)
        budget = c.spoken * self.CHARS_PER_SEC
        used = 0.0
        idx = len(c.pages) - 1
        for i, pg in enumerate(c.pages):
            used += sum(len(s) for s in pg) + 1
            if budget < used:
                idx = i
                break
        if t - last_activity > self.CAPTION_LINGER:     # gap tugadi yoki to'xtatildi (barge-in)
            return ()
        return tuple(c.pages[idx])

    def params(self, t: Optional[float] = None) -> FaceParams:
        t = self.clock() if t is None else t
        dt = max(0.0, min(0.5, t - self._last_t))
        self._last_t = t
        speaking = self.lips.speaking(t)
        self.emo.update(t, self._target_emotion(t, speaking))
        level = self.lips.level(t)
        vis = self.lips.viseme(t)
        w_k, o_k = _VISEME_SHAPE[vis]
        # Kadrlar orasida ham silliq (15 fps)
        a = 1.0 - math.exp(-dt / 0.045) if dt > 0 else 1.0
        self._mouth += (min(1.0, level * 1.15) * o_k - self._mouth) * a
        self._mouth_w += (w_k - self._mouth_w) * a
        gx, gy = self.gaze.update(t, speaking)
        ph = self.phase + t
        nod = 3.5 * level * math.sin(ph * 9.0)        # gapirganda yengil bosh irg'ash
        dx = 5.0 * math.sin(2 * math.pi * 0.13 * ph) + 2.5 * math.sin(2 * math.pi * 0.31 * ph + 1.3)
        breath = math.sin(2 * math.pi * 0.24 * ph)
        dy = 2.5 * breath + 1.5 * math.sin(2 * math.pi * 0.17 * ph + 0.7) + nod
        tilt = 1.8 * math.sin(2 * math.pi * 0.09 * ph + 0.4) + self.emo.mix("tilt")
        return FaceParams(
            t=t, dx=dx, dy=dy, tilt_deg=tilt, body_dx=dx * 0.35, breath=breath,
            gaze_x=max(-1.0, min(1.0, gx + self.emo.mix("gaze_x"))),
            gaze_y=max(-1.0, min(1.0, gy + self.emo.mix("gaze_y"))),
            blink=self.blinker.value(t), eye_open=self.emo.mix("eye_open"),
            brow_raise=self.emo.mix("brow_raise") + 0.25 * level, brow_tilt=self.emo.mix("brow_tilt"),
            brow_asym=self.emo.mix("brow_asym"), smile=self.emo.mix("smile"), blush=self.emo.mix("blush"),
            mouth_open=max(0.0, min(1.0, self._mouth)), mouth_width=self._mouth_w, viseme=vis,
            emotion=self.emo.dominant(), caption=self._caption_page(t),
        )
