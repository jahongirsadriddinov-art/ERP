"""Akkaunt bo'yicha ixtiyoriy proksi (anti-freeze, owner 2026-10-23).

O'zbek raqamli akkaunt Railway/datacenter IP'sidan (AQSh/Yevropa) ishlasa — Telegram buni "o'g'irlangan/sotib olingan
akkaunt" belgisi deb biladi. Tavsiya: raqam mamlakatidagi (O'zbekiston) REZIDENT yoki MOBIL proksi, har akkauntga
alohida (bir IP'dan ko'p akkaunt — ham xavf).

Sozlash (.env yoki Railway Variables):
    TG_PROXIES={"<akkaunt id>":"socks5://user:pass@host:1080","platform":"http://user:pass@host:8080","*":"..."}
  kalitlar: firma/hovuz akkaunti id'si (24 hex), "platform" — platforma akkaunti, "*" — qolganlarning hammasi.
  Formatlar: socks5://, socks4://, http://, mtproto://<secret>@host:port yoki tg://proxy?server=..&port=..&secret=..

Muhim: proksi faqat Telegram API (MTProto) ulanishiga ta'sir qiladi. Qo'ng'iroq OVOZI (WebRTC/UDP, ntgcalls)
proksidan o'tmaydi. Xato formatdagi proksi bilan akkaunt ishga TUSHMAYDI (proksisiz "jimgina" ulanish — aynan
oldini olmoqchi bo'lgan xavf). Parol hech qachon log qilinmaydi va backendga yuborilmaydi (faqat turi va host).
"""
from __future__ import annotations

import json
import os
from typing import Optional
from urllib.parse import parse_qs, unquote, urlsplit

SCHEMES = {"socks5", "socks5h", "socks4", "http", "https", "mtproto", "tg"}


class ProxyConfigError(ValueError):
    pass


def parse(url: str) -> dict:
    """URL → {'type', 'host', 'port', 'username'?, 'password'?, 'secret'?}. Xato bo'lsa ProxyConfigError."""
    s = str(url or "").strip()
    if not s:
        raise ProxyConfigError("empty")
    u = urlsplit(s)
    try:
        u_port = u.port
    except ValueError:
        raise ProxyConfigError("port")
    scheme = (u.scheme or "").lower()
    if scheme not in SCHEMES:
        raise ProxyConfigError("scheme")
    if scheme == "tg":
        q = parse_qs(u.query)
        host = (q.get("server") or [""])[0]
        port = (q.get("port") or [""])[0]
        secret = (q.get("secret") or [""])[0]
        out = {"type": "mtproto", "host": host, "secret": secret}
    elif scheme == "mtproto":
        out = {"type": "mtproto", "host": u.hostname or "", "secret": unquote(u.username or "")}
        port = u_port
    else:
        out = {"type": {"socks5h": "socks5", "https": "http"}.get(scheme, scheme), "host": u.hostname or ""}
        port = u_port
        if u.username:
            out["username"] = unquote(u.username)
        if u.password:
            out["password"] = unquote(u.password)
    try:
        p = int(port or 0)
    except (TypeError, ValueError):
        raise ProxyConfigError("port")
    if not out["host"] or not (0 < p < 65536):
        raise ProxyConfigError("host")
    out["port"] = p
    if out["type"] == "mtproto":
        sec = str(out.get("secret") or "").lower()
        if not sec or any(c not in "0123456789abcdef" for c in sec) or len(sec) not in (32, 34):
            raise ProxyConfigError("secret")
        out["secret"] = sec
    return out


def table_from_env(env: Optional[dict] = None) -> dict:
    raw = (env if env is not None else os.environ).get("TG_PROXIES", "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        raise ProxyConfigError("json")
    if not isinstance(data, dict):
        raise ProxyConfigError("json")
    return {str(k): str(v) for k, v in data.items() if v}


def for_account(acc_id: str, table: dict) -> Optional[dict]:
    key = acc_id or "platform"
    url = table.get(key) or table.get("*")
    return parse(url) if url else None


def client_kwargs(p: Optional[dict]) -> dict:
    """TelegramClient(**kw) uchun: proxy (+ MTProxy'da connection)."""
    if not p:
        return {}
    if p["type"] == "mtproto":
        from telethon import connection
        return {"connection": connection.ConnectionTcpMTProxyRandomizedIntermediate, "proxy": (p["host"], p["port"], p["secret"])}
    d = {"proxy_type": p["type"], "addr": p["host"], "port": p["port"], "rdns": True}
    if p.get("username"):
        d["username"] = p["username"]
    if p.get("password"):
        d["password"] = p["password"]
    return {"proxy": d}


def describe(p: Optional[dict]) -> Optional[str]:
    """Panel uchun: 'socks5 host:port' (parol/secret YO'Q)."""
    if not p:
        return None
    return f"{p['type']} {p['host']}:{p['port']}"[:80]
