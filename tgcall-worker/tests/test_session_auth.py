import pytest
from cryptography.fernet import Fernet

from app.auth_flow import LoginFlow, mask_phone
from app.errors import RpcError
from app.session_store import SessionStore, SessionStoreError

ATT = "3f1c2a9e-1111-4222-8333-944455556666"
PHONE = "+998901234567"


def test_session_store_encrypts_and_rejects_wrong_key(tmp_path):
    k = Fernet.generate_key().decode()
    st = SessionStore(tmp_path / "s.enc", k)
    assert st.load() is None
    st.save("1BVtsOSECRETSESSIONSTRING")
    raw = (tmp_path / "s.enc").read_bytes()
    assert b"SECRETSESSION" not in raw
    assert st.load() == "1BVtsOSECRETSESSIONSTRING"
    with pytest.raises(SessionStoreError):
        SessionStore(tmp_path / "s.enc", Fernet.generate_key().decode()).load()
    with pytest.raises(SessionStoreError):
        SessionStore(tmp_path / "x.enc", "not-a-key")
    st.clear()
    assert not st.exists()


def mk_err(name):
    return type(name, (Exception,), {})("kod 12345 / tel +998901234567")


class FakeSession:
    def save(self):
        return "SESSION-STR"


class FakeMe:
    id = 4242
    username = "erp_ai"
    first_name = "ERP"
    last_name = "AI"


class FakeClient:
    def __init__(self, need_pw=False, bad_code=False):
        self.session = FakeSession()
        self.need_pw = need_pw
        self.bad_code = bad_code
        self.disconnected = False

    async def connect(self):
        pass

    async def disconnect(self):
        self.disconnected = True

    async def send_code_request(self, phone):
        return type("S", (), {"phone_code_hash": "h"})()

    async def sign_in(self, phone=None, code=None, phone_code_hash=None, password=None):
        if password is not None:
            if password != "right":
                raise mk_err("PasswordHashInvalidError")
            return FakeMe()
        if self.bad_code:
            raise mk_err("PhoneCodeInvalidError")
        if self.need_pw:
            raise mk_err("SessionPasswordNeededError")
        return FakeMe()

    async def get_me(self):
        return FakeMe()


def mk_flow(client, lease=True):
    saved = []

    async def on_success(s):
        saved.append(s)

    return LoginFlow(lambda: client, on_success, lambda: lease), saved


async def test_login_with_2fa():
    c = FakeClient(need_pw=True)
    f, saved = mk_flow(c)
    r = await f.start({"loginAttemptId": ATT, "phone": PHONE})
    assert r == {"status": "awaiting_code", "phoneMasked": mask_phone(PHONE)} and "1234567" not in r["phoneMasked"]
    assert (await f.code({"loginAttemptId": ATT, "code": "12345"})) == {"status": "awaiting_password"}
    with pytest.raises(RpcError) as e:
        await f.password({"loginAttemptId": ATT, "password": "wrong"})
    assert e.value.code == "password_invalid" and "wrong" not in e.value.message
    r = await f.password({"loginAttemptId": ATT, "password": "right"})
    assert r["status"] == "connected" and r["tgUserId"] == "4242" and r["username"] == "erp_ai"
    assert saved == ["SESSION-STR"] and c.disconnected
    # Sessiya javobda YO'Q
    assert "SESSION-STR" not in str(r)


async def test_login_guards():
    f, _ = mk_flow(FakeClient(), lease=False)
    with pytest.raises(RpcError) as e:
        await f.start({"loginAttemptId": ATT, "phone": PHONE})
    assert e.value.code == "not_leased"
    f, _ = mk_flow(FakeClient(bad_code=True))
    with pytest.raises(RpcError) as e:
        await f.start({"loginAttemptId": ATT, "phone": "12"})
    assert e.value.code == "phone_invalid"
    await f.start({"loginAttemptId": ATT, "phone": PHONE})
    with pytest.raises(RpcError) as e:
        await f.code({"loginAttemptId": "00000000-0000-0000-0000-000000000000", "code": "12345"})
    assert e.value.code == "attempt_expired"
    with pytest.raises(RpcError) as e:
        await f.code({"loginAttemptId": ATT, "code": "12345"})
    assert e.value.code == "code_invalid" and "12345" not in e.value.message
    with pytest.raises(RpcError) as e:
        await f.password({"loginAttemptId": ATT, "password": "x"})
    assert e.value.code == "bad_request"   # parol bosqichi emas
