import json
import logging

import pytest
from rest_framework.test import APIClient

from core import csp_report
from core.throttles import CspReportRateThrottle

URL = "/api/csp-report/"
LOGGER = "core.csp_report"

SECRET_QUERY = "code=secret-auth-code&state=secret-state"


def _csp_report(**overrides):
    report = {
        "document-uri": f"https://app.example.com/auth/callback?{SECRET_QUERY}#frag",
        "referrer": "https://login.example.com/?token=secret-referrer",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "original-policy": "default-src 'self'; report-uri /api/csp-report/",
        "disposition": "report",
        "blocked-uri": "https://cdn.example.net/lib.js?key=secret-key",
        "status-code": 200,
        "script-sample": "secret-sample",
    }
    report.update(overrides)
    return {"csp-report": report}


def _post(client, payload, content_type="application/csp-report"):
    body = payload if isinstance(payload, bytes) else json.dumps(payload)
    return client.generic("POST", URL, body, content_type=content_type)


def _messages(caplog):
    return [r.getMessage() for r in caplog.records if r.name == LOGGER]


@pytest.fixture
def client():
    # CSRF の検証を有効にしたクライアントでも受け付けられることを確認する
    return APIClient(enforce_csrf_checks=True)


# --- 受け付ける形式 -----------------------------------------------------------


def test_csp_report_format_returns_204_and_logs_summary(client, caplog):
    caplog.set_level(logging.WARNING, logger=LOGGER)
    res = _post(client, _csp_report())

    assert res.status_code == 204
    assert _messages(caplog) == [
        "csp_violation directive=script-src-elem blocked=https://cdn.example.net "
        "document=/auth/callback disposition=report"
    ]
    assert all(r.levelno == logging.WARNING for r in caplog.records if r.name == LOGGER)


def test_reports_json_format_returns_204_and_logs_first_report(client, caplog):
    caplog.set_level(logging.WARNING, logger=LOGGER)
    payload = [
        {
            "type": "csp-violation",
            "url": "https://app.example.com/scene/1?x=1",
            "body": {
                "documentURL": "https://app.example.com/scene/1?x=1",
                "effectiveDirective": "img-src",
                "blockedURL": "https://img.example.org:8443/a.png?sig=secret",
                "disposition": "enforce",
            },
        },
        {"type": "deprecation", "body": {"message": "ignored"}},
        {
            "type": "csp-violation",
            "url": "https://app.example.com/",
            "body": {"effectiveDirective": "style-src-attr", "blockedURL": "inline"},
        },
    ]
    res = _post(client, payload, content_type="application/reports+json")

    assert res.status_code == 204
    assert _messages(caplog) == [
        "csp_violation directive=img-src blocked=https://img.example.org:8443 "
        "document=/scene/1 disposition=enforce",
    ]


def test_application_json_is_accepted(client, caplog):
    caplog.set_level(logging.WARNING, logger=LOGGER)
    res = _post(client, _csp_report(), content_type="application/json; charset=utf-8")
    assert res.status_code == 204
    assert len(_messages(caplog)) == 1


def test_reports_json_logs_at_most_limit(client, caplog):
    caplog.set_level(logging.WARNING, logger=LOGGER)
    item = {"type": "csp-violation", "body": {"effectiveDirective": "img-src"}}
    res = _post(client, [item] * 20, content_type="application/reports+json")
    assert res.status_code == 204
    assert len(_messages(caplog)) == csp_report.MAX_REPORTS_PER_REQUEST


def test_unsupported_content_type_returns_415(client, caplog):
    caplog.set_level(logging.WARNING, logger=LOGGER)
    res = _post(client, _csp_report(), content_type="text/plain")
    assert res.status_code == 415
    assert _messages(caplog) == []


def test_get_is_not_allowed(client):
    assert client.get(URL).status_code == 405


def test_does_not_require_authentication_header(client):
    # 不正な Authorization ヘッダーが付いていても認証は行わない
    res = client.generic(
        "POST",
        URL,
        json.dumps(_csp_report()),
        content_type="application/csp-report",
        HTTP_AUTHORIZATION="Bearer invalid-token",
    )
    assert res.status_code == 204


# --- 大きさの上限・不正な本文 ---------------------------------------------------


