"""Akkaunt bo'yicha xulq-atvor chegaralari (anti-freeze, owner 2026-10-23).

Telegram spam tizimi "odamga o'xshamaydigan" faollikni muzlatadi: ko'p notanishga ketma-ket qo'ng'iroq/xabar,
ko'p kontakt importi, yangi akkauntdan darhol katta hajm. Shu modul har akkaunt uchun:

  • soatlik va kunlik chegaralar: chiquvchi qo'ng'iroq (call), o'zi boshlagan DM (dm), javob DM (reply — odam
    oxirgi 24 soatda o'zi yozgan bo'lsa), kontakt importi (import) va "sovuq" murojaat (cold — akkaunt bilan hech
    qachon yozishmagan odamga qo'ng'iroq/DM; aynan shu PEER_FLOOD va muzlatishga olib keladi, shuning uchun
    alohida, past chegara: yozishgan/kontakt odamlar afzal);
  • ISITISH (warm-up): akkaunt workerga qo'shilgandan keyingi birinchi TG_WARMUP_DAYS (standart 7) kun — ancha past chegaralar;
  • jitter: kunlik chegara har kuni 80–100% oralig'ida (akkaunt+kun bo'yicha barqaror), ketma-ket amallar orasida
    tasodifiy pauza (masalan qo'ng'iroqlar orasida 40–90 s) — "robot ritmi" bo'lmasin;
  • bir odamga: qo'ng'iroq kuniga ≤ 4 va oralig'i ≥ 10 daqiqa, o'zi boshlagan DM kuniga ≤ 3;
  • FloodWait — aniq Telegram aytgan muddatgacha shu turdagi amal to'xtaydi.
Hisoblagichlar diskda (<sessiya>.usage.json) — worker qayta ishga tushsa ham saqlanadi. Chegaralarni TG_LIMITS
JSON bilan o'zgartirish mumkin: {"call":{"hour":10,"day":50},"warmup":{"call":{"day":8}},"warmupDays":7}.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import time
from pathlib import Path
from typing import Callable, Optional

log = logging.getLogger("tgw.limits")

KINDS = ("call", "cold", "dm", "reply", "import")
CAPS = {
    "call": {"hour": 12, "day": 60},
    # "sovuq" — akkaunt bilan hech qachon yozishmagan / kontakt bo'lmagan odamga qo'ng'iroq yoki DM (PEER_FLOOD sababi)
    "cold": {"hour": 4, "day": 20},
    "dm": {"hour": 10, "day": 40},
    "reply": {"hour": 60, "day": 300},
    "import": {"hour": 5, "day": 15},
}
WARMUP_CAPS = {
    "call": {"hour": 3, "day": 10},
    "cold": {"hour": 1, "day": 3},
    "dm": {"hour": 2, "day": 5},
    "reply": {"hour": 30, "day": 120},
    "import": {"hour": 1, "day": 3},
}
WARMUP_DAYS = 7
# Ketma-ket amallar orasidagi minimal pauza (s): [min, max] — har safar tasodifiy
GAP_S = {"call": (40, 90), "cold": (0, 0), "dm": (20, 60), "reply": (1, 3), "import": (60, 180)}
# Bir odamga
PEER_CAPS = {"call": {"day": 4, "gap_s": 600}, "dm": {"day": 3, "gap_s": 1800}}
INBOUND_FRESH_S = 24 * 3600
HOUR, DAY = 3600, 24 * 3600


def _env_caps() -> dict:
    raw = os.environ.get("TG_LIMITS", "").strip()
    if not raw:
        return {}
    try:
        d = json.loads(raw)
        return d if isinstance(d, dict) else {}
    except ValueError:
        log.warning("TG_LIMITS JSON noto'g'ri — standart chegaralar")
        return {}


def _merge(base: dict, over: dict) -> dict:
    out = {k: dict(v) for k, v in base.items()}
    for k, v in (over or {}).items():
        if k in out and isinstance(v, dict):
            for kk in ("hour", "day"):
                if isinstance(v.get(kk), (int, float)) and v[kk] >= 0:
                    out[k][kk] = int(v[kk])
    return out


class UsageLimiter:
    def __init__(self, path: Optional[Path], seed: str, added_at_ms: Optional[float] = None,
                 clock: Callable[[], float] = time.time, rng: Optional[random.Random] = None,
                 overrides: Optional[dict] = None):
        self.path = Path(path) if path else None
        self.seed = seed or "platform"
        self.clock = clock
        self.rng = rng or random.Random()
        ov = _env_caps() if overrides is None else overrides
        self.caps = _merge(CAPS, ov)
        self.warmup_caps = _merge(WARMUP_CAPS, ov.get("warmup") if isinstance(ov.get("warmup"), dict) else {})
        try:
            self.warmup_days = max(0.0, float(ov.get("warmupDays", os.environ.get("TG_WARMUP_DAYS", WARMUP_DAYS))))
        except (TypeError, ValueError):
            self.warmup_days = float(WARMUP_DAYS)
        self.added_at = float(added_at_ms) / 1000 if added_at_ms else clock()
        self.events: dict[str, list[float]] = {k: [] for k in KINDS}
        self.peers: dict[str, dict[str, list[float]]] = {"call": {}, "dm": {}}
        self.inbound: dict[str, float] = {}
        self.next_at: dict[str, float] = {}
        self.flood_until: dict[str, float] = {}
        self._load()

    # ── saqlash ──
    def _load(self) -> None:
        if not self.path or not self.path.exists():
            return
        try:
            d = json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError):
            return
        if not isinstance(d, dict):
            return
        for k in KINDS:
            v = (d.get("events") or {}).get(k)
            if isinstance(v, list):
                self.events[k] = [float(x) for x in v if isinstance(x, (int, float))]
        for k in ("call", "dm"):
            v = (d.get("peers") or {}).get(k)
            if isinstance(v, dict):
                self.peers[k] = {str(p): [float(x) for x in ts if isinstance(x, (int, float))] for p, ts in v.items() if isinstance(ts, list)}
        for name in ("inbound", "next_at", "flood_until"):
            v = d.get(name)
            if isinstance(v, dict):
                setattr(self, name, {str(a): float(b) for a, b in v.items() if isinstance(b, (int, float))})
        self._trim()

    def save(self) -> None:
        if not self.path:
            return
        self._trim()
        data = {"events": self.events, "peers": self.peers, "inbound": self.inbound, "next_at": self.next_at,
                "flood_until": self.flood_until}
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(self.path.suffix + ".tmp")
            tmp.write_text(json.dumps(data, separators=(",", ":")), "utf-8")
            os.replace(tmp, self.path)
        except OSError as e:
            log.debug("usage saqlanmadi: %s", type(e).__name__)

    def reset(self, added_at_ms: Optional[float] = None) -> None:
        """Yangi login (boshqa raqam bo'lishi mumkin) — hisob va isitish davri qaytadan."""
        self.added_at = float(added_at_ms) / 1000 if added_at_ms else self.clock()
        self.events = {k: [] for k in KINDS}
        self.peers = {"call": {}, "dm": {}}
        self.inbound, self.next_at, self.flood_until = {}, {}, {}
        self.save()

    def _trim(self) -> None:
        now = self.clock()
        for k in KINDS:
            self.events[k] = [t for t in self.events[k] if now - t < DAY]
        for k in self.peers:
            self.peers[k] = {p: kept for p, ts in self.peers[k].items() if (kept := [t for t in ts if now - t < DAY])}
        self.inbound = {p: t for p, t in self.inbound.items() if now - t < INBOUND_FRESH_S}
        self.next_at = {k: t for k, t in self.next_at.items() if t > now}
        self.flood_until = {k: t for k, t in self.flood_until.items() if t > now}

    # ── chegaralar ──
    @property
    def warming(self) -> bool:
        return self.warmup_days > 0 and self.clock() - self.added_at < self.warmup_days * DAY

    @property
    def warmup_until(self) -> Optional[float]:
        return self.added_at + self.warmup_days * DAY if self.warming else None

    def _day_factor(self) -> float:
        day = int((self.clock() + 5 * 3600) // DAY)   # Toshkent kuni (UTC+5)
        h = hashlib.sha256(f"{self.seed}:{day}".encode()).digest()
        return 0.8 + 0.2 * (h[0] / 255.0)

    def cap(self, kind: str) -> dict:
        base = (self.warmup_caps if self.warming else self.caps)[kind]
        day = base["day"]
        if day > 0:
            day = max(1, int(day * self._day_factor()))
        return {"hour": base["hour"], "day": day}

    def _count(self, kind: str, window: int) -> int:
        now = self.clock()
        return sum(1 for t in self.events[kind] if now - t < window)

    def _oldest_in(self, ts: list[float], window: int) -> float:
        now = self.clock()
        inside = [t for t in ts if now - t < window]
        return min(inside) if inside else now

    def check(self, kind: str, peer: Optional[int] = None) -> Optional[tuple[str, int]]:
        """Ruxsat bo'lsa None; aks holda (sabab, necha soniyadan keyin). Sabab: flood_wait | rate_limited | peer_limited."""
        now = self.clock()
        fu = self.flood_until.get(kind, 0)
        if fu > now:
            return "flood_wait", int(fu - now) + 1
        c = self.cap(kind)
        hour_n, day_n = self._count(kind, HOUR), self._count(kind, DAY)
        if day_n >= c["day"]:
            return "rate_limited", int(self._oldest_in(self.events[kind], DAY) + DAY - now) + 1
        if hour_n >= c["hour"]:
            return "rate_limited", int(self._oldest_in(self.events[kind], HOUR) + HOUR - now) + 1
        if peer is not None and kind in PEER_CAPS:
            ts = self.peers[kind].get(str(peer), [])
            pc = PEER_CAPS[kind]
            recent = [t for t in ts if now - t < DAY]
            if len(recent) >= pc["day"]:
                return "peer_limited", int(min(recent) + DAY - now) + 1
            if recent and now - max(recent) < pc["gap_s"]:
                return "peer_limited", int(max(recent) + pc["gap_s"] - now) + 1
        na = self.next_at.get(kind, 0)
        if na > now:
            return "rate_limited", int(na - now) + 1
        return None

    def take(self, kind: str, peer: Optional[int] = None) -> None:
        now = self.clock()
        self.events[kind].append(now)
        if peer is not None and kind in self.peers:
            self.peers[kind].setdefault(str(peer), []).append(now)
        lo, hi = GAP_S[kind]
        self.next_at[kind] = now + self.rng.uniform(lo, hi)
        self.save()

    def flood(self, kind: str, seconds: int) -> None:
        """Telegram FloodWait — aniq aytilgan muddatgacha shu turdagi amal yo'q."""
        self.flood_until[kind] = max(self.flood_until.get(kind, 0), self.clock() + max(1, int(seconds)))
        self.save()

    def note_inbound(self, peer: int) -> None:
        """Odam akkauntga o'zi yozdi/qo'ng'iroq qildi — unga javob berish tabiiy (reply chegarasi)."""
        prev = self.inbound.get(str(peer), 0)
        now = self.clock()
        self.inbound[str(peer)] = now
        if now - prev > 300:       # diskka tez-tez yozmaslik
            self.save()

    def wrote_recently(self, peer: int) -> bool:
        t = self.inbound.get(str(peer))
        return bool(t) and self.clock() - t < INBOUND_FRESH_S

    def snapshot(self) -> dict:
        """Panel uchun: bugungi ishlatilish va chegaralar."""
        self._trim()
        out: dict = {"warmup": self.warming}
        wu = self.warmup_until
        if wu:
            out["warmupUntil"] = int(wu * 1000)
        for k in KINDS:
            c = self.cap(k)
            out[k] = {"hour": self._count(k, HOUR), "day": self._count(k, DAY), "capHour": c["hour"], "capDay": c["day"]}
        return out


class ImportGate:
    """peers.PeerResolver'ning `limiter` interfeysi (take/allowed/max/used) — UsageLimiter + akkaunt holati ustida."""

    def __init__(self, usage: Callable[[], UsageLimiter], blocked: Callable[[], Optional[str]] = lambda: None):
        self._usage = usage
        self.blocked = blocked

    @property
    def max(self) -> int:
        return self._usage().cap("import")["hour"]

    @property
    def used(self) -> int:
        return self._usage()._count("import", HOUR)

    def allowed(self) -> bool:
        return not self.blocked() and self._usage().check("import") is None

    def take(self) -> bool:
        if not self.allowed():
            return False
        self._usage().take("import")
        return True
