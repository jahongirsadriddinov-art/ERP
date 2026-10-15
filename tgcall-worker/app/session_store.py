"""Telegram StringSession — faqat shu kompyuter diskida, TG_SESSION_KEY (Fernet) bilan shifrlangan.

Backendga HECH QACHON yuborilmaydi (review A5). Kalit yo'qolsa yoki o'zgarsa — sessiya o'qilmaydi va
Dasturchi panelidan qayta kirish kerak bo'ladi.
"""
from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class SessionStoreError(Exception):
    pass


class SessionStore:
    def __init__(self, path: Path, key: str):
        self.path = Path(path)
        try:
            self._f = Fernet(key.encode("ascii") if isinstance(key, str) else key)
        except (ValueError, TypeError) as e:
            raise SessionStoreError("TG_SESSION_KEY noto'g'ri formatda (Fernet kaliti kerak)") from e

    def exists(self) -> bool:
        return self.path.exists()

    def load(self) -> str | None:
        """Shifrlangan sessiyani o'qiydi. Fayl yo'q bo'lsa None; kalit mos kelmasa — SessionStoreError."""
        if not self.path.exists():
            return None
        try:
            data = self._f.decrypt(self.path.read_bytes())
        except InvalidToken as e:
            raise SessionStoreError("sessiya fayli shu TG_SESSION_KEY bilan ochilmadi") from e
        s = data.decode("utf-8").strip()
        return s or None

    def save(self, session: str) -> None:
        if not session:
            raise SessionStoreError("bo'sh sessiya")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        with open(tmp, "wb") as f:
            f.write(self._f.encrypt(session.encode("utf-8")))
            f.flush()
            os.fsync(f.fileno())
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, self.path)

    def clear(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass
