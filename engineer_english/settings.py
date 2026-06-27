from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "django-insecure-change-me")
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

# CORS/CSRF: デフォルトは締める。必要に応じて環境変数で許可
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
    # ※デプロイ前に必ず環境変数 DJANGO_SECRET_KEY を設定すること。
    if SECRET_KEY == "django-insecure-change-me":
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured(
            "本番(DEBUG=False)では環境変数 DJANGO_SECRET_KEY の設定が必須です。"
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
}
