"""AI チャットの API。

- GET  /api/chat/status/ : 利用できるかどうかと上限（ログイン不要）
- POST /api/chat/        : 質問への回答（ログインが必要）

ログには接続先の名前・結果・所要時間のみを記録し、チャットの内容は記録しない。
"""

import logging
import time

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from ..db import RetryExhausted
from ..throttles import ChatRateThrottle
from . import usage
from .config import load_chat_config
from .providers import ProviderError, ProviderTimeout, build_provider
from .serializers import ChatRequestSerializer

logger = logging.getLogger("core.chat")

DISABLED_DETAIL = "AI チャットは現在利用できません。"
USER_LIMIT_DETAIL = "本日の AI チャットの利用回数の上限に達しました。明日また利用できます。"
GLOBAL_LIMIT_DETAIL = "本日の AI チャットの受付は終了しました。明日また利用できます。"
BUSY_DETAIL = "混み合っています。しばらくしてから再度お試しください。"
UPSTREAM_ERROR_DETAIL = "AI の回答を取得できませんでした。しばらくしてから再度お試しください。"
UPSTREAM_TIMEOUT_DETAIL = "AI の回答に時間がかかっています。しばらくしてから再度お試しください。"
INVALID_DETAIL = "入力内容に誤りがあります。"


def _first_error(errors):
    """入力エラーの最初のメッセージ（文字列）を取り出す。"""
    if isinstance(errors, dict):
        for value in errors.values():
            found = _first_error(value)
            if found:
                return found
    elif isinstance(errors, list):
        for value in errors:
            found = _first_error(value)
            if found:
                return found
    elif errors:
        return str(errors)
    return None


class ChatStatusView(APIView):
    """AI チャットが利用できるかどうか（画面の表示の切り替えに使う）。"""

    permission_classes = [AllowAny]

    def get(self, request):
        config = load_chat_config()
        body = {"enabled": config.enabled, "requires_login": True, "limits": config.public_limits()}
        if config.enabled and request.user.is_authenticated:
            body["remaining_today"] = usage.remaining(request.user.sub, config)
        return Response(body)


class ChatView(APIView):
    """質問を受け取り、接続先（LLM）の回答を返す。"""

    permission_classes = [IsAuthenticated]
    throttle_classes = [UserRateThrottle, ChatRateThrottle]

    def post(self, request):
        config = load_chat_config()
        if not config.enabled:
            return Response({"detail": DISABLED_DETAIL}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        serializer = ChatRequestSerializer(data=request.data, context={"config": config})
        if not serializer.is_valid():
            detail = _first_error(serializer.errors) or INVALID_DETAIL
            return Response({"detail": detail}, status=status.HTTP_400_BAD_REQUEST)
        messages = serializer.validated_data["messages"]

        try:
            remaining_today = usage.reserve(request.user.sub, config)
        except usage.DailyLimitExceeded as exceeded:
            detail = USER_LIMIT_DETAIL if exceeded.scope == "user" else GLOBAL_LIMIT_DETAIL
            return Response({"detail": detail}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except RetryExhausted:
            return Response({"detail": BUSY_DETAIL}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        provider = build_provider(config)
        started = time.monotonic()
        try:
            reply = provider.complete(
                messages,
                max_output_tokens=config.max_output_tokens,
                timeout=config.timeout_seconds,
            )
        except ProviderTimeout:
            self._log(provider.name, "timeout", None, started)
            return Response(
                {"detail": UPSTREAM_TIMEOUT_DETAIL}, status=status.HTTP_504_GATEWAY_TIMEOUT
            )
        except ProviderError as error:
            self._log(provider.name, error.reason, error.status, started)
            return Response({"detail": UPSTREAM_ERROR_DETAIL}, status=status.HTTP_502_BAD_GATEWAY)

        self._log(provider.name, "ok", 200, started)
        return Response({"reply": reply, "remaining_today": remaining_today})

    @staticmethod
    def _log(provider, result, upstream_status, started):
        latency_ms = int((time.monotonic() - started) * 1000)
        log = logger.info if result == "ok" else logger.warning
        log(
            "chat_completion provider=%s result=%s status=%s latency_ms=%d",
            provider,
            result,
            upstream_status if upstream_status is not None else "-",
            latency_ms,
        )
