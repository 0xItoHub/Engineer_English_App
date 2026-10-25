"""AI チャットの設定・API キーの取得・各プロバイダのリクエストと応答の処理。

外部への通信はすべてモックに差し替える。
"""

import io
import json
import logging
import urllib.error
from unittest import mock

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError, ReadTimeoutError

from core.chat import config as chat_config
from core.chat import providers, secrets
from core.chat.config import load_chat_config
from core.chat.prompts import SYSTEM_PROMPT
from core.chat.providers import (
    BedrockProvider,
    DisabledProvider,
    GeminiProvider,
    OpenAICompatibleProvider,
    ProviderError,
    ProviderTimeout,
    build_provider,
)

MESSAGES = [
    {"role": "user", "content": "What does LGTM mean?"},
    {"role": "assistant", "content": "Looks good to me の略です。"},
    {"role": "user", "content": "丁寧な言い方は？"},
]
FAKE_KEY = "fake-key-for-tests"


@pytest.fixture(autouse=True)
def _reset_caches():
    secrets.clear_cache()
    providers._bedrock_clients.clear()
    yield
    secrets.clear_cache()
    providers._bedrock_clients.clear()


@pytest.fixture
def fake_key():
    with mock.patch.object(secrets, "_fetch_parameter", return_value=FAKE_KEY) as fetch:
        yield fetch


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def _respond(data):
    raw = data if isinstance(data, bytes) else json.dumps(data).encode()
    return mock.patch.object(providers._opener, "open", return_value=_FakeResponse(raw))


# --- 設定 ---------------------------------------------------------------------


def test_config_is_disabled_by_default():
    config = load_chat_config({})
    assert config.provider == "disabled"
    assert not config.enabled
    assert (config.max_input_chars, config.max_output_tokens, config.max_history) == (500, 300, 6)
    assert (config.user_daily_limit, config.global_daily_limit) == (20, 200)
    assert config.timeout_seconds == 20


def test_config_unknown_provider_is_disabled():
    assert load_chat_config({"CHAT_PROVIDER": "something"}).provider == "disabled"


def test_config_key_based_provider_requires_key_param():
    assert load_chat_config({"CHAT_PROVIDER": "gemini"}).provider == "disabled"
    config = load_chat_config({"CHAT_PROVIDER": "Gemini", "CHAT_API_KEY_SSM_PARAM": "/p/key"})
    assert config.provider == "gemini"
    assert config.model == chat_config.DEFAULT_MODELS["gemini"]


@pytest.mark.parametrize(
    "base_url, model, expected",
    [
        ("https://api.example.test/v1/", "m-1", "openai_compatible"),
        ("http://api.example.test/v1", "m-1", "disabled"),
        ("", "m-1", "disabled"),
        ("https://api.example.test/v1", "", "disabled"),
    ],
)
def test_config_openai_compatible_requires_https_and_model(base_url, model, expected):
    config = load_chat_config(
        {
            "CHAT_PROVIDER": "openai_compatible",
            "CHAT_API_KEY_SSM_PARAM": "/p/key",
            "CHAT_API_BASE_URL": base_url,
            "CHAT_MODEL": model,
        }
    )
    assert config.provider == expected
    if expected != "disabled":
        assert config.api_base_url == "https://api.example.test/v1"


def test_config_bedrock_uses_iam_and_default_model():
    config = load_chat_config({"CHAT_PROVIDER": "bedrock"})
    assert config.provider == "bedrock"
    assert config.model == "apac.amazon.nova-micro-v1:0"


def test_config_limits_are_parsed_and_bounded():
    config = load_chat_config(
        {
            "CHAT_MAX_INPUT_CHARS": "abc",
            "CHAT_MAX_OUTPUT_TOKENS": "0",
            "CHAT_MAX_HISTORY": "100",
            "CHAT_USER_DAILY_LIMIT": "5",
            "CHAT_GLOBAL_DAILY_LIMIT": "-1",
            "CHAT_TIMEOUT_SECONDS": "60",
        }
    )
    assert config.max_input_chars == 500
    assert config.max_output_tokens == 1
    assert config.max_history == 20
    assert config.user_daily_limit == 5
    assert config.global_daily_limit == 0
    # API Gateway の統合のタイムアウトより短くする
    assert config.timeout_seconds == chat_config.MAX_TIMEOUT_SECONDS < 30


