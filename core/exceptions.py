"""API のエラー応答を `{"detail": ...}` 形式の JSON にそろえる。

- DRF の例外（APIException）は DRF の既定の処理に任せ、本文を `{"detail": ...}` 形式にする
- データベースに接続できない・接続が切れた場合は 503 を返す
- それ以外の想定外の例外は 500 を返す（詳細は応答に含めずログに記録する）
- DRF を通らないパス（未定義の URL など）の 404 / 500 も同じ形式で返す
"""

import logging

from django.db import DatabaseError, InterfaceError, OperationalError
from django.http import Http404, JsonResponse
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler
from rest_framework.views import set_rollback

logger = logging.getLogger(__name__)

DB_UNAVAILABLE_DETAIL = "データベースに一時的に接続できません。しばらくしてから再度お試しください。"
SERVER_ERROR_DETAIL = "サーバーでエラーが発生しました。しばらくしてから再度お試しください。"
VALIDATION_ERROR_DETAIL = "入力内容に誤りがあります。"
NOT_FOUND_DETAIL = "お探しのページが見つかりませんでした。"
BAD_REQUEST_DETAIL = "リクエストを処理できませんでした。"
PERMISSION_DENIED_DETAIL = "この操作を行う権限がありません。"


def is_db_unavailable_error(exc):
    """データベースへの接続・通信の失敗かどうかを判定する。

    接続できない・接続が切れた（OperationalError / InterfaceError）と、
    種類を特定できないデータベースエラー（DatabaseError そのもの）を対象とする。
    一意制約の違反や SQL の誤りなど、再接続で解消しないエラー（IntegrityError など）は含めない。
    """
    return isinstance(exc, OperationalError | InterfaceError) or type(exc) is DatabaseError


def _request_summary(context):
    # ログにはメソッドとパスのみを記録する（クエリ文字列・本文・ヘッダーは含めない）
    request = context.get("request")
    if request is None:
        return "-"
    return f"{request.method} {request.path}"


def _detail_body(data):
    """DRF の応答本文を `{"detail": ...}` 形式にする（入力エラーの内訳は errors に入れる）。"""
    if isinstance(data, dict) and "detail" in data:
        return data
    return {"detail": VALIDATION_ERROR_DETAIL, "errors": data}


def api_exception_handler(exc, context):
    """DRF の EXCEPTION_HANDLER。"""
    if isinstance(exc, Http404):
        # 内部のモデル名を含む Django の英語のメッセージではなく、DRF の既定のメッセージを返す
        exc = exceptions.NotFound()
    response = drf_exception_handler(exc, context)
    if response is not None:
        response.data = _detail_body(response.data)
        return response

    # 以降は DRF が扱わない例外。途中までの書き込みは取り消す
    set_rollback()
    if is_db_unavailable_error(exc):
        logger.error(
            "データベースに接続できませんでした (%s)", _request_summary(context), exc_info=exc
        )
        return Response(
            {"detail": DB_UNAVAILABLE_DETAIL}, status=status.HTTP_503_SERVICE_UNAVAILABLE
        )

    logger.error(
        "リクエストの処理中に想定外のエラーが発生しました (%s)",
        _request_summary(context),
        exc_info=exc,
    )
    return Response({"detail": SERVER_ERROR_DETAIL}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def json_error(detail, status_code):
    """`{"detail": ...}` 形式のエラー応答（DRF の応答と同じく日本語をそのまま出力する）。"""
    return JsonResponse(
        {"detail": detail}, status=status_code, json_dumps_params={"ensure_ascii": False}
    )


# --- DRF を通らないパスのエラー応答（engineer_english/urls.py の handler404 など） ----------


def bad_request(request, exception):
    return json_error(BAD_REQUEST_DETAIL, 400)


def permission_denied(request, exception):
    return json_error(PERMISSION_DENIED_DETAIL, 403)


def page_not_found(request, exception):
    return json_error(NOT_FOUND_DETAIL, 404)


def server_error(request):
    # 例外の内容は Django のログ（django.request）に記録される
    return json_error(SERVER_ERROR_DETAIL, 500)
