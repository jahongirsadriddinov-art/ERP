"""Profil (owner 2026-10-19): ism/familiya/bio/username/rasm — tekshiruv, Telegram so'rovlari va xato kodlari."""
import asyncio
import base64

import pytest

from app.errors import RpcError
from app.profile import update_profile

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100


class UsernameOccupiedError(Exception):
    pass


class FakeClient:
    def __init__(self, fail=None):
        self.reqs = []
        self.uploaded = []
        self.fail = fail

    async def __call__(self, req):
        name = type(req).__name__
        self.reqs.append(name)
        if self.fail and name == self.fail[0]:
            raise self.fail[1]
        if name == "UpdateProfileRequest":
            class Me:
                first_name = getattr(req, "first_name", None) or "Old"
                last_name = getattr(req, "last_name", None)
            return Me()
        return True

    async def upload_file(self, data, file_name=""):
        self.uploaded.append((len(data), file_name))
        return object()


class Rt:
    def __init__(self, client):
        self.client = client
        self.username = "old_name"
        self.display_name = "Old"


def run(c):
    return asyncio.run(c)


def test_updates_names_username_and_photo():
    rt = Rt(FakeClient())
    r = run(update_profile(rt, {"firstName": " Jasur ", "lastName": "AI", "about": "ERP yordamchi", "username": "@jasur_erp_ai",
                                "photo": "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()}))
    assert r["changed"] == ["first_name", "last_name", "about", "username", "photo"]
    assert rt.client.reqs == ["UpdateProfileRequest", "UpdateUsernameRequest", "UploadProfilePhotoRequest"]
    assert rt.username == "jasur_erp_ai" and rt.display_name == "Jasur AI"
    assert rt.client.uploaded == [(len(JPEG), "photo.jpg")]


def test_validation_and_error_codes():
    with pytest.raises(RpcError) as e:
        run(update_profile(Rt(FakeClient()), {"firstName": "  "}))
    assert e.value.code == "name_invalid"
    with pytest.raises(RpcError) as e:
        run(update_profile(Rt(FakeClient()), {"username": "1bad"}))
    assert e.value.code == "username_invalid"
    with pytest.raises(RpcError) as e:
        run(update_profile(Rt(FakeClient()), {"photo": base64.b64encode(b"GIF89a....").decode()}))
    assert e.value.code == "photo_invalid"
    with pytest.raises(RpcError) as e:
        run(update_profile(Rt(FakeClient(fail=("UpdateUsernameRequest", UsernameOccupiedError()))), {"username": "taken_name"}))
    assert e.value.code == "username_occupied"
    with pytest.raises(RpcError) as e:
        run(update_profile(Rt(None), {"firstName": "A"}))
    assert e.value.code == "not_authorized"
