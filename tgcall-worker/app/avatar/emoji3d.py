"""Premium 3D emoji avatar (owner 2026-10-19): Microsoft Fluent UI Emoji 3D (MIT) personajlari.

O'zimiz chizmaymiz — tayyor 3D "clay" pozalar (assets/, LICENSE-fluentui-emoji.txt). Avatar "tirik":
  • holatga qarab poza silliq almashadi (0.22 s cross-fade): salom — qo'l silkitadi, gapiradi — tushuntiradi,
    o'ylaydi — 💭 bulut + 🤔, qidiradi — izquvar 🕵️ + 🌐, bajardi — 🙆 + ✅, bilmaydi — 🤷 + ❓, xafa — 🙍;
  • nafas, ovozga mos yengil sakrash/tebranish, ovoz to'lqini (glass pill), suzuvchi yumshoq fon nurlari;
  • subtitr (standart o'chiq) va "AI yordamchi" belgisi.
Interfeys PersonRenderer bilan bir xil: render(p) -> RGB, render_i420(p) -> bytes, .subs.
"""
from __future__ import annotations

import math
import os
from typing import Optional

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .face import rgb_to_i420
from .state import FaceParams
from .subtitles import SubtitleRenderer, load_font

ASSETS = os.path.join(os.path.dirname(__file__), "assets")
POSES = ("office", "wave", "explain", "ok", "shrug", "sad", "detective", "builder")

# Tool → (poza, belgi). Backend 'call.avatar' bilan tool nomini yuboradi.
TOOL_LOOK: dict[str, tuple[str, str]] = {
    "searchWeb": ("detective", "globe"),
    "getWeather": ("explain", "sun_cloud"),
    "getExchangeRate": ("explain", "dollar"),
    "requestCallback": ("office", "phone"), "callEmployee": ("office", "phone"),
    "messageEmployee": ("office", "message"), "notifyManager": ("office", "message"), "forwardMedia": ("office", "message"),
    "capturePhoto": ("office", "camera"), "recordVideo": ("office", "video"),
    "createReminder": ("office", "alarm"), "updateReminder": ("office", "alarm"), "listReminders": ("office", "alarm"),
    "cancelReminder": ("office", "alarm"),
    "getMySchedule": ("office", "calendar"), "getMyTasks": ("office", "tasks"),
    "getProjectSummary": ("builder", "building"), "getObjectDetails": ("builder", "building"),
    "getInventoryBalance": ("builder", "building"),
    "getAttendanceSummary": ("office", "memo"), "listEmployees": ("office", "memo"),
    "getAllowedFinancialReport": ("office", "chart"), "listExpenses": ("office", "money"),
    "listPendingApprovals": ("office", "memo"), "approveTransaction": ("office", "done"), "rejectTransaction": ("office", "memo"),
    "getTodayOverview": ("office", "chart"), "setTranslatorMode": ("explain", "speech"),
}

THEMES = {
    "female": ((250, 222, 236), (196, 186, 246), (255, 246, 250)),
    "male": ((206, 230, 252), (150, 170, 238), (240, 248, 255)),
}


def _ease(k: float) -> float:
    k = max(0.0, min(1.0, k))
    return k * k * (3 - 2 * k)


def _ease_back(k: float) -> float:
    k = max(0.0, min(1.0, k))
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2


def _load(name: str, px: int, sharpen: bool = True) -> Image.Image:
    im = Image.open(os.path.join(ASSETS, name)).convert("RGBA")
    if im.size != (px, px):
        im = im.resize((px, px), Image.LANCZOS)
    if sharpen and px > 256:
        rgb = im.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
        rgb.putalpha(im.getchannel("A"))
        im = rgb
    return im


