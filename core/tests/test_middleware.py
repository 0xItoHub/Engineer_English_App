from unittest import mock

import pytest
from django.http import HttpResponse
from django.test import RequestFactory, override_settings
from rest_framework.test import APIClient
from rest_framework.throttling import AnonRateThrottle

from core import views
from core.middleware import OriginVerifyMiddleware, parse_ip

pytestmark = pytest.mark.django_db

SECRET = "s3cr3tValueForTestsOnly0123456789abcdefghij"
FORBIDDEN = {"detail": "このリクエストは許可されていない経路から送信されています。"}


@pytest.fixture
def origin_secret(settings):
    settings.ORIGIN_VERIFY_SECRET = SECRET
    return SECRET


def cloudfront_client(viewer_ip="203.0.113.10", secret=SECRET, **extra):
    """CloudFront からの転送を模したヘッダーを付けるクライアント。"""
    headers = {"HTTP_X_ORIGIN_VERIFY": secret, **extra}
    if viewer_ip is not None:
        headers["HTTP_X_VIEWER_IP"] = viewer_ip
    return APIClient(**headers)


def run_middleware(**meta):
    """ミドルウェアを通した後の request を返す。"""
    request = RequestFactory().get("/api/scenes/", **meta)
    captured = {}

    def view(req):
        captured["request"] = req
        return HttpResponse("ok")

    response = OriginVerifyMiddleware(view)(request)
    return response, captured.get("request")


# --- 経路の確認 ---------------------------------------------------------------


def test_request_without_header_is_forbidden(origin_secret, api_client):
    res = api_client.get("/api/scenes/")

    assert res.status_code == 403
    assert res.json() == FORBIDDEN


@pytest.mark.parametrize("supplied", ["wrong", "", SECRET[:-1], SECRET + "x", "日本語"])
def test_request_with_wrong_secret_is_forbidden(origin_secret, supplied):
    res = cloudfront_client(secret=supplied).get("/api/scenes/")

    assert res.status_code == 403
    assert res.json() == FORBIDDEN


@pytest.mark.parametrize("path", ["/", "/api/", "/api/unknown/"])
def test_all_paths_require_the_header(origin_secret, api_client, path):
    assert api_client.get(path).status_code == 403


def test_verified_request_is_processed(origin_secret, scene):
    res = cloudfront_client().get("/api/scenes/")

    assert res.status_code == 200
    assert [s["id"] for s in res.json()] == [scene.id]


def test_verified_preflight_request_is_processed(origin_secret, settings):
    settings.CORS_ALLOWED_ORIGINS = ["https://frontend.example"]
    res = cloudfront_client().options(
        "/api/progress/complete_lesson/",
        HTTP_ORIGIN="https://frontend.example",
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
    )

    assert res.status_code == 200
    assert res["Access-Control-Allow-Origin"] == "https://frontend.example"


def test_nothing_is_checked_without_secret(api_client, scene):
    # ORIGIN_VERIFY_SECRET が未設定（ローカル開発・テスト）ではヘッダーなしでも処理する
    assert api_client.get("/api/scenes/").status_code == 200


# --- 閲覧者の IP アドレス ---------------------------------------------------------


@override_settings(ORIGIN_VERIFY_SECRET=SECRET)
def test_viewer_ip_becomes_remote_addr_and_headers_are_removed():
    response, request = run_middleware(
        HTTP_X_ORIGIN_VERIFY=SECRET,
        HTTP_X_VIEWER_IP="198.51.100.7",
        HTTP_X_FORWARDED_FOR="10.0.0.1, 192.0.2.1",
        REMOTE_ADDR="130.176.0.1",
    )

    assert response.status_code == 200
    assert request.META["REMOTE_ADDR"] == "198.51.100.7"
    # 秘密の値・転送用のヘッダーはビューに渡さない
    for key in ("HTTP_X_ORIGIN_VERIFY", "HTTP_X_VIEWER_IP", "HTTP_X_FORWARDED_FOR"):
        assert key not in request.META
    assert SECRET not in repr(request.META)
    assert "x-origin-verify" not in {k.lower() for k in request.headers}


@override_settings(ORIGIN_VERIFY_SECRET=SECRET)
@pytest.mark.parametrize("viewer_ip", ["not-an-ip", "198.51.100.7, 10.0.0.1", "999.1.1.1", ""])
def test_invalid_viewer_ip_is_ignored(viewer_ip):
    response, request = run_middleware(
        HTTP_X_ORIGIN_VERIFY=SECRET,
        HTTP_X_VIEWER_IP=viewer_ip,
        HTTP_X_FORWARDED_FOR="192.0.2.99",
        REMOTE_ADDR="130.176.0.1",
    )

    assert response.status_code == 200
    # 不正な値は使わず、接続元のアドレスのまま（X-Forwarded-For も使わない）
    assert request.META["REMOTE_ADDR"] == "130.176.0.1"
    assert "HTTP_X_FORWARDED_FOR" not in request.META
    assert "HTTP_X_VIEWER_IP" not in request.META


@override_settings(ORIGIN_VERIFY_SECRET="")
def test_headers_are_kept_without_secret():
    _, request = run_middleware(HTTP_X_VIEWER_IP="198.51.100.7", REMOTE_ADDR="127.0.0.1")

    assert request.META["REMOTE_ADDR"] == "127.0.0.1"
    assert request.META["HTTP_X_VIEWER_IP"] == "198.51.100.7"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("203.0.113.10", "203.0.113.10"),
        (" 203.0.113.10 ", "203.0.113.10"),
        ("2001:DB8::1", "2001:db8::1"),
        ("", None),
        (None, None),
        ("203.0.113.10:443", None),
    ],
)
def test_parse_ip(value, expected):
    assert parse_ip(value) == expected


# --- レート制限 -----------------------------------------------------------------


def test_throttle_is_counted_per_viewer_ip(origin_secret, scene, monkeypatch):
    monkeypatch.setattr(AnonRateThrottle, "THROTTLE_RATES", {"anon": "2/min"})
    first = cloudfront_client(viewer_ip="203.0.113.1")
    second = cloudfront_client(viewer_ip="203.0.113.2")

    assert first.get("/api/scenes/").status_code == 200
    assert first.get("/api/scenes/").status_code == 200
    assert first.get("/api/scenes/").status_code == 429
    # 別の閲覧者は独立して数える（CloudFront のエッジのアドレスで共有しない）
    assert second.get("/api/scenes/").status_code == 200


def test_client_forwarded_for_does_not_change_throttle_key(origin_secret, scene, monkeypatch):
    monkeypatch.setattr(AnonRateThrottle, "THROTTLE_RATES", {"anon": "1/min"})
    client = cloudfront_client(viewer_ip="203.0.113.1")

    assert client.get("/api/scenes/", HTTP_X_FORWARDED_FOR="192.0.2.1").status_code == 200
    # X-Forwarded-For を変えても、同じ閲覧者として数える
    assert client.get("/api/scenes/", HTTP_X_FORWARDED_FOR="192.0.2.2").status_code == 429


def test_view_does_not_receive_secret(origin_secret, scene):
    seen = {}
    real_list = views.SceneViewSet.list

    def capture(self, request, *args, **kwargs):
        seen["meta"] = dict(request.META)
        return real_list(self, request, *args, **kwargs)

    with mock.patch.object(views.SceneViewSet, "list", capture):
        res = cloudfront_client(viewer_ip="203.0.113.5").get("/api/scenes/")

    assert res.status_code == 200
    assert seen["meta"]["REMOTE_ADDR"] == "203.0.113.5"
    assert SECRET not in repr(seen["meta"])
