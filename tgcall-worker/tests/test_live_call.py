"""Haqiqiy Telegram qo'ng'irog'i — STANDART HOLATDA ISHLAMAYDI (NOT RUN).

MUHIM: avval run-windows.bat oynasini yoping — bu test lease olmaydi, bir sessiya ikki jarayonda
ishlasa Telegram uni butunlay bekor qiladi (AUTH_KEY_DUPLICATED).

Ishga tushirish (faqat egasi, o'z telefoniga):
  set LIVE_TG=1
  set LIVE_TG_TARGET=<telefoningizdagi Telegram user id>
  .venv\\Scripts\\python -m pytest -m live tests/test_live_call.py -s
Natija live-call-report.json ga yoziladi. Hisobotda "passed" faqat shu fayl bo'lsa yoziladi.
"""
import asyncio
import json
import os
import time

import pytest

pytestmark = pytest.mark.live

LIVE = os.environ.get("LIVE_TG") == "1"


@pytest.mark.skipif(not LIVE, reason="LIVE_TG=1 emas — jonli qo'ng'iroq testi o'tkazilmadi (NOT RUN)")
async def test_live_outgoing_call(tmp_path):
    from app import config as cfgmod
    from app.binding import BindingMatcher
    from app.calls import CallManager
    from app.session_store import SessionStore
    from app.tg import TelegramRuntime

    cfgmod.load_env()
    cfg = cfgmod.from_env()
    target = int(os.environ["LIVE_TG_TARGET"])
    events = []

    async def emit(ev):
        events.append(ev)

    async def send_up(_f):
        pass

    rt = TelegramRuntime(cfg, SessionStore(cfg.session_path, cfg.session_key), emit, BindingMatcher())
    cm = CallManager(rt, emit, send_up)
    rt.calls = cm
    await rt.start()
    assert rt.ready, "sessiya yo'q yoki bekor qilingan"
    t0 = time.time()
    r = await cm.place({"sessionId": "0123456789abcdef01234567", "tgUserId": str(target), "timeoutSec": 45, "maxDurationSec": 30})
    assert r["accepted"], r
    for _ in range(900):
        if events and events[-1]["state"] == "ended":
            break
        await asyncio.sleep(0.1)
    await rt.stop("test")
    report = {"at": int(t0), "states": [e["state"] for e in events], "reason": events[-1].get("reason") if events else None}
    with open(os.path.join(os.path.dirname(__file__), "..", "live-call-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    assert "connected" in report["states"]
