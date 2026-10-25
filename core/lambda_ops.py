"""Lambda の直接呼び出し（lambda:InvokeFunction）で実行する管理操作。

API Gateway 経由のイベントは最上位に "manage" キーを持たないため、
{"manage": "<操作名>"} 形式のイベントは IAM で直接呼び出しを許可された運用者からのものに限られる。
実行できる操作は下記の許可リストのものだけに限定する。

関数ごとに実行できる操作を分ける。
- 管理専用の関数（環境変数 MANAGE_ONLY=1、テーブルの所有者ロールで接続）:
  migrate / seed / check / grant_runtime
- Web リクエストを処理する関数（DML のみの実行時ロールで接続）: check のみ
"""

import logging
import os
import re
from io import StringIO

from django.core.management import call_command
from django.db import connection, connections

logger = logging.getLogger(__name__)

# 応答に含める出力の最大文字数（Lambda の応答サイズを抑えるため末尾のみ返す）
MAX_OUTPUT_CHARS = 4000

# データベースのロール名・スキーマ名として受け付ける形式（SQL に埋め込むため英小文字・数字・_ のみ）
_IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")

# 実行時ロールに付与するテーブル・シーケンスの権限（DML に必要なもののみ）
RUNTIME_TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE"
RUNTIME_SEQUENCE_PRIVILEGES = "USAGE, SELECT"


def is_manage_only(environ=None):
    """管理操作専用の関数として動作しているかどうか（環境変数 MANAGE_ONLY=1）。"""
    environ = os.environ if environ is None else environ
    return environ.get("MANAGE_ONLY", "").strip() == "1"


def _validated_identifier(value, label):
    if not _IDENTIFIER_RE.match(value):
        raise ValueError(f"{label} は英小文字・数字・_ で指定してください")
    return value


def _runtime_role():
    """権限を付与する実行時ロール名（環境変数 DSQL_RUNTIME_DB_USER、未設定なら空文字）。"""
    return os.environ.get("DSQL_RUNTIME_DB_USER", "").strip()


def runtime_grant_statements(role, schema):
    """実行時ロールに DML の権限を付与する SQL を返す（1 文ずつ別のトランザクションで実行する）。

    - 既存のテーブル・シーケンス（IDENTITY 列のシーケンスを含む）への権限
    - 以降に所有者ロールが作成するテーブル・シーケンスへの既定の権限
    同じ権限の再付与は状態を変えないため、何度実行しても結果は同じになる。
    """
    role = connection.ops.quote_name(_validated_identifier(role, "DSQL_RUNTIME_DB_USER"))
    schema = connection.ops.quote_name(_validated_identifier(schema, "DSQL_SCHEMA"))
    return [
        f"GRANT {RUNTIME_TABLE_PRIVILEGES} ON ALL TABLES IN SCHEMA {schema} TO {role}",
        f"GRANT {RUNTIME_SEQUENCE_PRIVILEGES} ON ALL SEQUENCES IN SCHEMA {schema} TO {role}",
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} "
        f"GRANT {RUNTIME_TABLE_PRIVILEGES} ON TABLES TO {role}",
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} "
        f"GRANT {RUNTIME_SEQUENCE_PRIVILEGES} ON SEQUENCES TO {role}",
    ]


def _grant_runtime(out):
    role = _runtime_role()
    if not role:
        raise ValueError("DSQL_RUNTIME_DB_USER（権限を付与する実行時ロール）を設定してください")
    if connection.vendor != "dsql":
        raise RuntimeError("grant_runtime は Aurora DSQL への接続時に実行します")
    if role == connection.settings_dict.get("USER", ""):
        raise ValueError("実行時ロールには接続中の所有者ロールとは別のロールを指定してください")

    schema = os.environ.get("DSQL_SCHEMA", "").strip() or "app"
    statements = runtime_grant_statements(role, schema)
    # 自動コミットのまま 1 文ずつ実行し、1 トランザクションに 1 文ずつとする
    for statement in statements:
        with connection.cursor() as cursor:
            cursor.execute(statement)
        out.write(f"{statement}\n")
    return {"role": role, "schema": schema, "statements": len(statements)}


def _migrate(out):
    # auth / contenttypes はマイグレーション履歴を持たないため --run-syncdb でテーブルを作成する
    call_command("migrate", run_syncdb=True, interactive=False, stdout=out, stderr=out)
    # 実行時ロールが設定されていれば、作成したテーブルへの権限を続けて付与する
    if _runtime_role():
        return {"grant_runtime": _grant_runtime(out)}
    return None


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
    "grant_runtime": _grant_runtime,
}

# Web リクエストを処理する関数（実行時ロール）で実行できる操作（読み取りのみ）
RUNTIME_OPERATIONS = frozenset({"check"})


def allowed_operations(environ=None):
    """この関数で実行できる操作名の一覧（昇順）。"""
    if is_manage_only(environ):
        return sorted(OPERATIONS)
    return sorted(RUNTIME_OPERATIONS)


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
    allowed = allowed_operations()
    operation = OPERATIONS.get(name) if isinstance(name, str) and name in allowed else None
    if operation is None:
        return {
            "status": "rejected",
            "error": "この関数で実行できる操作を指定してください",
            "allowed": allowed,
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
