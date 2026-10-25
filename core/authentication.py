"""Amazon Cognito のアクセストークンによる認証（Django REST framework）。

`Authorization: Bearer <アクセストークン>` を受け取り、
ユーザープールの公開鍵（JWKS）で署名を検証する。
発行元・有効期限・トークンの種類・アプリクライアントを確認したうえで、
トークンの sub を持つ ExternalUser を request.user とする。ヘッダーがなければ未ログインとして扱う。
"""

import logging
import os
from functools import lru_cache

import jwt
from rest_framework import authentication, exceptions, status

from .auth import ExternalUser

# 署名アルゴリズムは Cognito が使用する RS256 のみ許可する
ALLOWED_ALGORITHMS = ["RS256"]
# サーバー間の時刻のずれの許容（秒）
CLOCK_SKEW_SECONDS = 30
# 公開鍵の取得のタイムアウト（秒）
JWKS_TIMEOUT_SECONDS = 5

logger = logging.getLogger(__name__)


class AuthServiceUnavailable(exceptions.APIException):
    """公開鍵（JWKS）を取得できず、トークンを検証できないことを表す（503）。"""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "認証サービスに一時的に接続できません。しばらくしてから再度お試しください。"
    default_code = "auth_service_unavailable"


def cognito_settings(environ=None):
    """環境変数から Cognito の設定（発行元・JWKS の URL・アプリクライアント ID）を返す。

    ユーザープール ID とアプリクライアント ID のどちらかが未設定なら None を返す。
    """
    environ = os.environ if environ is None else environ
    pool_id = environ.get("COGNITO_USER_POOL_ID", "").strip()
    client_id = environ.get("COGNITO_APP_CLIENT_ID", "").strip()
    if not pool_id or not client_id or "_" not in pool_id:
        return None
    # ユーザープール ID は「<リージョン>_<ID>」の形式
    region = environ.get("COGNITO_REGION", "").strip() or pool_id.split("_", 1)[0]
    issuer = f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"
    return {
        "issuer": issuer,
        "jwks_url": f"{issuer}/.well-known/jwks.json",
        "client_id": client_id,
    }


@lru_cache(maxsize=4)
def _jwk_client(jwks_url):
    # 公開鍵はキャッシュし、鍵の更新（kid の追加）時のみ再取得する
    return jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=3600, timeout=JWKS_TIMEOUT_SECONDS)


def _invalid_token():
    return exceptions.AuthenticationFailed("認証トークンが無効です。もう一度ログインしてください。")


def verify_access_token(token, config):
    """アクセストークンを検証し、クレームを返す。

    トークンが無効なら AuthenticationFailed（401）を、
    公開鍵を取得できない場合は AuthServiceUnavailable（503）を送出する。
    """
    try:
        signing_key = _jwk_client(config["jwks_url"]).get_signing_key_from_jwt(token)
    except (jwt.PyJWKClientConnectionError, OSError) as error:
        # 公開鍵の取得時の通信エラー・タイムアウトは、トークンの不正ではなく一時的な障害として扱う
        logger.warning("認証用の公開鍵を取得できませんでした: %s", type(error).__name__)
        raise AuthServiceUnavailable() from error
    except (jwt.PyJWTError, jwt.PyJWKClientError) as error:
        raise _invalid_token() from error

    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=ALLOWED_ALGORITHMS,
            issuer=config["issuer"],
            leeway=CLOCK_SKEW_SECONDS,
            # アクセストークンには aud がないため、アプリクライアントは client_id で確認する
            options={
                "require": ["exp", "iat", "iss", "sub", "token_use", "client_id"],
                "verify_aud": False,
            },
        )
    except jwt.PyJWTError as error:
        raise _invalid_token() from error

    if claims.get("token_use") != "access" or claims.get("client_id") != config["client_id"]:
        raise _invalid_token()
    return claims


class CognitoAccessTokenAuthentication(authentication.BaseAuthentication):
    """Cognito のアクセストークン（Bearer）による認証。"""

    keyword = b"bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword:
            # Bearer トークンがなければ未ログイン（他の認証方式・匿名アクセスに委ねる）
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed("認証ヘッダーの形式が正しくありません。")
        try:
            token = header[1].decode("ascii")
        except UnicodeDecodeError:
            raise _invalid_token() from None

        config = cognito_settings()
        if config is None:
            # 認証基盤が未設定の環境ではトークンを受け付けない
            raise _invalid_token()

        claims = verify_access_token(token, config)
        user = ExternalUser(sub=claims["sub"], username=claims.get("username", ""))
        return (user, claims)

    def authenticate_header(self, request):
        # 401 応答に WWW-Authenticate ヘッダーを付ける（403 ではなく 401 を返すため）
        return 'Bearer realm="api"'
