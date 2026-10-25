import pytest
from django.core.exceptions import ImproperlyConfigured

from engineer_english import settings as project_settings
from engineer_english.settings import DEFAULT_SQLITE, _find_ca_bundle, build_databases

ENDPOINT = "example.dsql.ap-northeast-1.on.aws"


def test_sqlite_is_used_without_dsql_endpoint():
    db = build_databases({})["default"]

    assert db["ENGINE"] == "django.db.backends.sqlite3"
    assert db["NAME"] == DEFAULT_SQLITE


def test_sqlite_path_can_be_overridden():
    db = build_databases({"SQLITE_PATH": "/tmp/x.sqlite3", "DSQL_CLUSTER_ENDPOINT": " "})

    assert db["default"]["NAME"] == "/tmp/x.sqlite3"


def test_dsql_is_used_with_endpoint(monkeypatch):
    monkeypatch.setattr(project_settings, "_find_ca_bundle", lambda: None)
    db = build_databases({"DSQL_CLUSTER_ENDPOINT": ENDPOINT, "AWS_REGION": "us-east-1"})["default"]

    assert db["ENGINE"] == "aurora_dsql_django"
    assert db["HOST"] == ENDPOINT
    assert db["NAME"] == "postgres"
    assert db["USER"] == "app"
    assert db["USE_SEQUENCE_AUTOFIELDS"] is True
    assert db["SEQUENCE_CACHE_SIZE"] == 1
    assert db["OPTIONS"] == {
        "region": "us-east-1",
        "sslmode": "verify-full",
        "options": "-c search_path=app",
        "connect_timeout": 5,
    }
    # 接続はリクエストごとに作成・終了する（ASGI ではリクエスト間で接続を共有しない）
    assert db["CONN_MAX_AGE"] == 0
    # パスワードは保持せず、接続のたびに IAM 認証トークンを生成する
    assert "PASSWORD" not in db


def test_dsql_options_can_be_overridden():
    db = build_databases(
        {
            "DSQL_CLUSTER_ENDPOINT": ENDPOINT,
            "DSQL_DB_USER": "admin",
            "DSQL_SCHEMA": "verify_1",
            "DSQL_SSLMODE": "require",
            "DSQL_SSLROOTCERT": "/etc/ssl/ca.pem",
            "AWS_DEFAULT_REGION": "ap-northeast-1",
        }
    )["default"]

    assert db["USER"] == "admin"
    assert db["OPTIONS"]["options"] == "-c search_path=verify_1"
    assert db["OPTIONS"]["sslmode"] == "require"
    assert db["OPTIONS"]["sslrootcert"] == "/etc/ssl/ca.pem"
    assert db["OPTIONS"]["region"] == "ap-northeast-1"


def test_dsql_region_defaults_to_tokyo():
    db = build_databases({"DSQL_CLUSTER_ENDPOINT": ENDPOINT})["default"]

    assert db["OPTIONS"]["region"] == "ap-northeast-1"


@pytest.mark.parametrize("schema", ["App", "app;drop", "1app", "app schema", "a" * 64])
def test_invalid_schema_name_is_rejected(schema):
    with pytest.raises(ImproperlyConfigured):
        build_databases({"DSQL_CLUSTER_ENDPOINT": ENDPOINT, "DSQL_SCHEMA": schema})


def test_dsql_uses_os_ca_bundle_by_default(monkeypatch):
    monkeypatch.setattr(project_settings, "_find_ca_bundle", lambda: "/etc/ca.pem")
    db = build_databases({"DSQL_CLUSTER_ENDPOINT": ENDPOINT})["default"]

    assert db["OPTIONS"]["sslrootcert"] == "/etc/ca.pem"


def test_find_ca_bundle_returns_first_existing_file(tmp_path):
    bundle = tmp_path / "ca.pem"
    bundle.write_text("dummy")

    assert _find_ca_bundle((str(tmp_path / "missing.pem"), str(bundle))) == str(bundle)
    assert _find_ca_bundle((str(tmp_path / "missing.pem"),)) is None


def test_dsql_connection_params_reach_the_driver(monkeypatch):
    """接続のタイムアウトがドライバ（psycopg）の接続パラメータとして渡ることを確認する。"""
    from aurora_dsql_django.base import DatabaseWrapper

    monkeypatch.setattr(project_settings, "_find_ca_bundle", lambda: None)
    settings_dict = build_databases({"DSQL_CLUSTER_ENDPOINT": ENDPOINT})["default"]
    settings_dict.update({"TIME_ZONE": None, "AUTOCOMMIT": True, "ATOMIC_REQUESTS": False})
    settings_dict.setdefault("PASSWORD", "")
    settings_dict.setdefault("TEST", {})

    params = DatabaseWrapper(settings_dict).get_connection_params()

    assert params["connect_timeout"] == 5
    assert params["host"] == ENDPOINT
    assert params["region"] == "ap-northeast-1"


def test_production_renders_json_only(settings):
    # テストは DEBUG=False の設定を読み込む
    assert settings.REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] == [
        "rest_framework.renderers.JSONRenderer"
    ]
