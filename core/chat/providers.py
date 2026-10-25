"""AI チャットの接続先（プロバイダ）。

すべてのプロバイダは同じ形式のメッセージ（role: "user" / "assistant"、content: 文字列）を受け取り、
回答の本文（プレーンテキスト）を返す。
- 接続の失敗・想定外の応答は ProviderError、時間切れは ProviderTimeout を送出する
- 例外のメッセージには接続先の応答本文・API キー・チャットの内容を含めない
"""

import json
import re
import urllib.error
import urllib.parse
import urllib.request

from . import config as chat_config
from .prompts import SYSTEM_PROMPT
from .secrets import ApiKeyUnavailable, get_api_key

# 応答本文として読み込む上限（バイト）
MAX_RESPONSE_BYTES = 1024 * 1024
# 回答として返す本文の上限（文字数）
MAX_REPLY_CHARS = 4000
# 回答のゆらぎ（低めにして、説明・添削を安定させる）
TEMPERATURE = 0.4

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

# モデル名として受け付ける形式（URL に埋め込むため英数字と . _ : / - のみ）
_MODEL_RE = re.compile(r"^[A-Za-z0-9._:/-]{1,200}$")


class ProviderError(Exception):
    """接続先から回答を取得できなかったことを表す。"""

    def __init__(self, provider, *, status=None, reason="error"):
        super().__init__(f"{provider}: {reason}")
        self.provider = provider
        self.status = status
        self.reason = reason


class ProviderTimeout(ProviderError):
    """接続先の応答が時間内に返らなかったことを表す。"""

    def __init__(self, provider):
        super().__init__(provider, reason="timeout")


class ChatProvider:
    """プロバイダの共通インターフェース。"""

    name = "base"

    def complete(self, messages, *, max_output_tokens, timeout):
        """会話の履歴（最後は user）を受け取り、回答の本文を返す。"""
        raise NotImplementedError


def _clean_reply(text, provider):
    text = (text or "").strip()
    if not text:
        raise ProviderError(provider, reason="empty_reply")
    return text[:MAX_REPLY_CHARS]


def _validated_model(model, provider):
    if not _MODEL_RE.match(model or ""):
        raise ProviderError(provider, reason="invalid_model")
    return model