@pytest.mark.parametrize(
    "env, cls",
    [
        ({}, DisabledProvider),
        ({"CHAT_PROVIDER": "gemini", "CHAT_API_KEY_SSM_PARAM": "/k"}, GeminiProvider),
        (
            {
                "CHAT_PROVIDER": "openai_compatible",
                "CHAT_API_KEY_SSM_PARAM": "/k",
                "CHAT_API_BASE_URL": "https://api.example.test/v1",
                "CHAT_MODEL": "m",
            },
            OpenAICompatibleProvider,
        ),
        ({"CHAT_PROVIDER": "bedrock"}, BedrockProvider),
    ],
)
def test_build_provider_selects_implementation(env, cls):
    assert isinstance(build_provider(load_chat_config(env)), cls)


def test_disabled_provider_does_not_connect():
    with pytest.raises(ProviderError):
        DisabledProvider().complete(MESSAGES, max_output_tokens=10, timeout=1)


# --- API キー -----------------------------------------------------------------


def test_api_key_is_fetched_once_and_cached(fake_key):
    assert secrets.get_api_key("/p/key") == FAKE_KEY
    assert secrets.get_api_key("/p/key") == FAKE_KEY
    fake_key.assert_called_once_with("/p/key")


def test_api_key_fetch_uses_ssm_with_decryption():
    client = mock.Mock()
    client.get_parameter.return_value = {"Parameter": {"Value": FAKE_KEY}}
    with mock.patch("boto3.client", return_value=client) as factory:
        assert secrets.get_api_key("/p/key") == FAKE_KEY
    factory.assert_called_once_with("ssm")
    client.get_parameter.assert_called_once_with(Name="/p/key", WithDecryption=True)


def test_api_key_failure_is_not_cached_and_not_logged(caplog):
    caplog.set_level(logging.DEBUG)
    error = RuntimeError(f"denied {FAKE_KEY}")
    with mock.patch.object(secrets, "_fetch_parameter", side_effect=error) as fetch:
        with pytest.raises(secrets.ApiKeyUnavailable) as raised:
            secrets.get_api_key("/p/key")
        with pytest.raises(secrets.ApiKeyUnavailable):
            secrets.get_api_key("/p/key")
    assert fetch.call_count == 2
    assert raised.value.__cause__ is None
    assert FAKE_KEY not in caplog.text
    assert "RuntimeError" in caplog.text


def test_api_key_empty_value_is_rejected():
    with mock.patch.object(secrets, "_fetch_parameter", return_value="  "):
        with pytest.raises(secrets.ApiKeyUnavailable):
            secrets.get_api_key("/p/key")
    with pytest.raises(secrets.ApiKeyUnavailable):
        secrets.get_api_key("")


def test_api_key_never_logged_during_completion(fake_key, caplog):
    caplog.set_level(logging.DEBUG)
    provider = GeminiProvider(model="gemini-x", api_key_ssm_param="/p/key")
    with _respond({"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}):
        provider.complete(MESSAGES, max_output_tokens=10, timeout=1)
    assert FAKE_KEY not in caplog.text


# --- Gemini -------------------------------------------------------------------


def test_gemini_builds_generate_content_request(fake_key):
    provider = GeminiProvider(model="gemini-x", api_key_ssm_param="/p/key")
    with _respond({"candidates": [{"content": {"parts": [{"text": " 回答です "}]}}]}) as opened:
        reply = provider.complete(MESSAGES, max_output_tokens=123, timeout=7)

    assert reply == "回答です"
    request = opened.call_args.args[0]
    assert opened.call_args.kwargs["timeout"] == 7
    assert request.full_url == (
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent"
    )
    assert request.get_method() == "POST"
    assert request.get_header("X-goog-api-key") == FAKE_KEY
    # API キーは URL に含めない
    assert FAKE_KEY not in request.full_url
    body = json.loads(request.data)
    assert body["systemInstruction"] == {"parts": [{"text": SYSTEM_PROMPT}]}
    assert [c["role"] for c in body["contents"]] == ["user", "model", "user"]
    assert body["contents"][2]["parts"] == [{"text": "丁寧な言い方は？"}]
    assert body["generationConfig"]["maxOutputTokens"] == 123


def test_gemini_skips_thought_parts():
    data = {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": "考え中", "thought": True}, {"text": "A"}, {"text": "B"}]
                }
            }
        ]
    }
    assert GeminiProvider.parse_response(data) == "AB"


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"candidates": []},
        {"promptFeedback": {"blockReason": "SAFETY"}},
        {"candidates": [{"finishReason": "SAFETY"}]},
        {"candidates": [{"content": {"parts": [{"text": "   "}]}}]},
        [],
    ],
)
def test_gemini_unexpected_response_is_error(data):
    with pytest.raises(ProviderError):
        GeminiProvider.parse_response(data)


