"""AI matni bo'yicha kayfiyat (emotsiya) — oddiy kalit so'z evristikasi (ML yo'q).

Natija: 'neutral' | 'happy' | 'thinking' | 'concerned'. O'zbek (lotin), rus va ingliz so'zlari.
"""
from __future__ import annotations

import re

EMOTIONS = ("neutral", "happy", "thinking", "concerned")

_HAPPY = (
    "rahmat", "ajoyib", "zo'r", "yaxshi", "tabrik", "xursand", "barakalla", "muvaffaqiyat", "marhamat",
    "albatta", "salom", "assalomu", "xush kelibsiz", "bajarildi", "tayyor", "qoyil", "omad",
    "спасибо", "отлично", "хорошо", "поздрав", "рад", "здравствуй", "готово", "конечно",
    "thanks", "great", "awesome", "congrat", "welcome", "done",
)
_CONCERNED = (
    "afsus", "kechirasiz", "uzr", "muammo", "xato", "kechik", "kelmadi", "qarz", "jarima", "ogohlantir",
    "xavf", "shoshilinch", "imkoni yo'q", "bo'lmadi", "ulanmadi", "topilmadi", "ruxsat yo'q", "yo'qotil",
    "kasal", "baxtsiz", "buzil", "to'xtab", "tugab qoldi",
    "извин", "к сожалению", "проблем", "ошибк", "опозд", "штраф", "долг", "опасн", "срочно", "не удалось",
    "sorry", "unfortunately", "problem", "error", "failed",
)
_THINKING = (
    "qarab", "tekshir", "bir daqiqa", "bir soniya", "o'ylab", "hisobla", "izla", "qidir", "aniqla",
    "ko'rib chiq", "eslab", "balki", "ehtimol",
    "посмотр", "провер", "секунд", "минут", "подума", "ищу", "возможно",
    "let me", "checking", "one moment", "maybe",
)

_APOS = re.compile(r"[ʻʼ‘’`´]")


def normalize(text: str) -> str:
    return _APOS.sub("'", (text or "").lower())


def _score(t: str, words: tuple[str, ...]) -> int:
    return sum(1 for w in words if w in t)


def classify(text: str) -> str:
    """Matndan kayfiyat. Teng ochkoda: concerned > happy > thinking (xavotir muhimroq)."""
    t = normalize(text).strip()
    if not t:
        return "neutral"
    happy = _score(t, _HAPPY) + (1 if t.endswith("!") else 0)
    concerned = _score(t, _CONCERNED) * 1.2           # salbiy xabar yumshoq tabassum bilan aytilmasin
    thinking = _score(t, _THINKING) + (0.6 if t.endswith("?") else 0)
    best = max(concerned, happy, thinking)
    if best < 0.6:
        return "neutral"
    if concerned == best:
        return "concerned"
    if happy == best:
        return "happy"
    return "thinking"