def _api_key(param_name, provider):
    try:
        return get_api_key(param_name)
    except ApiKeyUnavailable:
        raise ProviderError(provider, reason="api_key_unavailable") from None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """リダイレクトには従わない（API キーのヘッダーを別の接続先へ送らない）。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect())


def _is_timeout(error):
    if isinstance(error, TimeoutError):
        return True
    return isinstance(error, urllib.error.URLError) and isinstance(error.reason, TimeoutError)


def post_json(url, payload, headers, *, timeout, provider):
    """JSON を POST し、応答の JSON を返す（標準ライブラリの urllib を使う）。"""
    if not url.startswith("https://"):
        raise ProviderError(provider, reason="insecure_url")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json", **headers},
    )
    try:
        with _opener.open(request, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        # 応答本文には入力内容が含まれることがあるため読み込まない
        error.close()
        raise ProviderError(provider, status=error.code, reason="http_error") from None
    except (urllib.error.URLError, OSError) as error:
        if _is_timeout(error):
            raise ProviderTimeout(provider) from None
        raise ProviderError(provider, reason="connection_error") from None
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ProviderError(provider, reason="response_too_large")
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, ValueError):
        raise ProviderError(provider, reason="invalid_json") from None


class DisabledProvider(ChatProvider):
    """設定されていない場合のプロバイダ（外部へは接続しない）。"""

    name = chat_config.PROVIDER_DISABLED

    def complete(self, messages, *, max_output_tokens, timeout):
        raise ProviderError(self.name, reason="disabled")


class GeminiProvider(ChatProvider):
    """Google の Gemini API（Generative Language API の generateContent）。"""

    name = chat_config.PROVIDER_GEMINI

    def __init__(self, *, model, api_key_ssm_param, api_base=GEMINI_API_BASE):
        self.model = model
        self.api_key_ssm_param = api_key_ssm_param
        self.api_base = api_base

    def build_request(self, messages, *, max_output_tokens):
        model = urllib.parse.quote(_validated_model(self.model, self.name), safe="._-")
        url = f"{self.api_base}/models/{model}:generateContent"
        payload = {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [
                {
                    "role": "model" if m["role"] == "assistant" else "user",
                    "parts": [{"text": m["content"]}],
                }
                for m in messages
            ],
            "generationConfig": {
                "maxOutputTokens": max_output_tokens,
                "temperature": TEMPERATURE,
            },
        }
        return url, payload

    @classmethod
    def parse_response(cls, data):
        candidates = data.get("candidates") if isinstance(data, dict) else None
        if not candidates or not isinstance(candidates, list):
            raise ProviderError(cls.name, reason="no_candidates")
        content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            raise ProviderError(cls.name, reason="no_content")
        # 思考の過程（thought: true）は回答に含めない
        texts = [
            p["text"]
            for p in parts
            if isinstance(p, dict) and isinstance(p.get("text"), str) and not p.get("thought")
        ]
        return _clean_reply("".join(texts), cls.name)

    def complete(self, messages, *, max_output_tokens, timeout):
        url, payload = self.build_request(messages, max_output_tokens=max_output_tokens)
        key = _api_key(self.api_key_ssm_param, self.name)
        data = post_json(url, payload, {"x-goog-api-key": key}, timeout=timeout, provider=self.name)
        return self.parse_response(data)


class OpenAICompatibleProvider(ChatProvider):
    """OpenAI 互換の Chat Completions API（OpenAI・Groq など）。

    api_base_url には `/chat/completions` の手前まで（例: https://api.openai.com/v1）を指定する。
    """

    name = chat_config.PROVIDER_OPENAI_COMPATIBLE

    def __init__(self, *, model, api_base_url, api_key_ssm_param):
        self.model = model
        self.api_base_url = api_base_url.rstrip("/")
        self.api_key_ssm_param = api_key_ssm_param

    def build_request(self, messages, *, max_output_tokens):
        url = f"{self.api_base_url}/chat/completions"
        payload = {
            "model": _validated_model(self.model, self.name),
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                *({"role": m["role"], "content": m["content"]} for m in messages),
            ],
            "max_completion_tokens": max_output_tokens,
            "temperature": TEMPERATURE,
        }
        return url, payload

    @classmethod
    def parse_response(cls, data):
        choices = data.get("choices") if isinstance(data, dict) else None
        if not choices or not isinstance(choices, list) or not isinstance(choices[0], dict):
            raise ProviderError(cls.name, reason="no_choices")
        message = choices[0].get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str):
            raise ProviderError(cls.name, reason="no_content")
        return _clean_reply(content, cls.name)

    def complete(self, messages, *, max_output_tokens, timeout):
        url, payload = self.build_request(messages, max_output_tokens=max_output_tokens)
        key = _api_key(self.api_key_ssm_param, self.name)
        data = post_json(
            url, payload, {"Authorization": f"Bearer {key}"}, timeout=timeout, provider=self.name
        )
        return self.parse_response(data)


_bedrock_clients = {}


def _bedrock_client(timeout):
    """bedrock-runtime のクライアント（タイムアウトごとに 1 つ作成して再利用する）。"""
    client = _bedrock_clients.get(timeout)
    if client is None:
        import boto3
        from botocore.config import Config

        client = boto3.client(
            "bedrock-runtime",
            config=Config(
                connect_timeout=min(5, timeout),
                read_timeout=timeout,
                # 時間内に応答を返すため、自動の再試行は行わない
                retries={"mode": "standard", "total_max_attempts": 1},
            ),
        )
        _bedrock_clients[timeout] = client
    return client


class BedrockProvider(ChatProvider):
    """Amazon Bedrock の Converse API（IAM ロールで認証し、API キーは使わない）。"""

    name = chat_config.PROVIDER_BEDROCK

    def __init__(self, *, model, client_factory=_bedrock_client):
        self.model = model
        self.client_factory = client_factory

    def build_request(self, messages, *, max_output_tokens):
        return {
            "modelId": _validated_model(self.model, self.name),
            "system": [{"text": SYSTEM_PROMPT}],
            "messages": [
                {"role": m["role"], "content": [{"text": m["content"]}]} for m in messages
            ],
            "inferenceConfig": {"maxTokens": max_output_tokens, "temperature": TEMPERATURE},
        }

    @classmethod
    def parse_response(cls, data):
        output = data.get("output") if isinstance(data, dict) else None
        message = output.get("message") if isinstance(output, dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list):
            raise ProviderError(cls.name, reason="no_content")
        texts = [
            c["text"] for c in content if isinstance(c, dict) and isinstance(c.get("text"), str)
        ]
        return _clean_reply("".join(texts), cls.name)

    def complete(self, messages, *, max_output_tokens, timeout):
        from botocore.exceptions import (
            BotoCoreError,
            ClientError,
            ConnectTimeoutError,
            ReadTimeoutError,
        )

        request = self.build_request(messages, max_output_tokens=max_output_tokens)
        try:
            data = self.client_factory(timeout).converse(**request)
        except (ReadTimeoutError, ConnectTimeoutError):
            raise ProviderTimeout(self.name) from None
        except ClientError as error:
            status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            raise ProviderError(self.name, status=status, reason="client_error") from None
        except BotoCoreError:
            raise ProviderError(self.name, reason="connection_error") from None
        return self.parse_response(data)


def build_provider(config):
    """設定に対応するプロバイダを返す。"""
    if config.provider == chat_config.PROVIDER_GEMINI:
        return GeminiProvider(model=config.model, api_key_ssm_param=config.api_key_ssm_param)
    if config.provider == chat_config.PROVIDER_OPENAI_COMPATIBLE:
        return OpenAICompatibleProvider(
            model=config.model,
            api_base_url=config.api_base_url,
            api_key_ssm_param=config.api_key_ssm_param,
        )
    if config.provider == chat_config.PROVIDER_BEDROCK:
        return BedrockProvider(model=config.model)
    return DisabledProvider()