def test_gemini_rejects_invalid_model_name(fake_key):
    provider = GeminiProvider(model="../x?key=1", api_key_ssm_param="/p/key")
    with pytest.raises(ProviderError) as raised:
        provider.complete(MESSAGES, max_output_tokens=1, timeout=1)
    assert raised.value.reason == "invalid_model"


def test_reply_is_truncated():
    data = {"candidates": [{"content": {"parts": [{"text": "a" * 10000}]}}]}
    assert len(GeminiProvider.parse_response(data)) == providers.MAX_REPLY_CHARS


# --- HTTP のエラー --------------------------------------------------------------


def _gemini():
    return GeminiProvider(model="gemini-x", api_key_ssm_param="/p/key")


def test_http_error_maps_to_provider_error_without_body(fake_key):
    error = urllib.error.HTTPError(
        "https://x", 429, "Too Many", {}, io.BytesIO(b'{"error": "secret upstream text"}')
    )
    with mock.patch.object(providers._opener, "open", side_effect=error):
        with pytest.raises(ProviderError) as raised:
            _gemini().complete(MESSAGES, max_output_tokens=1, timeout=1)
    assert raised.value.status == 429
    assert "secret upstream text" not in str(raised.value)
    assert raised.value.__cause__ is None


@pytest.mark.parametrize(
    "error",
    [
        TimeoutError("timed out"),
        urllib.error.URLError(TimeoutError("timed out")),
    ],
)
def test_timeouts_map_to_provider_timeout(fake_key, error):
    with mock.patch.object(providers._opener, "open", side_effect=error):
        with pytest.raises(ProviderTimeout):
            _gemini().complete(MESSAGES, max_output_tokens=1, timeout=1)


def test_connection_error_maps_to_provider_error(fake_key):
    with mock.patch.object(providers._opener, "open", side_effect=urllib.error.URLError("refused")):
        with pytest.raises(ProviderError) as raised:
            _gemini().complete(MESSAGES, max_output_tokens=1, timeout=1)
    assert not isinstance(raised.value, ProviderTimeout)
    assert raised.value.reason == "connection_error"


def test_invalid_json_and_too_large_response(fake_key):
    with _respond(b"not json"):
        with pytest.raises(ProviderError) as raised:
            _gemini().complete(MESSAGES, max_output_tokens=1, timeout=1)
    assert raised.value.reason == "invalid_json"

    with _respond(b" " * (providers.MAX_RESPONSE_BYTES + 10)):
        with pytest.raises(ProviderError) as raised:
            _gemini().complete(MESSAGES, max_output_tokens=1, timeout=1)
    assert raised.value.reason == "response_too_large"


def test_api_key_unavailable_maps_to_provider_error():
    with mock.patch.object(secrets, "_fetch_parameter", side_effect=RuntimeError("x")):
        with mock.patch.object(providers._opener, "open") as opened:
            with pytest.raises(ProviderError) as raised:
                _gemini().complete(MESSAGES, max_output_tokens=1, timeout=1)
    assert raised.value.reason == "api_key_unavailable"
    opened.assert_not_called()


def test_post_json_requires_https():
    with pytest.raises(ProviderError) as raised:
        providers.post_json("http://x.test", {}, {}, timeout=1, provider="p")
    assert raised.value.reason == "insecure_url"


