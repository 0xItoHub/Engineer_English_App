import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from rest_framework.test import APIClient

from core import authentication
from core.authentication import cognito_settings
from core.models import UserProgress

pytestmark = pytest.mark.django_db

POOL_ID = "ap-northeast-1_TestPool"
CLIENT_ID = "test-client-id"
ISSUER = f"https://cognito-idp.ap-northeast-1.amazonaws.com/{POOL_ID}"
MY_PROGRESS_URL = "/api/progress/my_progress/"
COMPLETE_URL = "/api/progress/complete_lesson/"


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def other_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJwkClient:
    """ユーザープールの公開鍵の代わりに、テスト用の鍵の公開鍵を返す。"""

    def __init__(self, private_key):
        self._public_key = private_key.public_key()

    def get_signing_key_from_jwt(self, token):
        jwt.get_unverified_header(token)  # 形式の不正なトークンはここで例外になる
        return _FakeSigningKey(self._public_key)


@pytest.fixture(autouse=True)
def cognito_env(monkeypatch, signing_key):
    monkeypatch.setenv("COGNITO_USER_POOL_ID", POOL_ID)
    monkeypatch.setenv("COGNITO_APP_CLIENT_ID", CLIENT_ID)
    monkeypatch.setattr(authentication, "_jwk_client", lambda url: _FakeJwkClient(signing_key))


def make_token(key, **overrides):
    now = int(time.time())
    claims = {
        "sub": "sub-alice",
        "username": "alice",
        "iss": ISSUER,
        "token_use": "access",
        "client_id": CLIENT_ID,
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-kid"})


def bearer_client(token):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


# --- 設定 -------------------------------------------------------------------


def test_cognito_settings_builds_issuer_and_jwks_url():
    config = cognito_settings({"COGNITO_USER_POOL_ID": POOL_ID, "COGNITO_APP_CLIENT_ID": CLIENT_ID})

    assert config["issuer"] == ISSUER
    assert config["jwks_url"] == f"{ISSUER}/.well-known/jwks.json"
    assert config["client_id"] == CLIENT_ID


@pytest.mark.parametrize(
    "environ",
    [
        {},
        {"COGNITO_USER_POOL_ID": POOL_ID},
        {"COGNITO_APP_CLIENT_ID": CLIENT_ID},
        {"COGNITO_USER_POOL_ID": "no-region", "COGNITO_APP_CLIENT_ID": CLIENT_ID},
    ],
)
def test_cognito_settings_returns_none_when_incomplete(environ):
    assert cognito_settings(environ) is None


# --- 正しいトークン -----------------------------------------------------------


def test_valid_token_authenticates_user(signing_key, lesson):
    client = bearer_client(make_token(signing_key))

    res = client.post(
        COMPLETE_URL, {"lesson_id": lesson.id, "score": 90, "time_spent": 30}, format="json"
    )

    assert res.status_code == 200
    progress = UserProgress.objects.get()
    assert progress.user_sub == "sub-alice"
    assert progress.score == 90

    body = client.get(MY_PROGRESS_URL).json()
    assert len(body) == 1


def test_users_only_see_their_own_progress(signing_key, lesson):
    bearer_client(make_token(signing_key)).post(
        COMPLETE_URL, {"lesson_id": lesson.id, "score": 90}, format="json"
    )

    bob = bearer_client(make_token(signing_key, sub="sub-bob", username="bob"))

    assert bob.get(MY_PROGRESS_URL).json() == []
    assert bob.get("/api/progress/").json() == []


def test_no_authorization_header_is_anonymous(api_client):
    res = api_client.get(MY_PROGRESS_URL)

    assert res.status_code == 200
    assert res.json() == []


# --- 無効なトークン -----------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"token_use": "id"},
        {"client_id": "another-client"},
        {"iss": "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_Other"},
        {"exp": int(time.time()) - 3600},
        {"sub": None},
        {"token_use": None},
        {"client_id": None},
    ],
)
def test_invalid_claims_are_rejected(signing_key, overrides):
    res = bearer_client(make_token(signing_key, **overrides)).get(MY_PROGRESS_URL)

    assert res.status_code == 401
    assert res["WWW-Authenticate"].startswith("Bearer")


def test_token_signed_with_unknown_key_is_rejected(other_key):
    res = bearer_client(make_token(other_key)).get(MY_PROGRESS_URL)

    assert res.status_code == 401


def test_unsigned_and_hmac_tokens_are_rejected():
    now = int(time.time())
    claims = {
        "sub": "sub-alice",
        "iss": ISSUER,
        "token_use": "access",
        "client_id": CLIENT_ID,
        "iat": now,
        "exp": now + 3600,
    }
    unsigned = jwt.encode(claims, None, algorithm="none")
    hmac = jwt.encode(claims, "x" * 32, algorithm="HS256")

    assert bearer_client(unsigned).get(MY_PROGRESS_URL).status_code == 401
    assert bearer_client(hmac).get(MY_PROGRESS_URL).status_code == 401


@pytest.mark.parametrize("header", ["Bearer", "Bearer a b", "Bearer not-a-jwt"])
def test_malformed_authorization_header_is_rejected(header):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=header)

    assert client.get(MY_PROGRESS_URL).status_code == 401


def test_bearer_token_is_rejected_when_cognito_is_not_configured(monkeypatch, signing_key):
    monkeypatch.delenv("COGNITO_USER_POOL_ID")

    assert bearer_client(make_token(signing_key)).get(MY_PROGRESS_URL).status_code == 401


def test_rejected_token_does_not_write_progress(signing_key, lesson):
    client = bearer_client(make_token(signing_key, token_use="id"))

    res = client.post(COMPLETE_URL, {"lesson_id": lesson.id, "score": 90}, format="json")

    assert res.status_code == 401
    assert not UserProgress.objects.exists()
