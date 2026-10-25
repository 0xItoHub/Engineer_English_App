"""CSP（Content Security Policy）の違反レポートの受け付け（POST /api/csp-report/）。

ブラウザが送信する違反レポートを受け取り、要点だけを 1 行のログ（WARNING）に記録する。
- 対応する形式: application/csp-report（report-uri）、application/reports+json（Reporting API）、
  application/json
- 本文は 8 KB まで（超える場合は解析せずに 413）。データベースには保存しない
- ログには、ディレクティブ・ブロックされたリソースのオリジン（またはスキーム）・ページのパス・
  処理の種類（enforce / report）のみを残し、クエリ文字列や本文全体は記録しない
"""

import json
import logging
import re
from urllib.parse import urlsplit

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .throttles import CspReportRateThrottle

logger = logging.getLogger("core.csp_report")

# 受け付ける本文の上限（バイト）
MAX_BODY_BYTES = 8 * 1024
# 1 リクエストで記録するレポートの上限（Reporting API は配列でまとめて送信される）
MAX_REPORTS_PER_REQUEST = 5
# ログに残すパスの最大長
MAX_PATH_LENGTH = 128

SUPPORTED_CONTENT_TYPES = {
    "application/csp-report",
    "application/reports+json",
    "application/json",
}

# blocked-uri としてブラウザが送るキーワード（URL ではない値）
BLOCKED_KEYWORDS = {
    "inline",
    "eval",
    "wasm-eval",
    "self",
    "trusted-types-policy",
    "trusted-types-sink",
}

_DIRECTIVE_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.-]{0,19}$")
_HOST_RE = re.compile(r"^[a-z0-9.-]{1,253}$")
_PATH_UNSAFE_RE = re.compile(r"[^A-Za-z0-9/._~%-]")
_NETWORK_SCHEMES = {"http", "https", "ws", "wss"}


def _directive(value):
    """ディレクティブ名（例: script-src-elem）。CSP2 形式の「名前 + 値」は名前のみを使う。"""
    if not isinstance(value, str) or not value.strip():
        return "-"
    name = value.strip().split()[0].lower()
    return name if _DIRECTIVE_RE.match(name) else "-"


def _blocked(value):
    """ブロックされたリソースを、オリジン（http/https/ws/wss）またはスキームのみに縮める。"""
    if not isinstance(value, str) or not value.strip():
        return "-"
    value = value.strip()
    if value.lower() in BLOCKED_KEYWORDS:
        return value.lower()
    try:
        parts = urlsplit(value)
        scheme = parts.scheme.lower()
        if not _SCHEME_RE.match(scheme):
            return "-"
        if scheme not in _NETWORK_SCHEMES:
            # data: / blob: などは中身を残さず、スキームのみを記録する
            return f"{scheme}:"
        host = (parts.hostname or "").lower()
        port = parts.port
    except ValueError:
        return "-"
    if not _HOST_RE.match(host):
        return f"{scheme}:"
    return f"{scheme}://{host}:{port}" if port else f"{scheme}://{host}"


def _document_path(value):
    """違反が発生したページのパス（クエリ文字列・フラグメントは含めない）。"""
    if not isinstance(value, str) or not value.strip():
        return "-"
    try:
        path = urlsplit(value.strip()).path
    except ValueError:
        return "-"
    path = _PATH_UNSAFE_RE.sub("", path)[:MAX_PATH_LENGTH]
    return path or "/"


def _disposition(value):
    return value if value in ("enforce", "report") else "-"


def _extract_reports(payload):
    """レポートの形式（report-uri / Reporting API）に応じて、記録する項目を取り出す。"""
    if isinstance(payload, dict) and isinstance(payload.get("csp-report"), dict):
        report = payload["csp-report"]
        return [
            {
                "directive": report.get("effective-directive") or report.get("violated-directive"),
                "blocked": report.get("blocked-uri"),
                "document": report.get("document-uri"),
                "disposition": report.get("disposition"),
            }
        ]
    if isinstance(payload, list):
        reports = []
        for item in payload:
            if len(reports) >= MAX_REPORTS_PER_REQUEST:
                break
            if not isinstance(item, dict) or item.get("type") != "csp-violation":
                continue
            body = item.get("body")
            if not isinstance(body, dict):
                continue
            reports.append(
                {
                    "directive": body.get("effectiveDirective"),
                    "blocked": body.get("blockedURL"),
                    "document": body.get("documentURL") or item.get("url"),
                    "disposition": body.get("disposition"),
                }
            )
        return reports
    return []


class CspReportView(APIView):
    """CSP の違反レポートを受け取り、要点をログに記録する（ログイン不要）。"""

    # ブラウザが自動送信するため認証は行わず、IP 単位の専用レート制限のみを適用する
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CspReportRateThrottle]

    def post(self, request):
        content_type = (request.META.get("CONTENT_TYPE") or "").split(";")[0].strip().lower()
        if content_type not in SUPPORTED_CONTENT_TYPES:
            return Response(status=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)

        # 本文を読み込む前に、Content-Length で大きさを確認する
        try:
            content_length = int(request.META.get("CONTENT_LENGTH") or 0)
        except ValueError:
            return Response(status=status.HTTP_400_BAD_REQUEST)
        if content_length > MAX_BODY_BYTES:
            return Response(status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

        body = request.body
        if len(body) > MAX_BODY_BYTES:
            return Response(status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, ValueError, RecursionError):
            return Response(status=status.HTTP_400_BAD_REQUEST)

        for report in _extract_reports(payload):
            logger.warning(
                "csp_violation directive=%s blocked=%s document=%s disposition=%s",
                _directive(report["directive"]),
                _blocked(report["blocked"]),
                _document_path(report["document"]),
                _disposition(report["disposition"]),
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
