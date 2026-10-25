"""AI チャットの API キーの取得（SSM Parameter Store の SecureString）。

- 最初に必要になったときに 1 回だけ取得し、コンテナ（Lambda の実行環境）の存続中は再利用する
- キーの値はログ・例外のメッセージ・応答に含めない
"""

import logging
import threading

logger = logging.getLogger(__name__)

_cache = {}
_lock = threading.Lock()


class ApiKeyUnavailable(Exception):
    """API キーを取得できなかったことを表す（キーの値・取得時の詳細は含めない）。"""


def _fetch_parameter(name):
    import boto3

    ssm = boto3.client("ssm")
    return ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]


def get_api_key(param_name):
    """パラメータ名に対応する API キーを返す（取得済みならキャッシュを使う）。"""
    if not param_name:
        raise ApiKeyUnavailable("API キーのパラメータ名が設定されていません")
    cached = _cache.get(param_name)
    if cached:
        return cached
    with _lock:
        cached = _cache.get(param_name)
        if cached:
            return cached
        try:
            value = (_fetch_parameter(param_name) or "").strip()
        except Exception as error:
            # 例外の種類のみを記録する（パラメータの値は記録しない）
            logger.error("chat_api_key_unavailable error=%s", type(error).__name__)
            raise ApiKeyUnavailable("API キーを取得できませんでした") from None
        if not value:
            logger.error("chat_api_key_unavailable error=EmptyValue")
            raise ApiKeyUnavailable("API キーが空です")
        _cache[param_name] = value
        return value


def clear_cache():
    """キャッシュを消去する（テスト・キーの更新時に使う）。"""
    with _lock:
        _cache.clear()
