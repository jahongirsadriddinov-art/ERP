"""Premium 3D odam avatari (owner 2026-10-19: "odamga o'xshagan premium, barcha mimikalar, fon oddiy bo'lmasin").

Personaj Blender + MPFB (MakeHuman, CC0) da yaratilgan (tools/avatar3d/), har biri uchun 40 ta kadr:
5 ifoda (neutral/happy/thinking/concerned/surprised) × 7 lab shakli (rest/A/E/O/U/M/F) + ko'z yumilgan.
Ish vaqtida: ovoz balandligi va yorqinligi → lab shakli, kayfiyat va AI faoliyati → ifoda, ko'z qisish →
yumuq ko'z kadri; kadrlar orasida silliq o'tish (lab 70 ms, ifoda 250 ms). Ustida: yengil nafas/tebranish,
o'ylash/qidirish buluti va belgisi (Fluent 3D), ovoz to'lqini, subtitr, "AI yordamchi" belgisi.
Interfeys: render(p) -> RGB, render_i420(p) -> bytes, .subs (PersonRenderer bilan bir xil).
"""
from __future__ import annotations

import json
import math
import os
import random
from typing import Optional

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .emoji3d import TOOL_LOOK, _badge, _ease, _ease_back, _load
from .face import rgb_to_i420
from .state import FaceParams
from .subtitles import SubtitleRenderer

ASSETS3D = os.path.join(os.path.dirname(__file__), "assets3d")

THEMES = {
    # (yuqori, past, nur, bokeh ranglari) — studiya foni
    "female": ((46, 40, 72), (18, 16, 34), (128, 96, 170), ((255, 196, 150), (190, 150, 255), (255, 160, 200))),
    "male": ((30, 48, 78), (12, 18, 34), (80, 120, 190), ((150, 200, 255), (255, 210, 150), (140, 170, 255))),
}


def available(look: str) -> bool:
    return os.path.exists(os.path.join(ASSETS3D, look, "manifest.json"))


def _studio_bg(n: int, theme) -> Image.Image:
    top, bottom, glow, bokeh = theme
    yy = np.linspace(0, 1, n, dtype=np.float32)[:, None, None]
    g = np.array(top, np.float32) * (1 - yy) + np.array(bottom, np.float32) * yy
    g = np.broadcast_to(g, (n, n, 3)).copy()
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    d = np.sqrt((x - 0.5) ** 2 + (y - 0.45) ** 2) / 0.6
    w = (np.clip(1 - d, 0, 1) ** 2)[..., None] * 0.55
    g = g * (1 - w) + np.array(glow, np.float32) * w
    img = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    # Bokeh (orqadagi xira chiroqlar) — studiya chuqurligi
    rnd = random.Random(11)
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d2 = ImageDraw.Draw(layer)
    for _ in range(26):
        r = rnd.uniform(0.02, 0.07) * n
        cx, cy = rnd.uniform(0, 1) * n, rnd.uniform(0.02, 0.75) * n
        col = rnd.choice(bokeh)
        d2.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(*col, rnd.randint(28, 70)))
    layer = layer.filter(ImageFilter.GaussianBlur(n * 0.012))
    img.alpha_composite(layer)
    vig = Image.new("L", (n, n), 0)
    ImageDraw.Draw(vig).ellipse((-n * 0.25, -n * 0.2, n * 1.25, n * 1.3), fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(n * 0.12))
    dark = Image.new("RGBA", (n, n), (0, 0, 0, 120))
    img = Image.composite(img, Image.alpha_composite(img, dark), vig)
    return img


