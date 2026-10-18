"""Premium avatar (Memoji uslubida): hajmli 3D yorug'lik, yumshoq soyalar, katta yaltiroq ko'zlar.

ML yoki tashqi model yo'q — faqat numpy + Pillow (Railway CPU'da ~10–20 ms/kadr).
Statik qatlamlar (fon, bosh, soch, gavda) BIR MARTA tayyorlanadi: 2D niqob "shishiriladi"
(blur → balandlik → normal) va har pikselga yorug'lik (diffuz + yaltiroq + teri ostidagi qizg'ish soya)
hisoblanadi. Har kadrda faqat ko'z, qosh, og'iz kichik qatlamlarda chiziladi, bosh esa
silliq aylantirilib/siljitilib qo'yiladi.

Ko'rinishlar (look): 'female' (Malika), 'male' (Jasur), 'orb' (Siri uslubidagi nur shari).
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


# ───────────────────────── Memoji uslubidagi odam ─────────────────────────
@dataclass(frozen=True)
class Style:
    skin: tuple
    skin_shadow: tuple
    hair: tuple
    iris: tuple
    lip: tuple
    brow: tuple
    top: tuple
    collar: tuple
    bg_top: tuple
    bg_bottom: tuple
    bg_glow: tuple
    female: bool


STYLES = {
    "female": Style(skin=(246, 205, 176), skin_shadow=(0.70, 0.46, 0.44), hair=(70, 44, 34), iris=(96, 62, 38),
                    lip=(206, 104, 112), brow=(74, 48, 38), top=(232, 236, 244), collar=(214, 220, 232),
                    bg_top=(255, 214, 196), bg_bottom=(206, 184, 240), bg_glow=(255, 244, 236), female=True),
    "male": Style(skin=(236, 192, 158), skin_shadow=(0.68, 0.46, 0.44), hair=(42, 32, 28), iris=(70, 50, 34),
                  lip=(184, 112, 104), brow=(46, 34, 28), top=(40, 52, 82), collar=(232, 236, 242),
                  bg_top=(186, 222, 250), bg_bottom=(150, 176, 236), bg_glow=(236, 248, 255), female=False),
}

# Bosh sprite'i: dizayn birligida 320×440, bosh markazi (160, 190)
HW, HH, HOX, HOY = 320, 440, 160, 190
FACE_CY = 205          # kadrda bosh markazi (dizayn birligi)


class PersonRenderer:
    def __init__(self, look: str = "female", size: int = 480, badge: Optional[str] = "AI yordamchi"):
        if size % 2 or size < 160:
            raise ValueError("BAD_SIZE")
        self.look = look if look in STYLES else "female"
        self.st = STYLES[self.look]
        self.size = size
        self.u = size / 480.0
        self.subs = SubtitleRenderer(size, font_size=max(14, int(22 * self.u)))
        self._badge = _glass_badge(badge, self.u) if badge else None
        self._rng = random.Random(7)
        self._bg = _gradient_bg(size, self.st.bg_top, self.st.bg_bottom, self.st.bg_glow)
        self._head = self._build_head()
        self._body = self._build_body()
        self._iris = self._build_iris(2)

    # ── statik: bosh ──
    def _face_pts(self) -> list[tuple[float, float]]:
        pts = []
        for i in range(36):
            t = 2 * math.pi * i / 36
            s, c = math.sin(t), math.cos(t)
            ry = 132 if s > 0 else 120
            narrow = 1 - 0.22 * max(0.0, s) ** 2.6
            pts.append((c * 100 * narrow, s * ry))
        return pts

    def _hair_tex(self, cv: _Canvas, crown: tuple[float, float]) -> np.ndarray:
        """Soch tolalari: cho'qqidan tarqaladigan ingichka yorug'/qorong'i chiziqlar."""
        img = Image.new("L", (cv.W, cv.H), 128)
        d = ImageDraw.Draw(img)
        r = self._rng
        cx, cy = crown
        for _ in range(420):
            a = r.uniform(-math.pi, math.pi)
            L = r.uniform(80, 260)
            bend = r.uniform(-0.35, 0.35)
            pts = []
            for k in range(9):
                t = k / 8
                ang = a + bend * t
                pts.append(cv.xy(cx + math.cos(ang) * L * t, cy + math.sin(ang) * L * t * 1.05 + 30 * t * t))
            v = 128 + r.choice((-1, 1)) * r.randint(18, 42)
            d.line(pts, fill=v, width=max(1, int(cv.s * r.uniform(0.8, 1.6))))
        img = img.filter(ImageFilter.GaussianBlur(0.6 * cv.s))
        return 0.82 + 0.36 * (_arr(img) - 0.5) * 2 * 0.5

    def _build_head(self) -> Image.Image:
        st = self.st
        s = self.u
        cv = _Canvas(HW, HH, HOX, HOY, s)
        img = Image.new("RGBA", (cv.W, cv.H), (0, 0, 0, 0))
        R = 34 * s

        if st.female:
            back = cv.poly_mask([(-118, -70), (-132, 10), (-130, 90), (-118, 150), (-86, 176), (-40, 168),
                                 (40, 168), (86, 176), (118, 150), (130, 90), (132, 10), (118, -70),
                                 (70, -138), (0, -152), (-70, -138)])
            tex = self._hair_tex(cv, (0, -120))
            _over(img, _shade(back, (st.hair[0] * 0.8, st.hair[1] * 0.8, st.hair[2] * 0.8), radius=R, depth=60 * s,
                              shadow=(0.45, 0.42, 0.45), spec=0.22, shin=10, rim=0.05, tex=tex))

        # Bo'yin (silindr) + iyak ostidagi soya
        neck = cv.poly_mask([(-36, 70), (36, 70), (40, 240), (-40, 240)], n=4)
        _over(img, _shade(neck, st.skin, radius=22 * s, depth=50 * s, shadow=st.skin_shadow, amb=0.25, spec=0.05))
        _over(img, _soft(cv.ell_mask(0, 120, 70, 34), (120, 60, 50), 0.38, 10 * s))

        # Quloqlar
        for sx in (-1, 1):
            ear = cv.ell_mask(sx * 97, 14, 17, 25)
            _over(img, _shade(ear, st.skin, radius=8 * s, depth=26 * s, shadow=st.skin_shadow, spec=0.08))
            _over(img, _soft(cv.ell_mask(sx * 98, 15, 8, 14), (150, 80, 70), 0.35, 3 * s))

        # Yuz
        face = cv.poly_mask(self._face_pts(), n=6)
        _over(img, _shade(face, st.skin, radius=46 * s, depth=120 * s, shadow=st.skin_shadow,
                          amb=0.34, wrap=0.6, spec=0.10, shin=14, rim=0.06))
        # Ko'z chuqurchasi, yonoq qizarishi, iyak/peshona yorug'i
        for sx in (-1, 1):
            _over(img, _soft(cv.ell_mask(sx * 40, -2, 30, 22), (150, 90, 80), 0.16, 8 * s))
            _over(img, _soft(cv.ell_mask(sx * 60, 42, 24, 14), (250, 120, 120), 0.30 if st.female else 0.16, 10 * s))
        _over(img, _soft(cv.ell_mask(-14, -64, 40, 22), (255, 245, 235), 0.20, 14 * s))

        # Burun: yumshoq hajm + uchidagi yaltiroq + burun teshiklari soyasi
        nose = cv.ell_mask(0, 30, 13, 19)
        n_img = _shade(nose, st.skin, radius=7 * s, depth=22 * s, shadow=st.skin_shadow, spec=0.12, shin=20)
        n_img.putalpha(Image.fromarray((np.asarray(nose, np.float32) * 0.75).astype(np.uint8), "L"))
        _over(img, n_img)
        for sx in (-1, 1):
            _over(img, _soft(cv.ell_mask(sx * 7, 44, 4, 2.6), (120, 60, 56), 0.55, 1.5 * s))
        if not st.female:  # yengil soqol izi
            jaw = cv.poly_mask([(-80, 60), (-60, 108), (-26, 130), (26, 130), (60, 108), (80, 60), (40, 92), (0, 98), (-40, 92)])
            _over(img, _soft(jaw, (90, 70, 70), 0.10, 9 * s))

        # Old soch
        if st.female:
            front = [(-108, 30), (-116, -40), (-98, -106), (-48, -146), (18, -150), (78, -128), (110, -80),
                     (116, -10), (108, 40), (94, -20), (78, -58), (40, -78), (0, -70), (-40, -52), (-72, -28), (-94, 6)]
        else:
            front = [(-100, -8), (-108, -66), (-88, -118), (-40, -152), (24, -156), (80, -134), (106, -92),
                     (106, -24), (98, -6), (92, -46), (64, -80), (20, -88), (-24, -86), (-64, -78), (-90, -48)]
        fm = cv.poly_mask(front)
        tex = self._hair_tex(cv, (10, -130))
        _over(img, _soft(fm, (60, 30, 20), 0.35, 6 * s))       # sochning yuzga tushgan soyasi
        _over(img, _shade(fm, st.hair, radius=20 * s, depth=70 * s, shadow=(0.42, 0.40, 0.44),
                          amb=0.32, spec=0.30, shin=9, rim=0.08, rim_col=(1.0, 0.9, 0.85), tex=tex))
        return img

    def _build_body(self) -> Image.Image:
        st = self.st
        s = self.u
        cv = _Canvas(480, 200, 240, 0, s)          # y=0 → kadrda 300
        img = Image.new("RGBA", (cv.W, cv.H), (0, 0, 0, 0))
        torso = cv.poly_mask([(-190, 220), (-182, 120), (-160, 62), (-112, 30), (-50, 12), (50, 12), (112, 30),
                              (160, 62), (182, 120), (190, 220)])
        _over(img, _shade(torso, st.top, radius=34 * s, depth=90 * s, shadow=(0.62, 0.62, 0.72), amb=0.42, spec=0.06))

        # gavda ustiga boshning yumshoq soyasi (teshik kesilishidan OLDIN — bo'yinga tushmaydi)
        sh = _soft(cv.ell_mask(0, 46, 84, 22), (40, 40, 70), 0.22, 12 * s)
        sh.putalpha(ImageChops.multiply(sh.getchannel("A"), img.getchannel("A")))
        _over(img, sh)
        # Bo'yin teshigi (bo'yin ko'rinadi) + yoqa
        hole = cv.poly_mask([(-40, 4), (40, 4), (34, 32), (0, 46), (-34, 32)])
        img.putalpha(ImageChops.subtract(img.getchannel("A"), hole))
        collar_pts = _spline([(-44, 8), (-33, 36), (0, 50), (33, 36), (44, 8)], 8, closed=False)
        band = cv.mask(lambda d, T, sc: d.line([T(x, y) for x, y in collar_pts], fill=255, width=int(10 * sc), joint="curve"))
        _over(img, _shade(band, st.collar, radius=4 * s, depth=10 * s, shadow=(0.6, 0.6, 0.7), amb=0.5, spec=0.05))
        return img

    # ── kadr ichidagi qismlar (2x chiziladi, keyin kichraytiriladi) ──
    def _build_iris(self, k: int) -> Image.Image:
        st = self.st
        r = 13 * self.u * k
        n = int(r * 2) + 2
        y, x = np.mgrid[0:n, 0:n].astype(np.float32)
        c = n / 2
        d = np.sqrt((x - c) ** 2 + (y - c) ** 2) / r
        base = np.array(st.iris, np.float32)
        col = base * (1.25 - 0.55 * d[..., None])                       # markazi yorug'roq
        ring = np.clip((d - 0.82) / 0.18, 0, 1)[..., None]
        col = col * (1 - ring * 0.6)                                    # qora limbal halqa
        pupil = np.clip((0.46 - d) / 0.04, 0, 1)[..., None]
        col = col * (1 - pupil) + np.array([14, 10, 10], np.float32) * pupil
        a = np.clip((1 - d) * r, 0, 1) * 255
        rgba = np.dstack([np.clip(col, 0, 255), a]).astype(np.uint8)
        img = Image.fromarray(rgba, "RGBA")
        d2 = ImageDraw.Draw(img)
        hl = r * 0.34
        d2.ellipse((c - r * 0.55 - hl, c - r * 0.55 - hl, c - r * 0.55 + hl, c - r * 0.55 + hl), fill=(255, 255, 255, 235))
        hl2 = r * 0.15
        d2.ellipse((c + r * 0.38 - hl2, c + r * 0.36 - hl2, c + r * 0.38 + hl2, c + r * 0.36 + hl2), fill=(255, 255, 255, 190))
        return img

    def _eye(self, sx: int, p: FaceParams) -> tuple[Image.Image, tuple[float, float]]:
        """Bitta ko'z (RGBA, 1x) va uning chap-yuqori burchagi (bosh sprite koordinatasida)."""
        u, k = self.u, 2
        rx, ry = 22 * u * k, 17 * u * k
        W, H = int(rx * 2 + 16 * u * k), int(ry * 2 + 18 * u * k)
        W += W % 2
        H += H % 2
        cx, cy = W / 2, H / 2 + 2 * u * k
        open_k = max(0.0, min(1.12, p.eye_open)) * (1 - max(0.0, min(1.0, p.blink)))
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        xs = np.linspace(-1, 1, 25)
        top = [(cx + x * rx, cy + ry * math.sqrt(max(0.0, 1 - x * x)) * (1 - 2 * min(1.0, open_k))) for x in xs]
        bot = [(cx + x * rx, cy + ry * math.sqrt(max(0.0, 1 - x * x)) * 0.92) for x in reversed(xs)]
        d = ImageDraw.Draw(layer)
        brow_col = (*self.st.brow, 255)
        if open_k > 0.06:
            mask = Image.new("L", (W, H), 0)
            ImageDraw.Draw(mask).polygon(top + bot, fill=255)
            eye = Image.new("RGBA", (W, H), (250, 250, 252, 255))
            ed = ImageDraw.Draw(eye)
            # sklera chetlari biroz kulrang (hajm)
            for i in range(6):
                f = i / 6
                ed.ellipse((cx - rx * (1 + 0.1 - f * 0.1), cy - ry * (1.1 - f * 0.1), cx + rx * (1.1 - f * 0.1), cy + ry * (1.1 - f * 0.1)),
                           outline=(int(222 + 28 * f), int(222 + 28 * f), int(230 + 22 * f), 255), width=int(2 * u * k))
            ir = self._iris
            ix = cx + p.gaze_x * 7 * u * k - ir.width / 2
            iy = cy + p.gaze_y * 4 * u * k - ir.height / 2 - 1 * u * k
            eye.alpha_composite(ir, (int(ix), int(iy)))
            # yuqori qovoq soyasi
            sh = Image.new("L", (W, H), 0)
            ImageDraw.Draw(sh).line(top, fill=150, width=int(7 * u * k))
            sh = sh.filter(ImageFilter.GaussianBlur(3 * u * k))
            eye = Image.composite(Image.new("RGBA", (W, H), (110, 80, 80, 255)), eye, sh.point(lambda v: int(v * 0.55)))
            layer.paste(eye, (0, 0), mask)
            d.line(top, fill=brow_col, width=int(3.6 * u * k), joint="curve")
            if self.st.female:   # kipriklar
                for side in (-1, 1) if False else (1,):
                    pass
                ex, ey = top[-1] if sx > 0 else top[0]
                dirx = 1 if sx > 0 else -1
                for j, (lx, ly) in enumerate(((7, -5), (11, -2), (13, 2))):
                    d.line([(ex - dirx * j * 3 * u * k, ey + j * 1.0 * u * k),
                            (ex + dirx * lx * u * k, ey + ly * u * k - 3 * u * k)], fill=brow_col, width=int(2.4 * u * k))
            d.line(bot[6:-6], fill=(170, 120, 110, 110), width=int(1.6 * u * k))
        else:
            d.arc((cx - rx, cy - ry * 0.5, cx + rx, cy + ry * 0.9), 15, 165, fill=brow_col, width=int(3.6 * u * k))
            if self.st.female:
                for j in range(3):
                    ax = cx + (j - 1) * rx * 0.45
                    d.line([(ax, cy + ry * 0.62), (ax + (j - 1) * 3 * u * k, cy + ry * 0.62 + 6 * u * k)], fill=brow_col, width=int(2 * u * k))
        out = layer.reduce(k)
        ox = (HOX + sx * 40) * u - out.width / 2
        oy = (HOY - 2) * u - out.height / 2
        return out, (ox, oy)

    def _brows(self, head: Image.Image, p: FaceParams) -> None:
        u, k = self.u, 2
        W, H = int(HW * u * k), int(80 * u * k)
        y0 = (HOY - 70) * u                         # qatlam bosh sprite'ida shu y dan boshlanadi
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        col = (*self.st.brow, 255)
        width = (6.0 if self.st.female else 8.5) * u * k
        for sx in (-1, 1):
            raise_ = p.brow_raise * 8 + (p.brow_asym * 9 if sx > 0 else 0)
            by = -36 - raise_
            inner = (sx * 20, by - p.brow_tilt * 7 + 2)
            mid = (sx * 42, by - 5 - p.brow_tilt * 2)
            outer = (sx * 64, by + 4 + p.brow_tilt * 3)
            pts = _spline([inner, mid, outer], 8, closed=False)
            T = [((HOX + x) * u * k, ((HOY + y) * u - y0) * k) for x, y in pts]
            for i in range(len(T) - 1):
                f = i / (len(T) - 1)
                w = width * (1.0 - 0.45 * f)
                d.line([T[i], T[i + 1]], fill=col, width=max(1, int(w)))
                d.ellipse((T[i][0] - w / 2, T[i][1] - w / 2, T[i][0] + w / 2, T[i][1] + w / 2), fill=col)
        out = layer.reduce(k)
        head.alpha_composite(out, (0, int(y0)))

    def _mouth(self, head: Image.Image, p: FaceParams) -> None:
        u, k = self.u, 2
        W, H = int(110 * u * k), int(80 * u * k)
        cx, cy = W / 2, 26 * u * k
        mw = 27 * max(0.55, min(1.3, p.mouth_width)) * (1 + 0.1 * max(0.0, p.smile)) * u * k
        lift = 8 * p.smile * u * k
        op = max(0.0, min(1.0, p.mouth_open))
        xs = np.linspace(-1, 1, 21)

        def upper(x: float) -> tuple[float, float]:
            return (cx + x * mw, cy - lift * x * x + lift * 0.3 - op * 5 * u * k * (1 - x * x))

        def lower(x: float) -> tuple[float, float]:
            return (cx + x * mw, cy - lift * x * x + lift * 0.3 + op * 26 * u * k * (1 - x * x) ** 0.85)

        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        lip = self.st.lip
        if op < 0.06:
            line = [upper(x) for x in xs]
            # lab: yuqori ingichka, pastki to'liqroq (yaltiroq bilan)
            lower_lip = line + [(px, py + (7 if self.st.female else 4.5) * u * k * max(0.0, 1 - ((px - cx) / mw) ** 2) ** 0.8)
                                for px, py in reversed(line)]
            d.polygon(lower_lip, fill=(*lip, 230 if self.st.female else 150))
            upper_lip = [(px, py - (4.5 if self.st.female else 2.5) * u * k * max(0.0, 1 - ((px - cx) / mw) ** 2) ** 0.7) for px, py in line] + list(reversed(line))
            d.polygon(upper_lip, fill=(*[int(c * 0.88) for c in lip], 230 if self.st.female else 140))
            d.line(line, fill=(120, 54, 60, 255), width=max(1, int(2.6 * u * k)), joint="curve")
            hx, hy = cx + 4 * u * k, cy + 4 * u * k
            d.ellipse((hx - 7 * u * k, hy - 1.5 * u * k, hx + 7 * u * k, hy + 1.5 * u * k), fill=(255, 255, 255, 70))
        else:
            top = [upper(x) for x in xs]
            bot = [lower(x) for x in reversed(xs)]
            poly = top + bot
            inner = Image.new("RGBA", (W, H), (70, 22, 34, 255))
            idr = ImageDraw.Draw(inner)
            ty = min(q[1] for q in top)
            if op > 0.18:
                idr.rounded_rectangle((cx - mw * 0.72, ty - 4 * u * k, cx + mw * 0.72, ty + 6 * u * k * min(1.0, op * 1.6)),
                                      radius=int(3 * u * k), fill=(250, 248, 244, 255))
                by = max(q[1] for q in bot)
                idr.ellipse((cx - mw * 0.55, by - 12 * u * k * op, cx + mw * 0.55, by + 6 * u * k), fill=(214, 100, 112, 255))
            m = Image.new("L", (W, H), 0)
            ImageDraw.Draw(m).polygon(poly, fill=255)
            layer.paste(inner, (0, 0), m)
            d.line(top, fill=(*[int(c * 0.88) for c in lip], 255), width=int(4.0 * u * k), joint="curve")
            d.line(bot, fill=(*lip, 255), width=int((6.5 if self.st.female else 4.5) * u * k), joint="curve")
            # pastki labdagi yaltiroq
            bx, byy = cx + 3 * u * k, max(q[1] for q in bot) + 1 * u * k
            d.ellipse((bx - 7 * u * k, byy - 1.4 * u * k, bx + 7 * u * k, byy + 1.4 * u * k), fill=(255, 255, 255, 80))
        out = layer.reduce(k)
        head.alpha_composite(out, (int((HOX * u) - out.width / 2), int((HOY + 70) * u - 26 * u)))

    # ── kadr ──
    def render(self, p: FaceParams) -> Image.Image:
        u = self.u
        frame = self._bg.copy().convert("RGBA")
        head = self._head.copy()
        if p.blush > 0.45:   # quvonchda yonoqlar biroz qizaradi
            pass
        self._brows(head, p)
        for sx in (-1, 1):
            e, (ox, oy) = self._eye(sx, p)
            head.alpha_composite(e, (int(round(ox)), int(round(oy))))
        self._mouth(head, p)
        if abs(p.tilt_deg) > 0.05:
            head = head.rotate(-p.tilt_deg, resample=Image.BICUBIC, center=(HOX * u, HOY * u))
        hx = int(round((240 + p.dx - HOX) * u))
        hy = int(round((FACE_CY + p.dy - HOY) * u))
        frame.alpha_composite(head, (hx, hy)) if hx >= 0 and hy >= 0 else frame.paste(head, (hx, hy), head)
        bx = int(round(p.body_dx * u))
        by = int(round((300 + p.breath * 1.5) * u))
        frame.paste(self._body, (bx, by), self._body)
        out = frame.convert("RGB")
        if self._badge is not None:
            m = int(12 * u)
            out.paste(self._badge, (m, m), self._badge)
        if p.caption:
            self.subs.composite(out, list(p.caption))
        return out

    def render_i420(self, p: FaceParams) -> bytes:
        return rgb_to_i420(self.render(p))


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
            else:
                # Owner 2026-10-19: premium 3D odam (Blender/MakeHuman kadrlari); bo'lmasa — chizilgan yuz
                from . import real3d
                r = real3d.RealRenderer(key[0], size) if real3d.available(key[0]) else PersonRenderer(key[0], size)
            _cache[key] = r
        return r


def warm_up(size: int = 480) -> None:
    for lk in LOOKS:
        try:
            get_renderer(lk, size)
        except Exception:
            pass
