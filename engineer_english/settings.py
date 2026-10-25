import os
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_secret_key():
    """SECRET_KEY を環境変数、または SSM Parameter Store から読み込む。"""
    key = os.getenv("DJANGO_SECRET_KEY")
    if key:
        return key
    # 本番（Lambda）では SecureString パラメータ名を受け取り、起動時に取得する
    param_name = os.getenv("DJANGO_SECRET_KEY_SSM_PARAM")
    if param_name:
        import boto3

        ssm = boto3.client("ssm")
        return ssm.get_parameter(Name=param_name, WithDecryption=True)["Parameter"]["Value"]
    return "django-insecure-change-me"


SECRET_KEY = _load_secret_key()

# 公開リポジトリでは安全側の既定値に（必要に応じて環境変数で上書き）
DEBUG = os.getenv("DJANGO_DEBUG", "False") == "True"
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

# 学習コンテンツは seed コマンドで管理するため、管理画面・セッション・メッセージは使わない。
# auth / contenttypes は DRF の未認証ユーザー（AnonymousUser）が参照するため残す。
# `migrate --run-syncdb` は記載順にテーブルを作成するため、参照される contenttypes を先に置く。
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "core",
]

# CloudFront 経由のリクエストの確認（X-Origin-Verify）と閲覧者の IP アドレスの設定（X-Viewer-IP）。
# 値は Terraform が生成し、Lambda の環境変数で渡す。未設定（ローカル開発・テスト）なら確認しない。
ORIGIN_VERIFY_SECRET = os.getenv("ORIGIN_VERIFY_SECRET", "").strip()

MIDDLEWARE = [
    # 他のミドルウェアより先に、経路の確認と転送用ヘッダーの整理を行う
    "core.middleware.OriginVerifyMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "engineer_english.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
            ]
        },
    }
]

WSGI_APPLICATION = "engineer_english.wsgi.application"
ASGI_APPLICATION = "engineer_english.asgi.application"

# SQLite パス: 環境変数 SQLITE_PATH があればそれを優先（Lambdaで /tmp/db.sqlite3 を指定）
DEFAULT_SQLITE = BASE_DIR / "db.sqlite3"

# Aurora DSQL のスキーマ名として受け付ける形式（search_path に埋め込むため英小文字・数字・_ のみ）
_SCHEMA_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")

# OS のルート証明書バンドルの候補（Lambda の Amazon Linux / Debian 系 / macOS の順）。
# psycopg の同梱ライブラリは OS の証明書ストアを自動では参照しないため、ファイルを明示する。
CA_BUNDLE_CANDIDATES = (
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/ssl/cert.pem",
)


def _find_ca_bundle(candidates=CA_BUNDLE_CANDIDATES):
    """存在する最初の証明書バンドルのパスを返す（見つからなければ None）。"""
    return next((path for path in candidates if os.path.isfile(path)), None)


# Aurora DSQL への接続確立のタイムアウト（秒）
DSQL_CONNECT_TIMEOUT_SECONDS = 5


def build_databases(environ):
    """環境変数から DATABASES 設定を組み立てる。

    DSQL_CLUSTER_ENDPOINT が設定されていれば Aurora DSQL（本番）に、
    未設定なら SQLite（ローカル開発・テスト・CI・イメージのビルド）に接続する。
    """
    endpoint = environ.get("DSQL_CLUSTER_ENDPOINT", "").strip()
    if not endpoint:
        return {
            "default": {
                "ENGINE": "django.db.backends.sqlite3",
                "NAME": environ.get("SQLITE_PATH") or DEFAULT_SQLITE,
            }
        }

    schema = environ.get("DSQL_SCHEMA", "").strip() or "app"
    if not _SCHEMA_NAME_RE.match(schema):
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured("DSQL_SCHEMA は英小文字・数字・_ で指定してください。")

    region = (
        environ.get("AWS_REGION") or environ.get("AWS_DEFAULT_REGION") or "ap-northeast-1"
    ).strip()
    options = {
        # 接続のたびにアダプタが IAM 認証トークンを生成する（パスワードは保持しない）
        "region": region,
        # サーバ証明書とホスト名を検証する
        "sslmode": environ.get("DSQL_SSLMODE", "").strip() or "verify-full",
        # アプリのテーブルは専用スキーマに作成・参照する
        "options": f"-c search_path={schema}",
        # 接続の確立を待つ上限（秒）。応答できない場合は早めに 503 を返す
        "connect_timeout": DSQL_CONNECT_TIMEOUT_SECONDS,
    }
    sslrootcert = environ.get("DSQL_SSLROOTCERT", "").strip() or _find_ca_bundle()
    if sslrootcert:
        options["sslrootcert"] = sslrootcert

    return {
        "default": {
            "ENGINE": "aurora_dsql_django",
            "HOST": endpoint,
            "PORT": "5432",
            "NAME": "postgres",
            "USER": environ.get("DSQL_DB_USER", "").strip() or "app",
            "OPTIONS": options,
            # 主キーは整数の連番を維持する（フロントエンドの URL は /scene/1 のような整数 ID）。
            # 書き込み頻度が低いため、キャッシュ 1 で採番順に近い連続した値にする。
            "USE_SEQUENCE_AUTOFIELDS": True,
            "SEQUENCE_CACHE_SIZE": 1,
            # 接続はリクエストごとに作成し、リクエストの終了時に閉じる（CONN_MAX_AGE=0）。
            # Lambda では ASGI（Mangum）で Django を動かしており、Django は ASGI の
            # リクエストごとに別のスレッドで DB にアクセスするため、
            # スレッド単位の接続はリクエスト間で再利用されない。
            # 接続ごとに新しい IAM 認証トークンを使うため、トークンの有効期限の影響も受けない。
            "CONN_MAX_AGE": 0,
        }
    }


