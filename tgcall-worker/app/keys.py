"""Kalitlar: Ed25519 juftligi (backendga autentifikatsiya) va TG_SESSION_KEY (sessiya shifri).

Birinchi ishga tushganda:
  • data/worker_ed25519.pem — maxfiy kalit (faqat shu kompyuterda; hech kimga bermang);
  • .env ga TG_SESSION_KEY qo'shiladi (yo'qolsa — Telegram'ga qayta kirish kerak bo'ladi);
  • OCHIQ kalit ekranga chiqariladi — uni Render'da AIV_WORKER_PUBKEY ga qo'ying.

Qo'lda: `python -m app.keys` — ochiq kalitni qayta ko'rsatadi.
"""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from . import config as cfgmod


def challenge_message(worker_id: str, nonce: str) -> bytes:
    """Backend contracts.ts workerChallengeMessage bilan bir xil."""
    return f"aiv-worker\n{worker_id}\n{nonce}".encode("utf-8")


def sign_challenge(key: Ed25519PrivateKey, worker_id: str, nonce: str) -> str:
    return base64.b64encode(key.sign(challenge_message(worker_id, nonce))).decode("ascii")


def public_key_b64(key: Ed25519PrivateKey) -> str:
    raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode("ascii")


def _write_private(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
    try:
        os.chmod(tmp, 0o600)
    except OSError:  # Windows — ruxsatlar foydalanuvchi papkasi orqali
        pass
    os.replace(tmp, path)


def load_or_create_private_key(path: Path) -> tuple[Ed25519PrivateKey, bool]:
    if path.exists():
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        if not isinstance(key, Ed25519PrivateKey):
            raise ValueError("worker kaliti Ed25519 emas")
        return key, False
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    _write_private(path, pem)
    return key, True


def ensure_session_key(env_path: Path) -> tuple[str, bool]:
    """TG_SESSION_KEY bo'lmasa — yaratib .env oxiriga yozadi."""
    cur = os.environ.get("TG_SESSION_KEY", "").strip()
    if cur:
        return cur, False
    key = Fernet.generate_key().decode("ascii")
    try:
        return _append_session_key(env_path, key), True
    except OSError:
        # Masalan, konteynerda .env yozib bo'lmaydi — TG_SESSION_KEY muhitda berilishi kerak
        return "", False


def _append_session_key(env_path: Path, key: str) -> str:
    env_path.parent.mkdir(parents=True, exist_ok=True)
    prefix = ""
    if env_path.exists():
        txt = env_path.read_text(encoding="utf-8", errors="replace")
        if txt and not txt.endswith("\n"):
            prefix = "\n"
        # Bo'sh "TG_SESSION_KEY=" qatori bo'lsa — uni almashtiramiz
        lines = txt.splitlines()
        if any(l.strip() == "TG_SESSION_KEY=" for l in lines):
            lines = [f"TG_SESSION_KEY={key}" if l.strip() == "TG_SESSION_KEY=" else l for l in lines]
            env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            os.environ["TG_SESSION_KEY"] = key
            return key
    with open(env_path, "a", encoding="utf-8") as f:
        f.write(f"{prefix}TG_SESSION_KEY={key}\n")
    os.environ["TG_SESSION_KEY"] = key
    return key


def print_public_key(pub: str, created: bool) -> None:
    line = "=" * 64
    print(line)
    if created:
        print("YANGI worker kaliti yaratildi.")
    print("Render -> Environment -> AIV_WORKER_PUBKEY qiymati (ochiq kalit, sir emas):")
    print()
    print(f"  {pub}")
    print()
    print("Maxfiy kalit faylini (data/worker_ed25519.pem) hech kimga bermang.")
    print(line)
    sys.stdout.flush()


def main() -> None:  # python -m app.keys
    cfgmod.load_env()
    cfg = cfgmod.from_env()
    key, created = load_or_create_private_key(cfg.private_key_path)
    _, sk_created = ensure_session_key(cfgmod.DEFAULT_ENV)
    if sk_created:
        print("TG_SESSION_KEY yaratildi va .env fayliga yozildi.")
    print_public_key(public_key_b64(key), created)


if __name__ == "__main__":
    main()
