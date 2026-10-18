"""Premium avatar (Memoji uslubida): hajmli 3D yorug'lik, yumshoq soyalar, katta yaltiroq ko'zlar.

ML yoki tashqi model yo'q — faqat numpy + Pillow (Railway CPU'da ~10–20 ms/kadr).
Statik qatlamlar (fon, bosh, soch, gavda) BIR MARTA tayyorlanadi: 2D niqob "shishiriladi"
(blur → balandlik → normal) va har pikselga yorug'lik (diffuz + yaltiroq + teri ostidagi qizg'ish soya)
hisoblanadi. Har kadrda faqat ko'z, qosh, og'iz kichik qatlamlarda chiziladi, bosh esa
silliq aylantirilib/siljitilib qo'yiladi.

Ko'rinishlar (look): 'female' / 'male' — Microsoft Fluent 3D emoji personaji (emoji3d.py, owner 2026-10-19:
o'zimiz chizgan yuz o'rniga), 'orb' — Siri uslubidagi nur shari (shu fayl).
Interfeys eski FaceRenderer bilan bir xil: render(p) -> RGB, render_i420(p) -> bytes, .subs.
"""
from __future__ import annotations

import math
import random
import threading
from dataclasses import dataclass
from typing import Optional

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from .face import rgb_to_i420
from .state import FaceParams
from .subtitles import SubtitleRenderer, load_font

LOOKS = ("female", "male", "orb")

_L = np.array([-0.42, -0.58, 0.70], np.float32)
_L /= np.linalg.norm(_L)
_H = _L + np.array([0, 0, 1], np.float32)
_H /= np.linalg.norm(_H)


# ───────────────────────── yordamchi geometriya ─────────────────────────
def _spline(pts: list[tuple[float, float]], n: int = 12, closed: bool = True) -> list[tuple[float, float]]:
    """Catmull-Rom — burchaksiz silliq kontur."""
    P = list(pts)
    m = len(P)
    out: list[tuple[float, float]] = []
    rng = range(m) if closed else range(m - 1)
    for i in rng:
        p0 = P[(i - 1) % m] if closed else P[max(0, i - 1)]
        p1 = P[i]
        p2 = P[(i + 1) % m] if closed else P[i + 1]
        p3 = P[(i + 2) % m] if closed else P[min(m - 1, i + 2)]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                       + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                       + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y))
    if not closed:
        out.append(P[-1])
    return out


class _Canvas:
    """Sprite koordinatalari: dizayn birligi (480 kadr) × s, markaz (ox, oy)."""

    def __init__(self, w: float, h: float, ox: float, oy: float, s: float):
        self.s = s
        self.W, self.H = int(round(w * s)), int(round(h * s))
        self.ox, self.oy = ox, oy

    def xy(self, x: float, y: float) -> tuple[float, float]:
        return ((x + self.ox) * self.s, (y + self.oy) * self.s)

    def mask(self, draw_fn, aa: int = 3) -> Image.Image:
        big = Image.new("L", (self.W * aa, self.H * aa), 0)
        d = ImageDraw.Draw(big)
        draw_fn(d, lambda x, y: tuple(v * aa for v in self.xy(x, y)), self.s * aa)
        return big.reduce(aa)

    def poly_mask(self, pts, n: int = 12) -> Image.Image:
        sp = _spline(pts, n)
        return self.mask(lambda d, T, s: d.polygon([T(x, y) for x, y in sp], fill=255))

    def ell_mask(self, x: float, y: float, rx: float, ry: float) -> Image.Image:
        return self.mask(lambda d, T, s: d.ellipse((*T(x - rx, y - ry), *T(x + rx, y + ry)), fill=255))


def _arr(m: Image.Image) -> np.ndarray:
    return np.asarray(m, dtype=np.float32) / 255.0


def _box(a: np.ndarray, r: int, axis: int) -> np.ndarray:
    if r < 1:
        return a
    pad = [(0, 0), (0, 0)]
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def _blur_f(a: np.ndarray, radius: float) -> np.ndarray:
    """Float gauss (3 marta box) — 8-bitli blur'dagi pog'onali chiziqlar bo'lmaydi."""
    r = max(1, int(round(radius * 0.87)))
    for _ in range(3):
        a = _box(_box(a, r, 0), r, 1)
    return a


