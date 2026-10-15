"""Sozlamalar: .env (worker papkasida) + muhit o'zgaruvchilari.

Sirlar (TG_API_HASH, TG_SESSION_KEY, kalit fayllari) faqat shu kompyuterda qoladi va HECH QACHON log qilinmaydi.
"""
from __future__ import annotations

import os
import re
import socket
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV = ROOT / ".env"

_WORKER_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


def load_env(path: Path = DEFAULT_ENV) -> None:
    """.env faylini o'qiydi (mavjud muhit o'zgaruvchilari ustun)."""
    try:
        from dotenv import load_dotenv
    except ImportError:  # pragma: no cover - dotenv requirements'da bor
        return
    if path.exists():
        load_dotenv(path, override=False)


def _resolve(p: str, default: str) -> Path:
    raw = (p or default).strip().strip('"')
    q = Path(raw)
    return q if q.is_absolute() else (ROOT / q)


def _default_worker_id() -> str:
    host = re.sub(r"[^A-Za-z0-9._-]", "-", socket.gethostname() or "pc")[:40] or "pc"
    return f"tgw-{host}"


@dataclass
class Config:
    backend_url: str
    api_id: int
    api_hash: str
    session_key: str
    worker_id: str
    private_key_path: Path
    session_path: Path
    data_dir: Path
    log_level: str = "INFO"
    stun_host: str = "stun.l.google.com"
    stun_port: int = 19302
    extra: dict = field(default_factory=dict)

    def problems(self) -> list[str]:
        """Ishga tushishdan oldingi tekshiruv (qiymatlar emas, faqat nomlar qaytadi)."""
        out = []
        if not self.backend_url.startswith(("https://", "http://")):
            out.append("BACKEND_URL")
        if self.api_id <= 0:
            out.append("TG_API_ID")
        if not re.fullmatch(r"[0-9a-fA-F]{32}", self.api_hash or ""):
            out.append("TG_API_HASH")
        if not self.session_key:
            out.append("TG_SESSION_KEY")
        if not _WORKER_ID_RE.match(self.worker_id):
            out.append("WORKER_ID")
        return out


def from_env() -> Config:
    data_dir = _resolve(os.environ.get("DATA_DIR", ""), "data")
    try:
        api_id = int(os.environ.get("TG_API_ID", "0") or 0)
    except ValueError:
        api_id = 0
    return Config(
        backend_url=os.environ.get("BACKEND_URL", "").strip().rstrip("/"),
        api_id=api_id,
        api_hash=os.environ.get("TG_API_HASH", "").strip(),
        session_key=os.environ.get("TG_SESSION_KEY", "").strip(),
        worker_id=(os.environ.get("WORKER_ID", "") or _default_worker_id()).strip(),
        private_key_path=_resolve(os.environ.get("WORKER_PRIVATE_KEY_PATH", ""), str(data_dir / "worker_ed25519.pem")),
        session_path=_resolve(os.environ.get("TG_SESSION_PATH", ""), str(data_dir / "session.enc")),
        data_dir=data_dir,
        log_level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        stun_host=os.environ.get("STUN_HOST", "stun.l.google.com"),
        stun_port=int(os.environ.get("STUN_PORT", "19302") or 19302),
    )
