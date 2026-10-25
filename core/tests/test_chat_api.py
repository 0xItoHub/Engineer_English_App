"""AI チャットの API（GET /api/chat/status/、POST /api/chat/）。

接続先（LLM）の呼び出しはモックに差し替える。
"""

import datetime
import logging
from unittest import mock

import pytest

from core.chat import usage, views
from core.chat.providers import ProviderError, ProviderTimeout
from core.chat.serializers import normalize_messages
from core.db import RetryExhausted
from core.models import ChatUsage
from core.throttles import ChatRateThrottle

from .factories import make_user

pytestmark = pytest.mark.django_db

STATUS_URL = "/api/chat/status/"
CHAT_URL = "/api/chat/"
QUESTION = "「確認します」を英語で丁寧に言うには？"


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setenv("CHAT_PROVIDER", "bedrock")
    monkeypatch.setenv("CHAT_USER_DAILY_LIMIT", "3")
    monkeypatch.setenv("CHAT_GLOBAL_DAILY_LIMIT", "5")


@pytest.fixture
def provider():
    fake = mock.Mock()
    fake.name = "fake"
    fake.complete.return_value = "I'll check it. と言えます。"
    with mock.patch.object(views, "build_provider", return_value=fake):
        yield fake


def _ask(client, content=QUESTION, messages=None):
    body = {"messages": messages or [{"role": "user", "content": content}]}
    return client.post(CHAT_URL, body, format="json")


# --- 状態の確認 -----------------------------------------------------------------


def test_status_when_disabled(api_client):
    res = api_client.get(STATUS_URL)
    assert res.status_code == 200
    body = res.json()
    assert body["enabled"] is False
    assert body["requires_login"] is True
    assert body["limits"] == {"max_input_chars": 500, "max_history": 6, "user_daily_limit": 20}
    assert "remaining_today" not in body


def test_status_when_enabled_includes_remaining_for_signed_in_user(enabled, auth_client, user):
    ChatUsage.objects.create(user_sub=user.sub, date=usage.today_tokyo(), count=1)
    body = auth_client.get(STATUS_URL).json()
    assert body["enabled"] is True
    assert body["limits"]["user_daily_limit"] == 3
    assert body["remaining_today"] == 2


def test_status_does_not_expose_provider_or_model(enabled, api_client):
    text = api_client.get(STATUS_URL).content.decode()
    assert "bedrock" not in text
    assert "nova" not in text


# --- 質問 -------------------------------------------------------------------------


def test_chat_requires_login(enabled, api_client, provider):
    res = _ask(api_client)
    assert res.status_code == 401
    provider.complete.assert_not_called()


def test_chat_disabled_returns_503(auth_client):
    res = _ask(auth_client)
    assert res.status_code == 503
    assert res.json() == {"detail": "AI チャットは現在利用できません。"}
    assert not ChatUsage.objects.exists()


def test_chat_returns_reply_and_remaining(enabled, auth_client, user, provider):
    res = _ask(auth_client)
    assert res.status_code == 200
    assert res.json() == {"reply": "I'll check it. と言えます。", "remaining_today": 2}

    messages = provider.complete.call_args.args[0]
    assert messages == [{"role": "user", "content": QUESTION}]
    kwargs = provider.complete.call_args.kwargs
    assert kwargs == {"max_output_tokens": 300, "timeout": 20}


def test_chat_does_not_store_message_contents(enabled, auth_client, user, provider):
    _ask(auth_client)
    rows = list(ChatUsage.objects.values())
    assert {row["user_sub"] for row in rows} == {user.sub, ChatUsage.GLOBAL_SUB}
    assert all(QUESTION not in str(row) for row in rows)


@pytest.mark.parametrize(
    "messages, detail",
    [
        ([], None),
        ([{"role": "system", "content": "x"}], None),
        ([{"role": "user", "content": "   "}], None),
        (
            [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}],
            "最後のメッセージ",
        ),
        ([{"role": "user", "content": "a" * 501}], "500 文字以内"),
        ([{"role": "user", "content": "a"}] * 7, "直近 6 件"),
        (
            [{"role": "assistant", "content": "a" * 2001}, {"role": "user", "content": "b"}],
            "会話が長すぎます",
        ),
        (
            [{"role": "assistant", "content": "b" * 2000}, {"role": "user", "content": "a" * 500}]
            * 3,
            "会話が長すぎます",
        ),
    ],
)
def test_chat_validates_messages(enabled, auth_client, provider, messages, detail):
    res = auth_client.post(CHAT_URL, {"messages": messages}, format="json")
    assert res.status_code == 400
    body = res.json()
    assert isinstance(body["detail"], str)
    if detail:
        assert detail in body["detail"]
    provider.complete.assert_not_called()
    assert not ChatUsage.objects.exists()


def test_chat_requires_messages_list(enabled, auth_client, provider):
    res = auth_client.post(CHAT_URL, {"messages": "hello"}, format="json")
    assert res.status_code == 400
    res = auth_client.post(CHAT_URL, {}, format="json")
    assert res.status_code == 400