class RealRenderer:
    def __init__(self, look: str = "female", size: int = 640, badge: Optional[str] = "AI yordamchi"):
        if size % 2 or size < 160:
            raise ValueError("BAD_SIZE")
        self.g = "male" if look == "male" else "female"
        self.size = size
        self.u = size / 480.0
        self.subs = SubtitleRenderer(size, font_size=max(14, int(22 * self.u)))
        d = os.path.join(ASSETS3D, self.g)
        manifest = json.load(open(os.path.join(d, "manifest.json"), encoding="utf-8"))
        self.frames: dict[str, Image.Image] = {}
        for x in manifest:
            im = Image.open(os.path.join(d, x["file"])).convert("RGBA")
            if im.size != (size, size):
                im = im.resize((size, size), Image.LANCZOS)
            self.frames[f"{x['expr']}_{x['vis']}_{x['eye']}"] = im
        self._bg = _studio_bg(size, THEMES[self.g])
        self.bubble_px = int(size * 0.26)
        self.icon_px = int(size * 0.10)
        self._bubble = _load("i_thought.png", self.bubble_px)
        self._icons: dict[str, Optional[Image.Image]] = {}
        self._badge = _badge(badge, self.u) if badge else None
        self._cur_key = "neutral_rest_open"
        self._from: Optional[Image.Image] = None
        self._since = -1e9
        self._dur = 0.2
        self._last_face: Optional[Image.Image] = None
        self._icon, self._icon_since = "", -1e9

    # ── holat → kadr ──
    def expression(self, p: FaceParams) -> str:
        if p.activity:
            if p.activity_phase == "start":
                return "thinking"
            if p.activity_status in ("ok", "confirmed") and p.activity_age < 1.8:
                return "happy"
            if p.activity_status and p.activity_status not in ("ok", "confirmed", "needs_confirmation") and p.activity_age < 2.2:
                return "concerned"
        if p.stream_age < 3.0:
            return "happy"                                  # salom — tabassum
        return {"happy": "happy", "thinking": "thinking", "concerned": "concerned"}.get(p.emotion, "neutral")

    def viseme(self, p: FaceParams) -> str:
        lv = max(0.0, min(1.0, p.mouth_open))
        if lv < 0.08:
            return "rest"
        # Ovoz yorqinligi (LipSync) + balandlik → lab shakli; past ovozda lablar yaqinlashadi (M/F)
        if lv < 0.22:
            return "M" if int(p.t * 7) % 3 == 0 else "F"
        if p.viseme == "E":
            return "E"
        if p.viseme == "O":
            return "U" if lv < 0.45 else "O"
        return "A" if lv > 0.5 else "E"

    def choose(self, p: FaceParams) -> tuple[str, str]:
        expr = self.expression(p)
        vis = self.viseme(p)
        eye = "closed" if p.blink > 0.55 and vis == "rest" else "open"
        key = f"{expr}_{vis}_{eye}"
        if key not in self.frames:
            key = f"{expr}_{vis}_open" if f"{expr}_{vis}_open" in self.frames else "neutral_rest_open"
        icon = ""
        if p.activity and p.activity_phase == "start":
            icon = TOOL_LOOK.get(p.activity, ("", "thinking"))[1]
        elif p.activity and p.activity_status in ("ok", "confirmed") and p.activity_age < 1.8:
            icon = "done"
        elif expr == "thinking":
            icon = "thinking"
        return key, icon

    def _icon_img(self, key: str) -> Optional[Image.Image]:
        if key not in self._icons:
            from .emoji3d import ASSETS
            path = os.path.join(ASSETS, f"i_{key}.png")
            self._icons[key] = _load(f"i_{key}.png", self.icon_px) if os.path.exists(path) else None
        return self._icons[key]

    def _face(self, key: str, t: float) -> Image.Image:
        if key != self._cur_key:
            same_expr = key.split("_", 1)[0] == self._cur_key.split("_", 1)[0]
            self._from = self._last_face if self._last_face is not None else self.frames[self._cur_key]
            self._cur_key, self._since = key, t
            self._dur = 0.07 if same_expr else 0.25
        target = self.frames[self._cur_key]
        k = (t - self._since) / self._dur
        face = target if self._from is None or k >= 1 else Image.blend(self._from, target, _ease(k))
        self._last_face = face
        return face

    def render(self, p: FaceParams) -> Image.Image:
        n, u, t = self.size, self.u, p.t
        frame = self._bg.copy()
        key, icon = self.choose(p)
        face = self._face(key, t)
        # Yengil tirik harakat: nafas va bosh tebranishi (siljish; aylantirish faqat sezilarli bo'lsa)
        x = int(round(p.dx * 0.35 * u))
        y = int(round((p.dy * 0.25 + 1.2 * p.breath) * u)) + int(n * 0.01)
        if abs(p.tilt_deg) > 0.6:
            face = face.rotate(p.tilt_deg * 0.4, resample=Image.BILINEAR, center=(n / 2, n * 0.95))
        frame.alpha_composite(face, (x, y)) if x >= 0 and y >= 0 else frame.paste(face, (x, y), face)

        if icon != self._icon:
            self._icon, self._icon_since = icon, t
        if self._icon:
            ka = (t - self._icon_since) / 0.28
            s = _ease_back(ka) if ka < 1 else 1.0
            if s > 0.05:
                bw = max(8, int(self.bubble_px * s))
                bub = self._bubble if bw == self.bubble_px else self._bubble.resize((bw, bw), Image.BILINEAR)
                bx = int(n * 0.77 - bw / 2)
                by = int(n * 0.17 - bw / 2 + 4 * u * math.sin(t * 2.2))
                frame.alpha_composite(bub, (max(0, bx), max(0, by)))
                ic = self._icon_img(self._icon)
                if ic is not None:
                    iw = max(4, int(self.icon_px * s))
                    ii = ic if iw == ic.width else ic.resize((iw, iw), Image.BILINEAR)
                    frame.alpha_composite(ii, (max(0, int(bx + bw * 0.56 - iw / 2)), max(0, int(by + bw * 0.40 - iw / 2))))

        out = frame.convert("RGB")
        lv = max(0.0, min(1.0, p.mouth_open))
        if lv > 0.04:
            self._wave(out, t, lv)
        if self._badge is not None:
            m = int(12 * u)
            out.paste(self._badge, (m, m), self._badge)
        if p.caption:
            self.subs.composite(out, list(p.caption))
        return out

    def _wave(self, frame: Image.Image, t: float, level: float) -> None:
        u, n = self.u, self.size
        w, h = int(92 * u), int(30 * u)
        x0, y0 = int(n - w - 14 * u), int(14 * u)
        d = ImageDraw.Draw(frame, "RGBA")
        d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=h // 2, fill=(20, 20, 34, 120))
        for i in range(5):
            amp = 0.25 + 0.75 * level * (0.55 + 0.45 * math.sin(t * (9 + i * 1.7) + i))
            bh = max(3 * u, (h - 10 * u) * amp)
            bx = x0 + w / 6.0 * (i + 1)
            d.rounded_rectangle((bx - 2.2 * u, y0 + h / 2 - bh / 2, bx + 2.2 * u, y0 + h / 2 + bh / 2), radius=int(2.2 * u), fill=(255, 255, 255, 235))

    def render_i420(self, p: FaceParams) -> bytes:
        return rgb_to_i420(self.render(p))
