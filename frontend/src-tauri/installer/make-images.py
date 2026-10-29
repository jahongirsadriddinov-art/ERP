"""Windows o'rnatuvchisi rasmlarini yasaydi (owner 2026-10-29: "full o'zgarishi kerak,
eskisi butunlay qolmasin, logolari ham xira edi - tiniq chiqsin").

NSIS ikkita BMP talab qiladi va o'lchamlari QAT'IY:
  header.bmp   150x57   - har sahifaning tepasida (logotip o'ngda)
  sidebar.bmp  164x314  - kutib olish va yakun sahifalarining chap ustuni

MUHIM: ikkala rasmning foni ham installer.nsi dagi MUI_BGCOLOR bilan BIR XIL
bo'lishi shart - aks holda rasm chekkasi "quti" bo'lib ajralib turadi.

Logotip 512x512 manbadan (icons/icon.png) kichraytiriladi - oldin 256 dan
olinardi va kichik o'lchamda xira chiqardi.

Ranglar ilovaning "Klassik" mavzusidan (frontend/src/app/App.tsx):
  primary #1B3A6B, accent #D2440F.

Qayta yasash:
    python frontend/src-tauri/installer/make-images.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
ICONS = HERE.parent / "icons"

# installer.nsi dagi MUI_BGCOLOR bilan bir xil bo'lsin
BG = (0x0A, 0x16, 0x2B)
PRIMARY = (0x1B, 0x3A, 0x6B)
ACCENT = (0xD2, 0x44, 0x0F)
WHITE = (0xFF, 0xFF, 0xFF)
DIM = (0x9F, 0xB2, 0xCE)


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    names = ("segoeuib.ttf", "arialbd.ttf") if bold else ("segoeui.ttf", "arial.ttf")
    for name in names:
        p = Path("C:/Windows/Fonts") / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def icon(size: int) -> Image.Image:
    """Eng katta manbadan (512x512) kichraytirish - kichik o'lchamda ham tiniq."""
    src = Image.open(ICONS / "icon.png").convert("RGBA")
    return src.resize((size, size), Image.LANCZOS)


def backdrop(w: int, h: int) -> Image.Image:
    """To'q fon + diagonal yorug'lik (tekis rang "o'lik" ko'rinmasin)."""
    img = Image.new("RGB", (w, h), BG)
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse([-w * 0.5, -h * 0.45, w * 1.3, h * 0.55], fill=(*PRIMARY, 210))
    g.ellipse([w * 0.35, h * 0.62, w * 1.7, h * 1.5], fill=(*ACCENT, 42))
    glow = glow.filter(ImageFilter.GaussianBlur(max(14, w // 6)))
    return Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")


def make_sidebar() -> None:
    w, h = 164, 314
    img = backdrop(w, h)
    d = ImageDraw.Draw(img)

    ic = icon(84)
    img.paste(ic, ((w - 84) // 2, 44), ic)

    f_name = font(18)
    name = "QurilishERP"
    d.text(((w - d.textlength(name, f_name)) / 2, 144), name, font=f_name, fill=WHITE)

    d.rectangle([w / 2 - 20, 172, w / 2 + 20, 174], fill=ACCENT)

    f_sub = font(11, bold=False)
    for i, line in enumerate(("Qurilish firmalari", "uchun yagona", "boshqaruv tizimi")):
        d.text(((w - d.textlength(line, f_sub)) / 2, 188 + i * 15), line, font=f_sub, fill=DIM)

    d.rectangle([0, h - 3, w, h], fill=ACCENT)
    img.save(HERE / "sidebar.bmp", "BMP")


def make_header() -> None:
    # Sarlavha yo'lagi: fon AYNAN MUI_BGCOLOR bo'lishi shart (gradient EMAS) -
    # aks holda rasm tugagan joyda ko'zga tashlanadigan chok paydo bo'ladi.
    w, h = 150, 57
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    ic = icon(36)
    img.paste(ic, (w - 46, (h - 36) // 2), ic)
    d.rectangle([w - 54, 14, w - 53, h - 14], fill=(0x24, 0x3C, 0x60))
    img.save(HERE / "header.bmp", "BMP")


if __name__ == "__main__":
    make_sidebar()
    make_header()
    print("tayyor: sidebar.bmp (164x314), header.bmp (150x57)")
