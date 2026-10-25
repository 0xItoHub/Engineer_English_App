import logging
from unittest import mock

import pytest
from django.db import (
    DatabaseError,
    DataError,
    IntegrityError,
    InterfaceError,
    OperationalError,
    ProgrammingError,
)
from django.test import override_settings
from rest_framework.test import APIClient

from core import views
from core.exceptions import is_db_unavailable_error

pytestmark = pytest.mark.django_db


@pytest.fixture
def client_no_raise():
    # 500 応答を確認するため、テストクライアントで例外を再送出しない
    client = APIClient(raise_request_exception=False)
    return client


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (OperationalError("connection refused"), True),
        (InterfaceError("connection already closed"), True),
        (DatabaseError("unknown"), True),
        (IntegrityError("duplicate"), False),
        (DataError("value too long"), False),
        (ProgrammingError("syntax error"), False),
        (ValueError("not a db error"), False),
    ],
)
def test_is_db_unavailable_error(error, expected):
    assert is_db_unavailable_error(error) is expected


@pytest.mark.parametrize("error", [OperationalError("down"), InterfaceError("closed")])
def test_database_outage_returns_503_json(client_no_raise, error, caplog):
    with mock.patch.object(views.SceneViewSet, "list", side_effect=error):
        with caplog.at_level(logging.ERROR, logger="core.exceptions"):
            res = client_no_raise.get("/api/scenes/?token=should-not-be-logged")

    assert res.status_code == 503
    assert res.json() == {
        "detail": "データベースに一時的に接続できません。しばらくしてから再度お試しください。"
    }
    assert "GET /api/scenes/" in caplog.text
    assert "should-not-be-logged" not in caplog.text


def test_unexpected_error_returns_500_json(client_no_raise, caplog):
    with mock.patch.object(views.SceneViewSet, "list", side_effect=RuntimeError("boom")):
        with caplog.at_level(logging.ERROR, logger="core.exceptions"):
            res = client_no_raise.get("/api/scenes/")

    assert res.status_code == 500
    assert res.json() == {
        "detail": "サーバーでエラーが発生しました。しばらくしてから再度お試しください。"
    }
    # 例外の内容は応答に含めず、ログに記録する
    assert "boom" not in res.content.decode()
    assert "RuntimeError" in caplog.text


def test_integrity_error_outside_retry_returns_500(client_no_raise):
    with mock.patch.object(views.SceneViewSet, "list", side_effect=IntegrityError("dup")):
        res = client_no_raise.get("/api/scenes/")

    assert res.status_code == 500
    assert "detail" in res.json()


def test_drf_errors_use_detail_in_japanese(api_client):
    res = api_client.get("/api/scenes/9999/")

    assert res.status_code == 404
    assert res.json() == {"detail": "見つかりませんでした。"}


def test_validation_errors_are_wrapped_with_detail(api_client):
    res = api_client.get("/api/phrases/", {"lesson": "abc"})

    assert res.status_code == 400
    body = res.json()
    assert body["detail"] == "入力内容に誤りがあります。"
    assert body["errors"] == {"lesson": "整数で指定してください"}


def test_method_not_allowed_uses_detail(auth_client, scene):
    res = auth_client.delete(f"/api/scenes/{scene.id}/")

    assert res.status_code == 405
    assert "detail" in res.json()


@pytest.mark.parametrize("path", ["/api/unknown/", "/no-such-page/", "/admin/"])
def test_unknown_paths_return_json_404(client, path):
    res = client.get(path)

    assert res.status_code == 404
    assert res["Content-Type"] == "application/json"
    assert res.json() == {"detail": "お探しのページが見つかりませんでした。"}


@override_settings(DEBUG=False)
def test_non_drf_server_error_returns_json_500(client_no_raise):
    with mock.patch.object(views, "redirect", side_effect=RuntimeError("boom")):
        res = client_no_raise.get("/")

    assert res.status_code == 500
    assert res.json() == {
        "detail": "サーバーでエラーが発生しました。しばらくしてから再度お試しください。"
    }


@override_settings(ALLOWED_HOSTS=["allowed.example"])
def test_disallowed_host_returns_json_400(client):
    res = client.get("/api/scenes/", HTTP_HOST="evil.example")

    assert res.status_code == 400
    assert res.json() == {"detail": "リクエストを処理できませんでした。"}


def test_json_error_outputs_japanese_as_is(client):
    res = client.get("/api/unknown/")

    assert "お探しのページ".encode() in res.content
