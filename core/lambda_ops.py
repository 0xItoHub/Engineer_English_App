"""Lambda の直接呼び出し（lambda:InvokeFunction）で実行する管理操作。

API Gateway 経由のイベントは最上位に "manage" キーを持たないため、
{"manage": "<操作名>"} 形式のイベントは IAM で直接呼び出しを許可された運用者からのものに限られる。
実行できる操作は下記の許可リストのものだけに限定する。
"""

import logging
from io import StringIO

from django.core.management import call_command
from django.db import connections

logger = logging.getLogger(__name__)

# 応答に含める出力の最大文字数（Lambda の応答サイズを抑えるため末尾のみ返す）
MAX_OUTPUT_CHARS = 4000


def _migrate(out):
    # auth / contenttypes はマイグレーション履歴を持たないため --run-syncdb でテーブルを作成する
    call_command("migrate", run_syncdb=True, interactive=False, stdout=out, stderr=out)


def _seed(out):
    call_command("seed_six_scenes", stdout=out, stderr=out)


def _check(out):
    from .models import Dialogue, Lesson, Phrase, Scene, UserProgress

    return {
        "scenes": Scene.objects.count(),
        "lessons": Lesson.objects.count(),
        "phrases": Phrase.objects.count(),
        "dialogues": Dialogue.objects.count(),
        "progress": UserProgress.objects.count(),
    }


OPERATIONS = {
    "migrate": _migrate,
    "seed": _seed,
    "check": _check,
}


def _truncate(text):
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    return "...(省略)...\n" + text[-MAX_OUTPUT_CHARS:]


def is_manage_event(event):
    """管理操作の呼び出しイベントかどうかを判定する。"""
    return isinstance(event, dict) and "manage" in event


def run_manage_event(event):
    """管理操作を実行し、JSON に変換できる結果を返す。"""
    name = event.get("manage")
    operation = OPERATIONS.get(name) if isinstance(name, str) else None
    if operation is None:
        return {
            "status": "rejected",
            "error": "未対応の操作です",
            "allowed": sorted(OPERATIONS),
        }

    out = StringIO()
    try:
        result = operation(out)
    except Exception as error:
        connections.close_all()
        logger.exception("管理操作 %s が失敗しました", name)
        return {
            "status": "error",
            "operation": name,
            "error": f"{type(error).__name__}: {error}"[:MAX_OUTPUT_CHARS],
            "output": _truncate(out.getvalue()),
        }

    # リクエスト処理の外で開いた接続は自動で閉じられないため、操作ごとに閉じる
    connections.close_all()
    response = {"status": "ok", "operation": name, "output": _truncate(out.getvalue())}
    if result is not None:
        response["result"] = result
    return response
