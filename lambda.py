import os
import shutil
from pathlib import Path

SEED = Path("/var/task/seed_db.sqlite3")
TMP = Path(os.getenv("SQLITE_PATH", "/tmp/db.sqlite3"))

if os.getenv("STARTUP_COPY_SEED_DB", "1") == "1" and SEED.exists() and not TMP.exists():
    TMP.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(SEED, TMP)

# シードDBのコピー後に Django を読み込むため、ここでインポートする
from mangum import Mangum  # noqa: E402

from engineer_english.asgi import application  # noqa: E402

# Django の ASGI アプリは lifespan プロトコルを使わないため無効にする
handler = Mangum(application, lifespan="off")
