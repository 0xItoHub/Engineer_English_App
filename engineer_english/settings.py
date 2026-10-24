import os
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

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "channels",
    "corsheaders",
    "core",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "engineer_english.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

WSGI_APPLICATION = "engineer_english.wsgi.application"
ASGI_APPLICATION = "engineer_english.asgi.application"

# SQLite パス: 環境変数 SQLITE_PATH があればそれを優先（Lambdaで /tmp/db.sqlite3 を指定）
SQLITE_PATH = os.getenv("SQLITE_PATH")
DEFAULT_SQLITE = BASE_DIR / "db.sqlite3"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": SQLITE_PATH if SQLITE_PATH else DEFAULT_SQLITE,
    }
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Tokyo"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Channels – use in‑memory for local dev.  In prod, switch to Redis.
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    }
}

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
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
        "rest_framework.authentication.BasicAuthentication",
    ],
    # 既定は「読み取りは誰でも / 書き込みは認証ユーザーのみ」。
    # 未認証での書込・削除を防ぐ。GET主体のUIには影響しない。
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticatedOrReadOnly",
    ],
    # API のレート制限（環境変数で上書き可能）。
    # カウンタは既定の LocMem キャッシュに保持するため、Lambda ではインスタンス単位の制限となる。
    # 全体の上限は API Gateway 側のスロットリングで担保する。
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
}

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