def _load_pose(name: str, size: int) -> Image.Image:
    """Poza: shaffof chetlar kesiladi va balandlik bir xil (kadrning ~78%) — pastki qismi kadrdan chiqib turadi."""
    im = Image.open(os.path.join(ASSETS, name)).convert("RGBA")
    bbox = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox() or (0, 0, im.width, im.height)
    im = im.crop(bbox)
    k = min(size * 0.78 / im.height, size * 0.96 / im.width)
    w, h = max(2, int(im.width * k)), max(2, int(im.height * k))
    im = im.resize((w, h), Image.LANCZOS)
    rgb = im.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1.4, percent=70, threshold=2))
    rgb.putalpha(im.getchannel("A"))
    # Kvadrat kanvas (aylantirish va cross-fade uchun bir xil o'lcham): pastki markazga
    side = int(size * 0.98) // 2 * 2
    can = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    can.paste(rgb, ((side - w) // 2, side - h), rgb)
    return can


def _gradient(n: int, top, bottom, glow) -> Image.Image:
    yy = np.linspace(0, 1, n, dtype=np.float32)[:, None, None]
    g = np.array(top, np.float32) * (1 - yy) + np.array(bottom, np.float32) * yy
    g = np.broadcast_to(g, (n, n, 3)).copy()
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    d = np.sqrt((x - 0.5) ** 2 + (y - 0.42) ** 2) / 0.55
    w = (np.clip(1 - d, 0, 1) ** 2)[..., None] * 0.55
    g = g * (1 - w) + np.array(glow, np.float32) * w
    vig = 1 - 0.16 * np.clip(np.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.7, 0, 1) ** 2
    return Image.fromarray(np.clip(g * vig[..., None], 0, 255).astype(np.uint8), "RGB")


def _soft_dot(r: int, color, alpha: float) -> Image.Image:
    im = Image.new("RGBA", (r * 4, r * 4), (*color, 0))
    m = Image.new("L", (r * 4, r * 4), 0)
    ImageDraw.Draw(m).ellipse((r, r, r * 3, r * 3), fill=int(255 * alpha))
    im.putalpha(m.filter(ImageFilter.GaussianBlur(r * 0.6)))
    return im


def _badge(text: str, u: float) -> Image.Image:
    font = load_font(max(11, int(15 * u)))
    tw = int(font.getlength(text))
    asc, desc = font.getmetrics()
    pad, dot = int(9 * u), int(9 * u)
    w, h = tw + 3 * pad + dot, asc + desc + pad
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=h // 2, fill=(20, 20, 34, 120), outline=(255, 255, 255, 90))
    cy = h // 2
    d.ellipse((pad, cy - dot // 2, pad + dot, cy + dot // 2), fill=(52, 199, 89, 255))
    d.text((2 * pad + dot, (h - asc - desc) // 2), text, font=font, fill=(255, 255, 255, 255))
    return img


class EmojiRenderer:
    def __init__(self, look: str = "female", size: int = 640, badge: Optional[str] = "AI yordamchi"):
        if size % 2 or size < 160:
            raise ValueError("BAD_SIZE")
        self.g = "male" if look == "male" else "female"
        self.size = size
        self.u = size / 480.0
        self.subs = SubtitleRenderer(size, font_size=max(14, int(22 * self.u)))
        top, bottom, glow = THEMES[self.g]
        self._bg = _gradient(size, top, bottom, glow)
        self._dots = [_soft_dot(int(size * 0.16), (255, 255, 255), 0.35), _soft_dot(int(size * 0.12), glow, 0.45)]
        self.poses = {k: _load_pose(f"{self.g}_{k}.png", size) for k in POSES}
        self.char_px = self.poses["office"].width
        self.bubble_px = int(size * 0.30)
        self.icon_px = int(size * 0.115)
        self._bubble = _load("i_thought.png", self.bubble_px)
        self._icons: dict[str, Image.Image] = {}
        self._badge = _badge(badge, self.u) if badge else None
        self._cur, self._prev, self._since = "wave", None, -1e9
        self._icon, self._icon_since = "", -1e9

    def _icon_img(self, key: str) -> Optional[Image.Image]:
        if key not in self._icons:
            path = os.path.join(ASSETS, f"i_{key}.png")
            self._icons[key] = _load(f"i_{key}.png", self.icon_px) if os.path.exists(path) else None
        return self._icons[key]

    # ── qaysi poza / belgi ──
    def choose(self, p: FaceParams) -> tuple[str, str]:
        if p.activity:
            look = TOOL_LOOK.get(p.activity, ("office", "thinking"))
            if p.activity_phase == "start":
                return look
            if p.activity_status in ("ok", "confirmed") and p.activity_age < 1.8:
                return "ok", "done"
            if p.activity_status == "needs_confirmation" and p.activity_age < 3.0:
                return "explain", "question"
            if p.activity_status and p.activity_status not in ("ok", "confirmed") and p.activity_age < 2.2:
                return "shrug", "question"
        speaking = p.mouth_open > 0.05 or p.viseme != "rest"
        if p.stream_age < 3.2:
            return "wave", ""
        if p.emotion == "thinking":
            return "office", "thinking"
        if p.emotion == "concerned":
            return "sad", ""
        if p.emotion == "happy" and speaking:
            return "explain", "sparkles"
        if speaking:
            return ("explain" if int(p.t / 4.0) % 2 else "office"), ""
        return "office", ""

    def render(self, p: FaceParams) -> Image.Image:
        u, n, t = self.u, self.size, p.t
        frame = self._bg.copy()
        # Suzuvchi yumshoq nurlar (fon jonli)
        for i, dot in enumerate(self._dots):
            ang = t * (0.11 + 0.07 * i) + i * 2.1
            x = int(n * (0.25 + 0.5 * (0.5 + 0.5 * math.sin(ang))) - dot.width / 2)
            y = int(n * (0.2 + 0.35 * (0.5 + 0.5 * math.cos(ang * 1.3))) - dot.height / 2)
            frame.paste(dot, (x, y), dot)

        pose, icon = self.choose(p)
        if pose != self._cur:
            self._prev, self._cur, self._since = self._cur, pose, t
        img = self.poses[self._cur]
        k = (t - self._since) / 0.22
        if self._prev and k < 1:
            img = Image.blend(self.poses[self._prev], img, _ease(k))

        level = max(0.0, min(1.0, p.mouth_open))
        scale = 1.0 + 0.012 * p.breath + 0.02 * level
        if self._cur == "wave":
            rot = 3.5 * math.sin(t * 6.0)
        else:
            rot = 0.5 * p.tilt_deg + 1.8 * level * math.sin(t * 5.3)
        bounce = -9.0 * u * level * abs(math.sin(t * 6.4))
        H = int(self.char_px * scale) // 2 * 2
        if H != img.width:
            img = img.resize((H, H), Image.BILINEAR)
        if abs(rot) > 0.15:
            img = img.rotate(rot, resample=Image.BICUBIC, center=(H / 2, H * 0.98))
        cx = n / 2 + p.dx * 0.6 * u
        x = int(cx - H / 2)
        y = int(n - H + n * 0.04 + bounce + p.dy * 0.4 * u)     # pastki 4% kadrdan tashqarida
        frame.paste(img, (x, y), img)

        # Fikr buluti + belgi (pop-in, suzish)
        if icon != self._icon:
            self._icon, self._icon_since = icon, t
        if self._icon:
            ka = (t - self._icon_since) / 0.28
            s = _ease_back(ka) if ka < 1 else 1.0
            if s > 0.05:
                bw = max(8, int(self.bubble_px * s))
                bub = self._bubble if bw == self.bubble_px else self._bubble.resize((bw, bw), Image.BILINEAR)
                fy = 4 * u * math.sin(t * 2.2)
                bx = int(n * 0.70 - bw / 2)
                by = int(n * 0.20 - bw / 2 + fy)
                frame.paste(bub, (bx, by), bub)
                ic = self._icon_img(self._icon)
                if ic is not None:
                    iw = max(4, int(self.icon_px * s))
                    ii = ic if iw == ic.width else ic.resize((iw, iw), Image.BILINEAR)
                    if self._icon in ("globe", "thinking", "wait"):
                        ii = ii.rotate(8 * math.sin(t * 3.0), resample=Image.BICUBIC)
                    ix = int(bx + bw * 0.56 - iw / 2)
                    iy = int(by + bw * 0.40 - iw / 2 + 2 * u * math.sin(t * 3.1))
                    frame.paste(ii, (ix, iy), ii)

        # Ovoz to'lqini (gapirganda)
        if level > 0.04:
            self._wave(frame, p, level)
        if self._badge is not None:
            m = int(12 * u)
            frame.paste(self._badge, (m, m), self._badge)
        if p.caption:
            self.subs.composite(frame, list(p.caption))
        return frame

    def _wave(self, frame: Image.Image, p: FaceParams, level: float) -> None:
        u, n, t = self.u, self.size, p.t
        w, h = int(92 * u), int(30 * u)
        x0 = int(n - w - 14 * u)
        y0 = int(14 * u)
        d = ImageDraw.Draw(frame, "RGBA")
        d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=h // 2, fill=(20, 20, 34, 110))
        bars, gap = 5, w / 6.0
        for i in range(bars):
            amp = 0.25 + 0.75 * level * (0.55 + 0.45 * math.sin(t * (9 + i * 1.7) + i))
            bh = max(3 * u, (h - 10 * u) * amp)
            bx = x0 + gap * (i + 1)
            d.rounded_rectangle((bx - 2.2 * u, y0 + h / 2 - bh / 2, bx + 2.2 * u, y0 + h / 2 + bh / 2), radius=int(2.2 * u),
                                fill=(255, 255, 255, 235))

    def render_i420(self, p: FaceParams) -> bytes:
        return rgb_to_i420(self.render(p))