def test_body_over_limit_returns_413(client, caplog):
    caplog.set_level(logging.WARNING, logger=LOGGER)
    payload = _csp_report(**{"script-sample": "x" * (csp_report.MAX_BODY_BYTES + 1)})
    res = _post(client, payload)
    assert res.status_code == 413
    assert _messages(caplog) == []


def test_content_length_over_limit_returns_413_without_reading_body(client, monkeypatch):
    def fail(*args, **kwargs):  # pragma: no cover - 呼ばれた場合のみ失敗させる
        raise AssertionError("body should not be parsed")

    monkeypatch.setattr(csp_report.json, "loads", fail)
    res = client.generic(
        "POST",
        URL,
        "{}",
        content_type="application/csp-report",
        CONTENT_LENGTH=str(csp_report.MAX_BODY_BYTES + 1),
    )
    assert res.status_code == 413


def test_invalid_content_length_returns_400(client):
    res = client.generic(
        "POST", URL, "{}", content_type="application/csp-report", CONTENT_LENGTH="abc"
    )
    assert res.status_code == 400


@pytest.mark.parametrize(
    "body",
    [
        b"{not json",
        b"\xff\xfe\x00garbage",
        b"",
        b"[" * 5000,
    ],
)
def test_malformed_body_returns_400(client, caplog, body):
    caplog.set_level(logging.WARNING, logger=LOGGER)
    res = _post(client, body)
    assert res.status_code == 400
    assert _messages(caplog) == []


@pytest.mark.parametrize(
    "payload",
    [
        {},
        [],
        "string",
        123,
        None,
        {"csp-report": "not-an-object"},
        {"csp-report": {"effective-directive": 1, "blocked-uri": ["x"], "document-uri": {}}},
        [{"type": "csp-violation", "body": "not-an-object"}, "x", 1],
    ],
)
def test_unexpected_shapes_return_204(client, payload):
    assert _post(client, payload).status_code == 204


# --- ログの内容（クエリ文字列や本文を残さない） -----------------------------------


def test_log_does_not_contain_query_or_body_values(client, caplog):
    caplog.set_level(logging.DEBUG)
    _post(client, _csp_report())

    text = "\n".join(r.getMessage() for r in caplog.records)
    for secret in ("secret-auth-code", "secret-state", "secret-key", "secret-referrer"):
        assert secret not in text
    assert "secret-sample" not in text
    assert "original-policy" not in text


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://cdn.example.net/path/lib.js?token=abc", "https://cdn.example.net"),
        ("HTTPS://CDN.Example.NET:444/x", "https://cdn.example.net:444"),
        ("wss://ws.example.com/socket?ticket=abc", "wss://ws.example.com"),
        ("data:image/png;base64,AAAA", "data:"),
        ("blob:https://app.example.com/uuid", "blob:"),
        ("inline", "inline"),
        ("eval", "eval"),
        ("http://[::1", "-"),
        ("https://user:pass@host.example.com/", "https://host.example.com"),
        ("https://exa mple.com\nINJECT", "https:"),
        ("not a url", "-"),
        ("", "-"),
        (None, "-"),
    ],
)
def test_blocked_uri_is_reduced_to_origin_or_scheme(value, expected):
    assert csp_report._blocked(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://app.example.com/auth/callback?code=abc#x", "/auth/callback"),
        ("https://app.example.com", "/"),
        ("https://app.example.com/a b\n<script>", "/abscript"),
        ("http://[::1/path", "-"),
        (None, "-"),
    ],
)
def test_document_path_drops_query_and_unsafe_chars(value, expected):
    assert csp_report._document_path(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("script-src-elem", "script-src-elem"),
        ("img-src 'self' data:", "img-src"),
        ("SCRIPT-SRC", "script-src"),
        ("bad\ndirective", "bad"),
        ("x" * 100, "-"),
        (42, "-"),
    ],
)
def test_directive_is_sanitized(value, expected):
    assert csp_report._directive(value) == expected


# --- レート制限 ---------------------------------------------------------------


def test_csp_report_is_throttled(client, monkeypatch):
    monkeypatch.setattr(CspReportRateThrottle, "THROTTLE_RATES", {"csp_report": "2/min"})

    assert _post(client, _csp_report()).status_code == 204
    assert _post(client, _csp_report()).status_code == 204
    res = _post(client, _csp_report())
    assert res.status_code == 429
    assert "Retry-After" in res.headers
