"""Windows o'rnatuvchisi rasmlarini yasaydi (owner 2026-10-29: "yangicha dizayn, ilovaga moslashgan").

NSIS ikkita BMP talab qiladi va o'lchamlari QAT'IY:
  header.bmp   150x57   - har sahifaning tepasida (logotip o'ngda)
  sidebar.bmp  164x314  - kutib olish va yakun sahifalarining chap ustuni

Ranglar ilovaning standart mavzusidan olingan (frontend/src/app/App.tsx, "Klassik"):
  primary #1B3A6B (to'q ko'k), accent #D2440F (to'q sariq).

Ishga tushirish (rasmlarni qayta yasash kerak bo'lsa):
    python frontend/src-tauri/installer/make-images.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
ICONS = HERE.parent / "icons"

PRIMARY = (0x1B, 0x3A, 0x6B)
PRIMARY_DARK = (0x0A, 0x16, 0x2B)
ACCENT = (0xD2, 0x44, 0x0F)
WHITE = (0xFF, 0xFF, 0xFF)


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    for name in ("segoeuib.ttf" if bold else "segoeui.ttf", "arialbd.ttf" if bold else "arial.ttf"):
        p = Path("C:/Windows/Fonts") / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def vgrad(w: int, h: int, top: tuple, bottom: tuple) -> Image.Image:
    """Tepadan pastga silliq o'tuvchi fon."""
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img


def icon(size: int) -> Image.Image:
    src = Image.open(ICONS / "128x128@2x.png").convert("RGBA")
    return src.resize((size, size), Image.LANCZOS)


def make_sidebar() -> None:
    w, h = 164, 314
    img = vgrad(w, h, PRIMARY, PRIMARY_DARK)
    d = ImageDraw.Draw(img)

    # Yumshoq diagonal yorug'lik - tekis fon "o'lik" ko'rinmasin
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-70, -110, w + 40, 140], fill=(0x3E, 0x6D, 0xB5, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(26))   # chekkasi keskin bo'lmasin
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    d = ImageDraw.Draw(img)

    ic = icon(72)
    img.paste(ic, ((w - 72) // 2, 54), ic)

    f_name = font(17)
    name = "QurilishERP"
    d.text(((w - d.textlength(name, f_name)) / 2, 142), name, font=f_name, fill=WHITE)

    d.line([(w / 2 - 22, 170), (w / 2 + 22, 170)], fill=ACCENT, width=3)

    f_sub = font(11, bold=False)
    for i, line in enumerate(("Qurilish firmalari", "uchun boshqaruv", "tizimi")):
        d.text(((w - d.textlength(line, f_sub)) / 2, 184 + i * 15), line, font=f_sub, fill=(0xC3, 0xD1, 0xE8))

    d.rectangle([0, h - 4, w, h], fill=ACCENT)
    img.save(HERE / "sidebar.bmp", "BMP")


def make_header() -> None:
    # MUI sarlavha yo'lagi OQ - rasm ham oq fonda bo'lsa chegara ko'rinmaydi
    w, h = 150, 57
    img = Image.new("RGB", (w, h), WHITE)
    d = ImageDraw.Draw(img)

    ic = icon(34)
    img.paste(ic, (w - 42, (h - 34) // 2), ic)

    # Ingichka ajratgich - logotip sarlavha matnidan ajralib tursin
    d.rectangle([w - 48, 12, w - 47, h - 12], fill=(0xE1, 0xE7, 0xF0))
    img.save(HERE / "header.bmp", "BMP")


if __name__ == "__main__":
    make_sidebar()
    make_header()
    print("tayyor: sidebar.bmp (164x314), header.bmp (150x57)")
