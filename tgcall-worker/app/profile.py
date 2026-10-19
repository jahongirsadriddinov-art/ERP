"""AI Telegram akkauntining profili (owner 2026-10-19): rasm, ism-familiya, bio va username'ni dasturchi panelidan
o'zgartirish — bittalab yoki hammasiga birdan. Rasm backenddan base64 (JPEG/PNG, ≤ 2 MB) keladi; xato matnlari
tashqariga chiqmaydi — faqat kod.
"""
from __future__ import annotations

import base64
import binascii
import logging
import re
from typing import Any

from .errors import RpcError, flood_seconds

log = logging.getLogger("tgw.profile")

PHOTO_MAX = 2 * 1024 * 1024
_USERNAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{3,31}$")


def _names(e: BaseException) -> set[str]:
    return {c.__name__ for c in type(e).__mro__}


def _raise(e: BaseException) -> None:
    fs = flood_seconds(e)
    if fs:
        raise RpcError("flood_wait", "Telegram vaqtincha chekladi", fs)
    n = _names(e)
    for names, code in (
        ({"UsernameOccupiedError", "UsernamePurchaseAvailableError"}, "username_occupied"),
        ({"UsernameInvalidError"}, "username_invalid"),
        ({"FirstnameInvalidError", "FirstNameInvalidError"}, "name_invalid"),
        ({"AboutTooLongError"}, "about_too_long"),
        ({"PhotoCropSizeSmallError", "ImageProcessFailedError", "PhotoInvalidDimensionsError", "PhotoExtInvalidError"}, "photo_invalid"),
    ):
        if n & names:
            raise RpcError(code)
    log.info("profil xatosi: %s", type(e).__name__)
    raise RpcError("telegram_error", type(e).__name__[:60])


def _clean(v: Any, limit: int) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str):
        raise RpcError("bad_request")
    return re.sub(r"[\x00-\x1f]", "", v).strip()[:limit]


async def get_profile(rt: Any) -> dict:
    if not rt.client:
        raise RpcError("not_authorized")
    from telethon.tl import functions
    try:
        me = await rt.client.get_me()
        about = ""
        try:
            full = await rt.client(functions.users.GetFullUserRequest("me"))
            about = getattr(getattr(full, "full_user", None), "about", "") or ""
        except Exception:
            pass
        photo = await rt.client.download_profile_photo("me", file=bytes, download_big=False)
    except RpcError:
        raise
    except Exception as e:
        _raise(e)
    out = {
        "firstName": getattr(me, "first_name", None) or "",
        "lastName": getattr(me, "last_name", None) or "",
        "username": getattr(me, "username", None) or "",
        "about": about,
    }
    if photo:
        out["photo"] = base64.b64encode(photo).decode("ascii")
    return out


async def update_profile(rt: Any, p: dict) -> dict:
    if not rt.client:
        raise RpcError("not_authorized")
    from telethon.tl import functions
    first = _clean(p.get("firstName"), 64)
    last = _clean(p.get("lastName"), 64)
    about = _clean(p.get("about"), 70)
    username = p.get("username")
    photo_b64 = p.get("photo")
    if first is not None and not first:
        raise RpcError("name_invalid")
    if username is not None:
        if not isinstance(username, str):
            raise RpcError("bad_request")
        username = username.strip().lstrip("@")
        if username and not _USERNAME_RE.match(username):
            raise RpcError("username_invalid")
    photo = None
    if photo_b64 is not None:
        if not isinstance(photo_b64, str):
            raise RpcError("bad_request")
        try:
            photo = base64.b64decode(photo_b64.split(",", 1)[-1], validate=True)
        except (binascii.Error, ValueError):
            raise RpcError("photo_invalid")
        if not photo or len(photo) > PHOTO_MAX or not (photo[:3] == b"\xff\xd8\xff" or photo[:8] == b"\x89PNG\r\n\x1a\n"):
            raise RpcError("photo_invalid")
    changed: list[str] = []
    try:
        if first is not None or last is not None or about is not None:
            kw = {}
            if first is not None:
                kw["first_name"] = first
            if last is not None:
                kw["last_name"] = last
            if about is not None:
                kw["about"] = about
            me = await rt.client(functions.account.UpdateProfileRequest(**kw))
            changed += [k for k in ("first_name", "last_name", "about") if k in kw]
            rt.display_name = " ".join(x for x in [getattr(me, "first_name", None), getattr(me, "last_name", None)] if x) or rt.display_name
        if username is not None:
            try:
                await rt.client(functions.account.UpdateUsernameRequest(username=username))
                changed.append("username")
            except Exception as e:
                if "UsernameNotModifiedError" not in _names(e):
                    raise
            rt.username = username or None
        if photo is not None:
            f = await rt.client.upload_file(photo, file_name="photo.png" if photo[:4] == b"\x89PNG" else "photo.jpg")
            await rt.client(functions.photos.UploadProfilePhotoRequest(file=f))
            changed.append("photo")
    except RpcError:
        raise
    except Exception as e:
        _raise(e)
    log.info("profil yangilandi: %s", ", ".join(changed) or "o'zgarish yo'q")
    return {"ok": True, "changed": changed, "username": rt.username or "", "displayName": rt.display_name or ""}