def test_redirects_are_not_followed():
    handler = providers._NoRedirect()
    assert handler.redirect_request(None, None, 302, "Found", {}, "https://other.test") is None


# --- OpenAI 互換 ----------------------------------------------------------------


def test_openai_compatible_builds_chat_completions_request(fake_key):
    provider = OpenAICompatibleProvider(
        model="llama-x", api_base_url="https://api.example.test/v1/", api_key_ssm_param="/p/key"
    )
    with _respond({"choices": [{"message": {"role": "assistant", "content": "回答"}}]}) as opened:
        assert provider.complete(MESSAGES, max_output_tokens=50, timeout=3) == "回答"

    request = opened.call_args.args[0]
    assert request.full_url == "https://api.example.test/v1/chat/completions"
    assert request.get_header("Authorization") == f"Bearer {FAKE_KEY}"
    body = json.loads(request.data)
    assert body["model"] == "llama-x"
    assert body["max_completion_tokens"] == 50
    assert body["messages"][0] == {"role": "system", "content": SYSTEM_PROMPT}
    assert [m["role"] for m in body["messages"][1:]] == ["user", "assistant", "user"]


@pytest.mark.parametrize(
    "data",
    [{}, {"choices": []}, {"choices": [{"message": {"content": None}}]}, {"choices": ["x"]}],
)
def test_openai_compatible_unexpected_response_is_error(data):
    with pytest.raises(ProviderError):
        OpenAICompatibleProvider.parse_response(data)


# --- Bedrock ------------------------------------------------------------------


def _bedrock(client):
    return BedrockProvider(model="apac.amazon.nova-micro-v1:0", client_factory=lambda t: client)


def test_bedrock_builds_converse_request():
    client = mock.Mock()
    client.converse.return_value = {
        "output": {"message": {"role": "assistant", "content": [{"text": "回答"}]}}
    }
    assert _bedrock(client).complete(MESSAGES, max_output_tokens=80, timeout=5) == "回答"

    kwargs = client.converse.call_args.kwargs
    assert kwargs["modelId"] == "apac.amazon.nova-micro-v1:0"
    assert kwargs["system"] == [{"text": SYSTEM_PROMPT}]
    assert kwargs["messages"][0] == {"role": "user", "content": [{"text": "What does LGTM mean?"}]}
    assert [m["role"] for m in kwargs["messages"]] == ["user", "assistant", "user"]
    assert kwargs["inferenceConfig"]["maxTokens"] == 80


def test_bedrock_errors_are_mapped():
    client = mock.Mock()
    client.converse.side_effect = ReadTimeoutError(endpoint_url="https://bedrock.test")
    with pytest.raises(ProviderTimeout):
        _bedrock(client).complete(MESSAGES, max_output_tokens=1, timeout=1)

    client.converse.side_effect = ClientError(
        {
            "Error": {"Code": "ThrottlingException", "Message": "upstream detail"},
            "ResponseMetadata": {"HTTPStatusCode": 429},
        },
        "Converse",
    )
    with pytest.raises(ProviderError) as raised:
        _bedrock(client).complete(MESSAGES, max_output_tokens=1, timeout=1)
    assert raised.value.status == 429
    assert "upstream detail" not in str(raised.value)

    client.converse.side_effect = EndpointConnectionError(endpoint_url="https://bedrock.test")
    with pytest.raises(ProviderError) as raised:
        _bedrock(client).complete(MESSAGES, max_output_tokens=1, timeout=1)
    assert raised.value.reason == "connection_error"


def test_bedrock_unexpected_response_is_error():
    with pytest.raises(ProviderError):
        BedrockProvider.parse_response({"output": {}})


def test_bedrock_client_is_created_once_without_retries():
    with mock.patch("boto3.client") as factory:
        first = providers._bedrock_client(20)
        second = providers._bedrock_client(20)
    assert first is second
    factory.assert_called_once()
    assert factory.call_args.args == ("bedrock-runtime",)
    config = factory.call_args.kwargs["config"]
    assert config.read_timeout == 20
    assert config.retries["total_max_attempts"] == 1