def test_normalize_messages_starts_with_user_and_alternates():
    messages = [
        {"role": "assistant", "content": "greeting"},
        {"role": "user", "content": "a"},
        {"role": "user", "content": "b"},
        {"role": "assistant", "content": "c"},
        {"role": "user", "content": "d"},
    ]
    assert normalize_messages(messages) == [
        {"role": "user", "content": "a\nb"},
        {"role": "assistant", "content": "c"},
        {"role": "user", "content": "d"},
    ]


# --- 日ごとの上限 -------------------------------------------------------------------


def test_user_daily_limit(enabled, auth_client, user, provider):
    for expected in (2, 1, 0):
        assert _ask(auth_client).json()["remaining_today"] == expected
    res = _ask(auth_client)
    assert res.status_code == 429
    assert "上限" in res.json()["detail"]
    assert provider.complete.call_count == 3
    today = usage.today_tokyo()
    assert ChatUsage.objects.get(user_sub=user.sub, date=today).count == 3
    assert ChatUsage.objects.get(user_sub=ChatUsage.GLOBAL_SUB, date=today).count == 3


def test_global_daily_limit(enabled, api_client, provider):
    from rest_framework.test import APIClient

    for i in range(5):
        client = APIClient()
        client.force_authenticate(user=make_user(sub=f"user-{i}"))
        assert _ask(client).status_code == 200

    client = APIClient()
    client.force_authenticate(user=make_user(sub="user-late"))
    res = _ask(client)
    assert res.status_code == 429
    assert "受付は終了" in res.json()["detail"]
    assert provider.complete.call_count == 5
    assert not ChatUsage.objects.filter(user_sub="user-late").exists()


def test_daily_limit_resets_on_next_tokyo_day(enabled, auth_client, user, provider):
    yesterday = usage.today_tokyo() - datetime.timedelta(days=1)
    ChatUsage.objects.create(user_sub=user.sub, date=yesterday, count=3)
    ChatUsage.objects.create(user_sub=ChatUsage.GLOBAL_SUB, date=yesterday, count=5)
    assert _ask(auth_client).status_code == 200


def test_today_tokyo_uses_japan_time():
    # 2026-01-01 15:30 UTC は 日本時間 2026-01-02 00:30
    now = datetime.datetime(2026, 1, 1, 15, 30, tzinfo=datetime.UTC)
    assert usage.today_tokyo(now) == datetime.date(2026, 1, 2)


def test_usage_is_reserved_even_when_provider_fails(enabled, auth_client, user, provider):
    provider.complete.side_effect = ProviderError("fake", status=500)
    assert _ask(auth_client).status_code == 502
    assert ChatUsage.objects.get(user_sub=user.sub).count == 1


def test_busy_database_returns_503(enabled, auth_client, provider):
    with mock.patch.object(usage, "run_in_transaction_with_retry", side_effect=RetryExhausted):
        res = _ask(auth_client)
    assert res.status_code == 503
    provider.complete.assert_not_called()


# --- 接続先のエラー -------------------------------------------------------------------


def test_provider_error_returns_502_without_upstream_details(
    enabled, auth_client, provider, caplog
):
    caplog.set_level(logging.INFO, logger="core.chat")
    provider.complete.side_effect = ProviderError("fake", status=429, reason="http_error")
    res = _ask(auth_client)
    assert res.status_code == 502
    assert res.json() == {"detail": views.UPSTREAM_ERROR_DETAIL}
    assert "provider=fake result=http_error status=429" in caplog.text
    # チャットの内容はログに残さない
    assert QUESTION not in caplog.text


def test_provider_timeout_returns_504(enabled, auth_client, provider, caplog):
    caplog.set_level(logging.INFO, logger="core.chat")
    provider.complete.side_effect = ProviderTimeout("fake")
    res = _ask(auth_client)
    assert res.status_code == 504
    assert res.json() == {"detail": views.UPSTREAM_TIMEOUT_DETAIL}
    assert "result=timeout" in caplog.text


def test_success_log_has_no_contents(enabled, auth_client, provider, caplog):
    caplog.set_level(logging.INFO, logger="core.chat")
    _ask(auth_client)
    assert "provider=fake result=ok status=200 latency_ms=" in caplog.text
    assert QUESTION not in caplog.text
    assert provider.complete.return_value not in caplog.text


def test_chat_is_throttled(enabled, auth_client, provider, monkeypatch):
    monkeypatch.setattr(ChatRateThrottle, "THROTTLE_RATES", {"chat": "2/min"})
    monkeypatch.setenv("CHAT_USER_DAILY_LIMIT", "100")
    monkeypatch.setenv("CHAT_GLOBAL_DAILY_LIMIT", "100")
    assert _ask(auth_client).status_code == 200
    assert _ask(auth_client).status_code == 200
    res = _ask(auth_client)
    assert res.status_code == 429
    assert provider.complete.call_count == 2


def test_chat_get_is_not_allowed(enabled, auth_client):
    assert auth_client.get(CHAT_URL).status_code == 405
