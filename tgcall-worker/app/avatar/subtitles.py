"""Subtitrlar: AI'ning joriy gapi pastda o'qiladigan qutida (o'zbek lotin matni).

Uzun gap sahifalarga (2 qatordan) bo'linadi; sahifa AI gapirgan vaqtga qarab almashadi.
"""
from __future__ import annotations

import os
import re
from functools import lru_cache
from typing import Callable, Optional

from PIL import Image, ImageDraw, ImageFont

MAX_CHARS = 400
_WS = re.compile(r"\s+")
_CTRL = re.compile(r"[\x00-\x1f\x7f]")
_APOS = re.compile(r"[ʻʼ‘’`´]")

# Windows / Linux shriftlari; topilmasa Pillow'ning ichki FreeType shrifti
_FONT_CANDIDATES = (
    "segoeui.ttf", "arial.ttf", "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
)


def clean_text(text: str) -> str:
    t = _APOS.sub("'", str(text or ""))
    t = _CTRL.sub(" ", t)
    t = _WS.sub(" ", t).strip()
    return t[:MAX_CHARS]


@lru_cache(maxsize=8)
def load_font(size: int) -> ImageFont.ImageFont:
    env = os.environ.get("AVATAR_FONT", "").strip()
    for name in ((env,) if env else ()) + _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(name, size)
        except (OSError, ValueError):
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # pragma: no cover — juda eski Pillow
        return ImageFont.load_default()


def text_width(font: ImageFont.ImageFont, s: str) -> float:
    return float(font.getlength(s))


def wrap_text(text: str, measure: Callable[[str], float], max_width: float) -> list[str]:
    """Ochko'z (greedy) so'z bo'yicha o'rash; sig'magan uzun so'z harflab bo'linadi."""
    words = clean_text(text).split(" ")
    lines: list[str] = []
    cur = ""
    for w in words:
        if not w:
            continue
        cand = w if not cur else cur + " " + w
        if measure(cand) <= max_width:
            cur = cand
            continue
        if cur:
            lines.append(cur)
            cur = ""
        while measure(w) > max_width and len(w) > 1:
            cut = len(w) - 1
            while cut > 1 and measure(w[:cut]) > max_width:
                cut -= 1
            lines.append(w[:cut])
            w = w[cut:]
        cur = w
    if cur:
        lines.append(cur)
    return lines


def paginate(lines: list[str], per_page: int = 2) -> list[list[str]]:
    return [lines[i:i + per_page] for i in range(0, len(lines), per_page)] or []


class SubtitleRenderer:
    """Matn sahifalarini RGBA rasm qilib keshlaydi (har kadrda qayta chizilmaydi)."""

    def __init__(self, width: int, font_size: int = 22, margin: int = 18, pad_x: int = 14, pad_y: int = 8,
                 lines_per_page: int = 2):
        self.width = width
        self.font = load_font(font_size)
        self.margin = margin
        self.pad_x = pad_x
        self.pad_y = pad_y
        self.lines_per_page = lines_per_page
        asc, desc = self.font.getmetrics()
        self.line_h = int(asc + desc + 2)
        self._cache: dict[tuple[str, ...], Image.Image] = {}

    @property
    def max_text_width(self) -> float:
        return self.width - 2 * (self.margin + self.pad_x)

    def pages(self, text: str) -> list[list[str]]:
        lines = wrap_text(text, lambda s: text_width(self.font, s), self.max_text_width)
        return paginate(lines, self.lines_per_page)

    def render(self, page: list[str]) -> Optional[Image.Image]:
        if not page:
            return None
        key = tuple(page)
        img = self._cache.get(key)
        if img is not None:
            return img
        widths = [text_width(self.font, s) for s in page]
        bw = int(max(widths) + 2 * self.pad_x)
        bh = int(self.line_h * len(page) + 2 * self.pad_y)
        img = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((0, 0, bw - 1, bh - 1), radius=12, fill=(10, 14, 24, 175))
        for i, s in enumerate(page):
            x = (bw - widths[i]) / 2
            y = self.pad_y + i * self.line_h
            d.text((x + 1, y + 1), s, font=self.font, fill=(0, 0, 0, 200))
            d.text((x, y), s, font=self.font, fill=(255, 255, 255, 255))
        if len(self._cache) > 32:
            self._cache.clear()
        self._cache[key] = img
        return img

    def composite(self, frame: Image.Image, page: list[str]) -> None:
        img = self.render(page)
        if img is None:
            return
        x = (frame.width - img.width) // 2
        y = frame.height - self.margin - img.height
        frame.paste(img, (x, y), img)
