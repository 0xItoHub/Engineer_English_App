"""テスト実行用の設定（pytest から読み込む）。"""

import os

# テスト専用のダミー値（本番では使用しない）。base 設定の読み込み前に指定する。
os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-not-secret")
os.environ.pop("DJANGO_SECRET_KEY_SSM_PARAM", None)
# 経路の確認（core.middleware）はテストごとに設定を上書きして確認する
os.environ.pop("ORIGIN_VERIFY_SECRET", None)
# テストが不安定にならないよう、レート制限の上限を十分に大きくする
os.environ.setdefault("DJANGO_THROTTLE_ANON", "100000/min")
os.environ.setdefault("DJANGO_THROTTLE_USER", "100000/min")
os.environ.setdefault("DJANGO_THROTTLE_COMPLETE_LESSON", "100000/min")
os.environ.setdefault("DJANGO_THROTTLE_CSP_REPORT", "100000/min")

from .settings import *  # noqa: E402, F403

# テストを高速化するため軽量なハッシュ方式を使う
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