DATABASES = build_databases(os.environ)

# auth / contenttypes はマイグレーション履歴を使わず、最終的なモデル定義からテーブルを作成する
# （`migrate --run-syncdb`）。Aurora DSQL が対応しない列型の変更を含む履歴を経由しないため。
MIGRATION_MODULES = {"auth": None, "contenttypes": None}

# API のエラーメッセージ（DRF の既定のメッセージを含む）を日本語で返す
LANGUAGE_CODE = "ja"
TIME_ZONE = "Asia/Tokyo"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# CORS/CSRF: 既定は許可なし。本番はフロントエンドのオリジンのみを環境変数で指定
if os.getenv("DJANGO_CORS_ALLOW_ALL", "False") == "True":
    CORS_ALLOW_ALL_ORIGINS = True
else:
    _cors_origins = os.getenv("DJANGO_CORS_ALLOWED_ORIGINS", "").strip()
    CORS_ALLOWED_ORIGINS = [o for o in _cors_origins.split(",") if o]

_csrf_trusted = os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "").strip()
if _csrf_trusted:
    CSRF_TRUSTED_ORIGINS = [o for o in _csrf_trusted.split(",") if o]

# 本番（DEBUG=False）でのみ有効化するセキュリティ設定。
# ローカル開発（DEBUG=True）には影響しない。
if not DEBUG:
    # SECRET_KEY が未設定（insecureデフォルトのまま）での本番起動を防ぐ。
    # ※デプロイ時は DJANGO_SECRET_KEY または DJANGO_SECRET_KEY_SSM_PARAM を設定すること。
    if SECRET_KEY == "django-insecure-change-me":
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured(
            "本番(DEBUG=False)では DJANGO_SECRET_KEY または "
            "DJANGO_SECRET_KEY_SSM_PARAM の設定が必須です。"
        )

    # HTTPS終端（API Gateway / CloudFront）の背後にいるため、転送ヘッダで判定。
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    # SSLリダイレクトはリダイレクトループ回避のため既定オフ（必要なら env で有効化）。
    SECURE_SSL_REDIRECT = os.getenv("DJANGO_SECURE_SSL_REDIRECT", "False") == "True"
    SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    X_FRAME_OPTIONS = "DENY"

# Django REST Framework設定
REST_FRAMEWORK = {
    # ログインは Amazon Cognito で行い、API は Bearer のアクセストークンで認証する。
    # 認証済みユーザーは core.auth.ExternalUser（Cognito のユーザー ID を持つ）として扱う。
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "core.authentication.CognitoAccessTokenAuthentication",
    ],
    # 既定は「読み取りは誰でも / 書き込みは認証ユーザーのみ」。
    # 未認証での書込・削除を防ぐ。GET主体のUIには影響しない。
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticatedOrReadOnly",
    ],
    # API のレート制限（環境変数で上書き可能）。
    # カウンタは既定の LocMem キャッシュに保持するため、Lambda ではインスタンス単位の制限となる。
    # 全体の上限は API Gateway 側のスロットリングで担保する。
    # 未認証のリクエストは REMOTE_ADDR で識別する。core.middleware が CloudFront の
    # 閲覧者の IP アドレスを設定し、X-Forwarded-For は取り除くため、NUM_PROXIES は指定しない。
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": os.getenv("DJANGO_THROTTLE_ANON", "120/min"),
        "user": os.getenv("DJANGO_THROTTLE_USER", "600/min"),
        # 学習完了の記録（POST /api/progress/complete_lesson/）は個別に厳しめの上限を設定
        "complete_lesson": os.getenv("DJANGO_THROTTLE_COMPLETE_LESSON", "30/min"),
    },
    # エラー応答を {"detail": ...} 形式の JSON にそろえる（データベースの障害は 503）
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
}

# 本番では JSON のみを返す（ブラウザで確認できる Browsable API は DEBUG 時のみ）
if not DEBUG:
    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = ["rest_framework.renderers.JSONRenderer"]

# ログ設定: エラーや警告をコンソール（Lambda では CloudWatch Logs）へ出力する
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
    },
    "root": {
        "handlers": ["console"],
        "level": os.getenv("DJANGO_LOG_LEVEL", "WARNING"),
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": os.getenv("DJANGO_LOG_LEVEL", "WARNING"),
            "propagate": False,
        },
    },
}