def _normals(mask: Image.Image, radius: float, depth: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """2D niqobni "shishirish": chetga yaqinlashgan sari sirt yon tomonga buriladi."""
    b = _blur_f(_arr(mask), radius)
    h = np.sqrt(np.clip(b, 0, 1)) * depth
    gy, gx = np.gradient(h)
    nz = np.ones_like(h)
    inv = 1.0 / np.sqrt(gx * gx + gy * gy + nz)
    return -gx * inv, -gy * inv, nz * inv


def _shade(mask: Image.Image, base, *, radius: float, depth: float, shadow=(0.55, 0.45, 0.52),
           amb: float = 0.30, wrap: float = 0.45, spec: float = 0.18, shin: float = 18.0,
           rim: float = 0.10, rim_col=(1.0, 0.95, 0.95), tex: Optional[np.ndarray] = None) -> Image.Image:
    nx, ny, nz = _normals(mask, radius, depth)
    ndl = nx * _L[0] + ny * _L[1] + nz * _L[2]
    lam = np.clip((ndl + wrap) / (1 + wrap), 0, 1)
    k = amb + (1 - amb) * lam
    base = np.array(base, np.float32) / 255.0
    sh = base * np.array(shadow, np.float32)
    col = sh[None, None, :] * (1 - k)[..., None] + base[None, None, :] * k[..., None] * 1.04
    if tex is not None:
        col *= tex[..., None]
    ndh = np.clip(nx * _H[0] + ny * _H[1] + nz * _H[2], 0, 1)
    col += (spec * ndh ** shin)[..., None]
    fres = np.clip(1 - nz, 0, 1) ** 2.2
    col += (rim * fres)[..., None] * np.array(rim_col, np.float32)
    rgb = (np.clip(col, 0, 1) * 255).astype(np.uint8)
    img = Image.fromarray(np.ascontiguousarray(rgb), "RGB").convert("RGBA")
    img.putalpha(mask)
    return img


def _soft(mask: Image.Image, color, alpha: float, blur: float) -> Image.Image:
    """Yumshoq rangli dog' (qizarish, soya)."""
    m = mask.filter(ImageFilter.GaussianBlur(blur)) if blur > 0 else mask
    a = (np.asarray(m, np.float32) * alpha).astype(np.uint8)
    img = Image.new("RGBA", m.size, (*color, 0))
    img.putalpha(Image.fromarray(a, "L"))
    return img


def _over(dst: Image.Image, src: Image.Image) -> None:
    dst.alpha_composite(src)


def _gradient_bg(n: int, top, bottom, glow, glow_xy=(0.5, 0.42), glow_r=0.55) -> Image.Image:
    yy = np.linspace(0, 1, n, dtype=np.float32)[:, None, None]
    top = np.array(top, np.float32)
    bottom = np.array(bottom, np.float32)
    g = top * (1 - yy) + bottom * yy
    g = np.broadcast_to(g, (n, n, 3)).copy()
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    d = np.sqrt((x - glow_xy[0]) ** 2 + (y - glow_xy[1]) ** 2) / glow_r
    w = np.clip(1 - d, 0, 1) ** 2
    g = g * (1 - w[..., None] * 0.6) + np.array(glow, np.float32) * (w[..., None] * 0.6)
    vig = 1 - 0.18 * np.clip(np.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.7, 0, 1) ** 2
    g *= vig[..., None]
    return Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGB")


def _glass_badge(text: str, u: float) -> Image.Image:
    font = load_font(max(11, int(15 * u)))
    tw = int(font.getlength(text))
    asc, desc = font.getmetrics()
    pad = int(9 * u)
    dot = int(9 * u)
    w, h = tw + 3 * pad + dot, asc + desc + pad
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=h // 2, fill=(20, 20, 30, 110), outline=(255, 255, 255, 90))
    cy = h // 2
    d.ellipse((pad, cy - dot // 2, pad + dot, cy + dot // 2), fill=(52, 199, 89, 255))
    d.text((2 * pad + dot, (h - asc - desc) // 2), text, font=font, fill=(255, 255, 255, 255))
    return img


# ───────────────────────── Siri uslubidagi nur shari ─────────────────────────
class OrbRenderer:
    """Qorong'i fonda suzuvchi rangli nurlar shari: ovoz balandligiga qarab kattalashadi va yorqinlashadi."""

    COLORS = ((40, 200, 255), (150, 90, 255), (255, 80, 170), (60, 240, 200))

    def __init__(self, size: int = 480, badge: Optional[str] = "AI yordamchi"):
        if size % 2 or size < 160:
            raise ValueError("BAD_SIZE")
        self.size = size
        self.u = size / 480.0
        self.subs = SubtitleRenderer(size, font_size=max(14, int(22 * self.u)))
        self._badge = _glass_badge(badge, self.u) if badge else None
        self._bg = _gradient_bg(size, (14, 14, 26), (6, 6, 12), (40, 36, 80), glow_xy=(0.5, 0.45), glow_r=0.6)
        n = size
        self.R = int(118 * self.u)
        self.c = (n // 2, int(n * 0.45))
        r = int(self.R * 0.95)
        self._blobs = []
        for col in self.COLORS:
            b = Image.new("RGBA", (r * 2, r * 2), (0, 0, 0, 0))
            m = Image.new("L", (r * 2, r * 2), 0)
            ImageDraw.Draw(m).ellipse((r * 0.55, r * 0.55, r * 1.45, r * 1.45), fill=255)
            m = m.filter(ImageFilter.GaussianBlur(r * 0.16)).point(lambda v: int(v * 0.85))
            b = Image.new("RGB", (r * 2, r * 2), col)
            self._blobs.append((b, m))
        R = self.R
        sm = Image.new("L", (R * 8, R * 8), 0)
        ImageDraw.Draw(sm).ellipse((0, 0, R * 8 - 1, R * 8 - 1), fill=255)
        self._sphere_mask = sm.resize((R * 2, R * 2), Image.LANCZOS)
        # shisha yaltirog'i va chekka halqa
        y, x = np.mgrid[0:R * 2, 0:R * 2].astype(np.float32)
        dx, dy = (x - R) / R, (y - R) / R
        d = np.sqrt(dx * dx + dy * dy)
        edge = np.clip((d - 0.80) / 0.2, 0, 1) ** 2 * (d <= 1)
        spec = np.clip(1 - np.sqrt((dx + 0.35) ** 2 + (dy + 0.45) ** 2 * 1.8) / 0.38, 0, 1) ** 2
        a = np.clip(edge * 0.55 + spec * 0.55, 0, 1) * 255
        self._glass = Image.fromarray(np.dstack([np.full_like(a, 255), np.full_like(a, 255), np.full_like(a, 255), a]).astype(np.uint8), "RGBA")
        g = Image.new("L", (R * 4, R * 4), 0)
        ImageDraw.Draw(g).ellipse((R * 0.9, R * 0.9, R * 3.1, R * 3.1), fill=255)
        self._glow_mask = g.filter(ImageFilter.GaussianBlur(R * 0.35))

    def render(self, p: FaceParams) -> Image.Image:
        t = p.t
        level = max(0.0, min(1.0, p.mouth_open))
        thinking = 1.0 if p.emotion == "thinking" else 0.0
        speed = 0.35 + 0.9 * level - 0.15 * thinking
        frame = self._bg.copy()
        R = self.R
        cx, cy = self.c[0] + p.dx * 0.4 * self.u, self.c[1] + p.dy * 0.6 * self.u
        scale = 1.0 + 0.07 * level + 0.015 * p.breath
        # tashqi nur
        glow_col = self.COLORS[int(t * 0.2) % len(self.COLORS)]
        ga = 0.22 + 0.45 * level
        glow = Image.new("RGB", self._glow_mask.size, glow_col)
        gm = self._glow_mask.point(lambda v: int(v * ga))
        frame.paste(glow, (int(cx - R * 2), int(cy - R * 2)), gm)
        # shar ichi
        inner = Image.new("RGB", (R * 2, R * 2), (10, 12, 30))
        for i, (b, m) in enumerate(self._blobs):
            ang = t * speed * (1 + i * 0.37) + i * 1.7
            rad = R * (0.32 + 0.12 * math.sin(t * 0.7 + i))
            bx = R + math.cos(ang) * rad - b.width / 2
            by = R + math.sin(ang * 1.13) * rad - b.height / 2
            s = 0.85 + 0.35 * level + 0.08 * math.sin(t * 1.9 + i)
            bw = max(4, int(b.width * s))
            bb, mm = b.resize((bw, bw)), m.resize((bw, bw))
            layer = Image.new("RGB", (R * 2, R * 2), (0, 0, 0))
            layer.paste(bb, (int(bx + (b.width - bw) / 2), int(by + (b.height - bw) / 2)), mm)
            inner = ImageChops.screen(inner, layer)
        if scale != 1.0:
            n = max(4, int(R * 2 * scale)) // 2 * 2
            inner = inner.resize((n, n), Image.BILINEAR)
            sm = self._sphere_mask.resize((n, n), Image.BILINEAR)
            gl = self._glass.resize((n, n), Image.BILINEAR)
        else:
            n, sm, gl = R * 2, self._sphere_mask, self._glass
        ox, oy = int(cx - n / 2), int(cy - n / 2)
        frame.paste(inner, (ox, oy), sm)
        frame.paste(gl, (ox, oy), gl)
        if self._badge is not None:
            m = int(12 * self.u)
            frame.paste(self._badge, (m, m), self._badge)
        if p.caption:
            self.subs.composite(frame, list(p.caption))
        return frame

    def render_i420(self, p: FaceParams) -> bytes:
        return rgb_to_i420(self.render(p))


# ───────────────────────── kesh (bir marta quriladi) ─────────────────────────
_cache: dict[tuple[str, int], object] = {}
_lock = threading.Lock()


def normalize_look(look: Optional[str]) -> str:
    return look if look in LOOKS else "female"


def get_renderer(look: Optional[str], size: int = 480):
    """Tayyor renderer (qurish ~0.5–2 s — asyncio'dan run_in_executor orqali chaqiring)."""
    key = (normalize_look(look), size)
    with _lock:
        r = _cache.get(key)
        if r is None:
            if key[0] == "orb":
                r = OrbRenderer(size)
            else:  # owner 2026-10-19: chizilgan yuz o'rniga Microsoft Fluent 3D emoji personajlari
                from .emoji3d import EmojiRenderer
                r = EmojiRenderer(key[0], size)
            _cache[key] = r
        return r


def warm_up(size: int = 480) -> None:
    for lk in LOOKS:
        try:
            get_renderer(lk, size)
        except Exception:
            pass
