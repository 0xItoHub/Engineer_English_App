"""AI チャットの設定（環境変数から読み込む）。"""

import os
from dataclasses import dataclass

PROVIDER_DISABLED = "disabled"
PROVIDER_GEMINI = "gemini"
PROVIDER_OPENAI_COMPATIBLE = "openai_compatible"
PROVIDER_BEDROCK = "bedrock"

SUPPORTED_PROVIDERS = frozenset(
    {PROVIDER_DISABLED, PROVIDER_GEMINI, PROVIDER_OPENAI_COMPATIBLE, PROVIDER_BEDROCK}
)

# プロバイダごとの既定のモデル（CHAT_MODEL が空の場合に使う）
DEFAULT_MODELS = {
    PROVIDER_GEMINI: "gemini-3.5-flash-lite",
    # 東京リージョンから呼び出す場合は APAC のクロスリージョン推論プロファイルを使う
    PROVIDER_BEDROCK: "apac.amazon.nova-micro-v1:0",
}

# API Gateway の統合のタイムアウト（30 秒）より短くする
MAX_TIMEOUT_SECONDS = 25


@dataclass(frozen=True)
class ChatConfig:
    provider: str
    model: str
    api_base_url: str
    api_key_ssm_param: str
    max_input_chars: int
    max_output_tokens: int
    max_history: int
    user_daily_limit: int
    global_daily_limit: int
    timeout_seconds: int

    @property
    def enabled(self):
        return self.provider != PROVIDER_DISABLED

    def public_limits(self):
        """画面に表示する上限（GET /api/chat/status/ の limits）。"""
        return {
            "max_input_chars": self.max_input_chars,
            "max_history": self.max_history,
            "user_daily_limit": self.user_daily_limit,
        }


def _int_env(environ, name, default, *, minimum=1, maximum=None):
    """整数の環境変数を読み込む（未設定・不正値は既定値、範囲外は範囲内に収める）。"""
    raw = (environ.get(name) or "").strip()
    try:
        value = int(raw) if raw else default
    except ValueError:
        value = default
    value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def load_chat_config(environ=None):
    """環境変数から ChatConfig を組み立てる。

    CHAT_PROVIDER が未設定・未対応の値・必要な設定が不足している場合は disabled とする。
    """
    environ = os.environ if environ is None else environ
    provider = (environ.get("CHAT_PROVIDER") or "").strip().lower() or PROVIDER_DISABLED
    if provider not in SUPPORTED_PROVIDERS:
        provider = PROVIDER_DISABLED

    model = (environ.get("CHAT_MODEL") or "").strip() or DEFAULT_MODELS.get(provider, "")
    api_base_url = (environ.get("CHAT_API_BASE_URL") or "").strip().rstrip("/")
    api_key_ssm_param = (environ.get("CHAT_API_KEY_SSM_PARAM") or "").strip()

    # API キーで認証するプロバイダは、キーのパラメータ名が必要
    if provider in (PROVIDER_GEMINI, PROVIDER_OPENAI_COMPATIBLE) and not api_key_ssm_param:
        provider = PROVIDER_DISABLED
    # OpenAI 互換の API は接続先（HTTPS）とモデルの指定が必要
    if provider == PROVIDER_OPENAI_COMPATIBLE and (
        not api_base_url.startswith("https://") or not model
    ):
        provider = PROVIDER_DISABLED

    return ChatConfig(
        provider=provider,
        model=model,
        api_base_url=api_base_url,
        api_key_ssm_param=api_key_ssm_param,
        max_input_chars=_int_env(environ, "CHAT_MAX_INPUT_CHARS", 500, maximum=4000),
        max_output_tokens=_int_env(environ, "CHAT_MAX_OUTPUT_TOKENS", 300, maximum=4000),
        max_history=_int_env(environ, "CHAT_MAX_HISTORY", 6, maximum=20),
        user_daily_limit=_int_env(environ, "CHAT_USER_DAILY_LIMIT", 20, minimum=0),
        global_daily_limit=_int_env(environ, "CHAT_GLOBAL_DAILY_LIMIT", 200, minimum=0),
        timeout_seconds=_int_env(environ, "CHAT_TIMEOUT_SECONDS", 20, maximum=MAX_TIMEOUT_SECONDS),
    )
