"""2D stillashtirilgan "inson" yuzi — Pillow bilan chiziladi (ML yo'q, oddiy CPU'da ~15 fps 480x480).

Yuz 2x o'lchamda chiziladi va kichraytiriladi (silliq chetlar). Fon va badge bir marta tayyorlanadi.
Chiqish: RGB PIL rasm yoki I420 (YUV 4:2:0, BT.601 cheklangan diapazon) baytlari — Telegram/ntgcalls
tashqi kamera kadri formati.
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np
from PIL import Image, ImageDraw

from .state import FaceParams
from .subtitles import SubtitleRenderer, load_font

SS = 2  # supersampling

SKIN = (238, 196, 164)
SKIN_SHADE = (214, 166, 134)
HAIR = (54, 38, 32)
SHIRT = (44, 86, 150)
COLLAR = (236, 240, 246)
IRIS = (84, 58, 40)
LIP = (178, 92, 92)
MOUTH_IN = (88, 28, 38)
TONGUE = (206, 104, 112)
BLUSH = (242, 140, 140)
BROW = (50, 36, 30)


def _mix(a: tuple, b: tuple, k: float) -> tuple:
    k = max(0.0, min(1.0, k))
    return tuple(int(round(x + (y - x) * k)) for x, y in zip(a, b))


def rgb_to_i420(img: Image.Image) -> bytes:
    """RGB → I420 (Y, U, V tekisliklari ketma-ket), BT.601 cheklangan diapazon (WebRTC standarti)."""
    w, h = img.size
    if w % 2 or h % 2:
        raise ValueError("EVEN_SIZE_REQUIRED")
    ycc = np.asarray(img.convert("YCbCr"), dtype=np.uint16)        # JPEG to'liq diapazon
    y = (16 + (ycc[:, :, 0] * 219 + 127) // 255).astype(np.uint8)
    c = ycc[:, :, 1:].reshape(h // 2, 2, w // 2, 2, 2).sum(axis=(1, 3))  # 2x2 o'rtacha (×4)
    c = (128 * 4 * 255 + (c.astype(np.int32) - 128 * 4) * 224 + 2 * 255) // (4 * 255)
    c = np.clip(c, 0, 255).astype(np.uint8)
    return y.tobytes() + np.ascontiguousarray(c[:, :, 0]).tobytes() + np.ascontiguousarray(c[:, :, 1]).tobytes()


def i420_size(w: int, h: int) -> int:
    return w * h * 3 // 2


class FaceRenderer:
    def __init__(self, size: int = 480, badge: Optional[str] = "AI yordamchi"):
        if size % 2 or size < 160:
            raise ValueError("BAD_SIZE")
        self.size = size
        self.u = size / 480.0                      # dizayn 480 birlikda
        self.subs = SubtitleRenderer(size, font_size=max(14, int(22 * self.u)))
        self._bg = self._make_background()
        self._badge = self._make_badge(badge) if badge else None

    # ── statik qatlamlar ──
    def _make_background(self) -> Image.Image:
        n = self.size * SS
        yy = np.linspace(0.0, 1.0, n, dtype=np.float32)[:, None]
        xx = np.linspace(-1.0, 1.0, n, dtype=np.float32)[None, :]
        top = np.array([206, 226, 240], np.float32)
        bot = np.array([150, 182, 214], np.float32)
        g = top[None, None, :] * (1 - yy[..., None]) + bot[None, None, :] * yy[..., None]
        vign = 1.0 - 0.12 * (xx ** 2)[..., None]
        arr = np.clip(g * vign, 0, 255).astype(np.uint8)
        return Image.fromarray(np.ascontiguousarray(arr), "RGB")

    def _make_badge(self, text: str) -> Image.Image:
        font = load_font(max(11, int(15 * self.u)))
        tw = int(font.getlength(text))
        asc, desc = font.getmetrics()
        pad = int(8 * self.u)
        dot = int(10 * self.u)
        w, h = tw + 3 * pad + dot, asc + desc + pad
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((0, 0, w - 1, h - 1), radius=h // 2, fill=(10, 14, 24, 150))
        cy = h // 2
        d.ellipse((pad, cy - dot // 2, pad + dot, cy + dot // 2), fill=(64, 210, 120, 255))
        d.text((2 * pad + dot, (h - asc - desc) // 2), text, font=font, fill=(255, 255, 255, 255))
        return img

    # ── yordamchi ──
    def _p(self, v: float) -> float:
        return v * self.u * SS

    def _rot(self, cx: float, cy: float, x: float, y: float, ang: float) -> tuple[float, float]:
        s, c = math.sin(ang), math.cos(ang)
        dx, dy = x - cx, y - cy
        return cx + dx * c - dy * s, cy + dx * s + dy * c

    def _ell(self, d: ImageDraw.ImageDraw, x: float, y: float, rx: float, ry: float, fill) -> None:
        if rx <= 0 or ry <= 0:
            return
        d.ellipse((x - rx, y - ry, x + rx, y + ry), fill=fill)

    # ── kadr ──
    def render(self, p: FaceParams) -> Image.Image:
        P = self._p
        img = self._bg.copy()
        d = ImageDraw.Draw(img)
        n = self.size * SS
        cx = n / 2 + P(p.dx)
        cy = P(212) + P(p.dy)
        bcx = n / 2 + P(p.body_dx)
        ang = math.radians(p.tilt_deg)

        # Gavda (yelka + ko'ylak), bo'yin
        sh_y = P(408) + P(p.breath * 1.6)
        self._ell(d, bcx, sh_y + P(120), P(205), P(150), SHIRT)
        d.rectangle((cx - P(36), cy + P(80), cx + P(36), sh_y - P(10)), fill=SKIN_SHADE)
        d.polygon([(bcx - P(58), sh_y - P(30)), (bcx + P(58), sh_y - P(30)), (bcx, sh_y + P(52))], fill=COLLAR)
        d.polygon([(bcx - P(40), sh_y - P(32)), (bcx + P(40), sh_y - P(32)), (bcx, sh_y + P(30))], fill=SKIN_SHADE)

        def R(x: float, y: float) -> tuple[float, float]:
            return self._rot(cx, cy, cx + P(x), cy + P(y), ang)

        # Quloqlar, bosh, soch
        for sx in (-1, 1):
            ex, ey = R(sx * 108, 12)
            self._ell(d, ex, ey, P(17), P(27), SKIN_SHADE)
        hx, hy = R(0, 0)
        self._ell(d, hx, hy, P(108), P(132), SKIN)
        tx, ty = R(0, -58)
        d.chord((tx - P(116), ty - P(88), tx + P(116), ty + P(88)), 180 + p.tilt_deg, 360 + p.tilt_deg, fill=HAIR)
        for sx in (-1, 1):
            fx, fy = R(sx * 98, -40)
            self._ell(d, fx, fy, P(18), P(40), HAIR)
        fx, fy = R(-30, -70)
        self._ell(d, fx, fy, P(62), P(26), HAIR)               # peshona tutami

        # Yonoq qizarishi
        if p.blush > 0.02:
            col = _mix(SKIN, BLUSH, 0.45 * p.blush)
            for sx in (-1, 1):
                bx, by = R(sx * 62, 44)
                self._ell(d, bx, by, P(20), P(11), col)

        self._eyes(img, d, p, R)
        self._brows(d, p, R)
        # Burun
        nx, ny = R(0, 30)
        d.arc((nx - P(11), ny - P(8), nx + P(11), ny + P(8)), 20, 160, fill=SKIN_SHADE[:3], width=int(P(3)))
        self._mouth(img, d, p, R)

        out = img.reduce(SS)
        if self._badge is not None:
            m = int(12 * self.u)
            out.paste(self._badge, (m, m), self._badge)
        if p.caption:
            self.subs.composite(out, list(p.caption))
        return out

    def _eyes(self, img: Image.Image, d: ImageDraw.ImageDraw, p: FaceParams, R) -> None:
        P = self._p
        open_k = max(0.0, min(1.15, p.eye_open)) * (1.0 - max(0.0, min(1.0, p.blink)))
        rx, ry = P(20), P(13) * open_k
        for sx in (-1, 1):
            ex, ey = R(sx * 42, -6)
            if ry < P(1.6):
                # Yopiq ko'z — kiprik chizig'i
                d.arc((ex - rx, ey - P(6), ex + rx, ey + P(6)), 10, 170, fill=BROW, width=int(P(3)))
                continue
            bw, bh = int(rx * 2) + 4, int(ry * 2) + 4
            layer = Image.new("RGB", (bw, bh), (250, 250, 250))
            ld = ImageDraw.Draw(layer)
            ix = bw / 2 + p.gaze_x * P(7)
            iy = bh / 2 + p.gaze_y * P(4)
            self._ell(ld, ix, iy, P(9.5), P(9.5), IRIS)
            self._ell(ld, ix, iy, P(4.6), P(4.6), (18, 14, 12))
            self._ell(ld, ix - P(3), iy - P(3.2), P(2.4), P(2.4), (255, 255, 255))
            mask = Image.new("L", (bw, bh), 0)
            ImageDraw.Draw(mask).ellipse((2, 2, bw - 2, bh - 2), fill=255)
            img.paste(layer, (int(ex - bw / 2), int(ey - bh / 2)), mask)
            # Yuqori qovoq chizig'i
            d.arc((ex - rx - P(1), ey - ry - P(1), ex + rx + P(1), ey + ry + P(1)), 195, 345, fill=BROW, width=int(P(3)))

    def _brows(self, d: ImageDraw.ImageDraw, p: FaceParams, R) -> None:
        P = self._p
        for sx in (-1, 1):
            raise_ = p.brow_raise * 8 + (p.brow_asym * 9 if sx > 0 else 0)
            base_y = -34 - raise_
            inner = (sx * 22, base_y - p.brow_tilt * 7 + 1)
            outer = (sx * 62, base_y + 3 + p.brow_tilt * 3)
            mid = (sx * 42, base_y - 4 - p.brow_tilt * 2)
            pts = [R(*inner), R(*mid), R(*outer)]
            d.line(pts, fill=BROW, width=int(P(6)), joint="curve")
            for q in (pts[0], pts[-1]):
                self._ell(d, q[0], q[1], P(3), P(3), BROW)

    def _mouth(self, img: Image.Image, d: ImageDraw.ImageDraw, p: FaceParams, R) -> None:
        P = self._p
        mw = 30 * max(0.55, min(1.3, p.mouth_width)) * (1 + 0.1 * max(0.0, p.smile))
        lift = 9 * p.smile
        op = max(0.0, min(1.0, p.mouth_open))
        steps = 12
        xs = [(-1 + 2 * i / steps) for i in range(steps + 1)]

        def upper(u: float) -> tuple[float, float]:
            return R(u * mw, 72 - lift * u * u + lift * 0.3 - op * 5 * (1 - u * u))

        def lower(u: float) -> tuple[float, float]:
            return R(u * mw, 72 - lift * u * u + lift * 0.3 + op * 30 * (1 - u * u) ** 0.85)

        if op < 0.06:
            pts = [upper(u) for u in xs]
            d.line(pts, fill=LIP, width=int(P(4)), joint="curve")
            return
        top = [upper(u) for u in xs]
        bot = [lower(u) for u in reversed(xs)]
        poly = top + bot
        x0 = min(q[0] for q in poly) - 2
        y0 = min(q[1] for q in poly) - 2
        x1 = max(q[0] for q in poly) + 2
        y1 = max(q[1] for q in poly) + 2
        bw, bh = int(x1 - x0) + 1, int(y1 - y0) + 1
        local = [(q[0] - x0, q[1] - y0) for q in poly]
        layer = Image.new("RGB", (bw, bh), MOUTH_IN)
        ld = ImageDraw.Draw(layer)
        if op > 0.22:
            # Tishlar (yuqori) va til (past)
            ty = min(q[1] for q in local[: steps + 1])
            ld.rectangle((0, 0, bw, ty + P(6) * min(1.0, op * 1.5)), fill=(246, 244, 238))
            self._ell(ld, bw / 2, bh - P(3), bw * 0.3, P(8) * op, TONGUE)
        mask = Image.new("L", (bw, bh), 0)
        ImageDraw.Draw(mask).polygon(local, fill=255)
        img.paste(layer, (int(x0), int(y0)), mask)
        d.line(top, fill=LIP, width=int(P(3.5)), joint="curve")
        d.line(bot, fill=LIP, width=int(P(4.5)), joint="curve")

    def render_i420(self, p: FaceParams) -> bytes:
        return rgb_to_i420(self.render(p))
