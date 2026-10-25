import os
import shutil
from pathlib import Path

SEED = Path("/var/task/seed_db.sqlite3")
TMP = Path(os.getenv("SQLITE_PATH", "/tmp/db.sqlite3"))

# Aurora DSQL に接続する場合はイメージ内の SQLite を使わないため、コピーしない
USE_DSQL = bool(os.getenv("DSQL_CLUSTER_ENDPOINT", "").strip())

if (
    not USE_DSQL
    and os.getenv("STARTUP_COPY_SEED_DB", "1") == "1"
    and SEED.exists()
    and not TMP.exists()
):
    TMP.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(SEED, TMP)

# シードDBのコピー後に Django を読み込むため、ここでインポートする
from mangum import Mangum  # noqa: E402

from core.lambda_ops import is_manage_event, is_manage_only, run_manage_event  # noqa: E402
from engineer_english.asgi import application  # noqa: E402

# Django の ASGI アプリは lifespan プロトコルを使わないため無効にする
asgi_handler = Mangum(application, lifespan="off")


def handler(event, context):
    # 直接呼び出しの管理操作（{"manage": "migrate"} など）は許可リストの操作のみ実行する
    if is_manage_event(event):
        return run_manage_event(event)
    # 管理専用の関数（MANAGE_ONLY=1）は HTTP のリクエストを処理せず、管理操作のみ受け付ける
    if is_manage_only():
        return {"status": "rejected", "error": 'この関数は管理操作（{"manage": ...}）専用です'}
    return asgi_handler(event, context)
