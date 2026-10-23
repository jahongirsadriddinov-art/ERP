"""Har akkaunt uchun BARQAROR, haqiqiy Telegram Desktop'ga o'xshash mijoz "barmoq izi" (anti-freeze, owner 2026-10-23).

Avval hamma akkauntlar device_model="QurilishERP AI", system_version="Windows", app_version=<worker versiyasi> bilan
ulanardi — bunday nostandart iz Telegram spam tizimiga "bot/avtomatlashtirish" belgisi. Endi:

  • har akkauntga bir marta (akkaunt id'sidan deterministik) haqiqiy kompyuter modeli, "Windows 10/11 x64",
    joriy Telegram Desktop versiyasi ("6.x.y x64") va til (ru/uz/en) tanlanadi;
  • iz sessiya yonida saqlanadi (<sessiya>.device.json, sir emas) — har ishga tushishda O'ZGARMAYDI;
  • faqat app_version yangilanadi, agar saqlangan versiya ro'yxatdan chiqib ketgan bo'lsa (haqiqiy ilova ham yangilanadi);
  • fayl qo'lda tahrirlansa (masalan haqiqiy telefonda ko'ringan model) — o'sha qiymatlar ishlatiladi;
  • 'addedAt' — shu worker akkauntni birinchi ko'rgan vaqt (isitish/warm-up davri shundan hisoblanadi).
Mavjud sessiyalar ishlashda davom etadi: auth key o'zgarmaydi, faqat initConnection parametrlari.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger("tgw.fingerprint")

# Haqiqiy Windows kompyuterlari (Telegram Desktop device_model sifatida anakart/noutbuk modelini yuboradi)
DEVICE_MODELS = (
    "Desktop", "MS-7C02", "MS-7B86", "MS-7C91", "B450M DS3H", "B550M AORUS ELITE", "PRIME B560M-A", "H510M-K",
    "Inspiron 15 3511", "Inspiron 3501", "Vostro 3500", "OptiPlex 7090", "Latitude 5420",
    "HP Pavilion Laptop 15-eg0xxx", "HP Laptop 15s-fq2xxx", "HP ProBook 450 G8", "HP EliteBook 840 G7",
    "Lenovo IdeaPad 3 15ITL6", "Lenovo V15 G2 ITL", "ThinkPad E14 Gen 2", "ThinkPad T14 Gen 1",
    "ASUS TUF Gaming F15", "VivoBook_ASUSLaptop X515EA", "ASUS Vivobook 15 X1500EA",
    "Aspire A315-58", "Nitro AN515-57", "MSI GF63 Thin 10SC", "Redmi Book Pro 15",
)
SYSTEMS = (("Windows 10 x64", 55), ("Windows 11 x64", 45))
# Joriy Telegram Desktop versiyalari (TG_APP_VERSIONS="6.2.4,6.3.0" bilan yangilanadi; " x64" o'zi qo'shiladi)
APP_VERSIONS = ("6.1.3", "6.2.4", "6.3.0")
# O'zbekistondagi foydalanuvchilar: ko'pchiligi rus tilli interfeys, keyin o'zbek, ingliz
LANGS = ((("ru", "ru-RU"), 55), (("uz", "uz-UZ"), 30), (("en", "en-US"), 15))

FIELDS = ("device_model", "system_version", "app_version", "lang_code", "system_lang_code")


def app_versions() -> tuple[str, ...]:
    raw = os.environ.get("TG_APP_VERSIONS", "").strip()
    vs = tuple(v.strip() for v in raw.split(",") if v.strip()) if raw else APP_VERSIONS
    return tuple(v if v.endswith(" x64") else f"{v} x64" for v in vs) or tuple(f"{v} x64" for v in APP_VERSIONS)


def _rng(seed: str) -> random.Random:
    return random.Random(int.from_bytes(hashlib.sha256(f"tgw-fp:{seed}".encode("utf-8")).digest()[:8], "big"))


def _weighted(r: random.Random, items):
    total = sum(w for _, w in items)
    x = r.uniform(0, total)
    for v, w in items:
        x -= w
        if x <= 0:
            return v
    return items[-1][0]


def generate(seed: str, now_ms: Optional[int] = None) -> dict:
    """Seed (akkaunt id) bo'yicha deterministik iz — fayl yo'qolsa ham bir xil chiqadi."""
    r = _rng(seed or "platform")
    lang, sys_lang = _weighted(r, LANGS)
    vs = app_versions()
    return {
        "device_model": r.choice(DEVICE_MODELS),
        "system_version": _weighted(r, SYSTEMS),
        "app_version": vs[r.randrange(len(vs))],
        "lang_code": lang,
        "system_lang_code": sys_lang,
        "addedAt": int(now_ms if now_ms is not None else time.time() * 1000),
    }


def _valid(fp: dict) -> bool:
    return all(isinstance(fp.get(k), str) and 0 < len(fp[k]) <= 64 for k in FIELDS)


def fp_path(session_path: Path) -> Path:
    p = Path(session_path)
    return p.with_name(p.stem + ".device.json")


def load_or_create(path: Path, seed: str, now_ms: Optional[int] = None) -> dict:
    """Saqlangan izni o'qiydi; bo'lmasa yaratib saqlaydi. Eskirgan app_version yangilanadi (boshqasi o'zgarmaydi)."""
    path = Path(path)
    fp: Optional[dict] = None
    try:
        if path.exists():
            data = json.loads(path.read_text("utf-8"))
            if isinstance(data, dict) and _valid(data):
                fp = data
    except (OSError, ValueError):
        fp = None
    changed = False
    if fp is None:
        fp = generate(seed, now_ms)
        changed = True
    else:
        vs = app_versions()
        if fp["app_version"] not in vs:
            # "Ilova yangilandi": eng yangi versiyalardan biri (seed bo'yicha barqaror)
            fp["app_version"] = vs[_rng(seed + ":upd").randrange(len(vs))]
            changed = True
        if not isinstance(fp.get("addedAt"), (int, float)):
            fp["addedAt"] = int(now_ms if now_ms is not None else time.time() * 1000)
            changed = True
    if changed:
        save(path, fp)
    return fp


def save(path: Path, fp: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(fp, ensure_ascii=False, indent=1), "utf-8")
        os.replace(tmp, path)
    except OSError as e:
        log.warning("qurilma izi saqlanmadi: %s", type(e).__name__)


def client_kwargs(fp: dict) -> dict:
    return {k: fp[k] for k in FIELDS}
