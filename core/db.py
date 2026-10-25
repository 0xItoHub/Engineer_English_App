"""データベース操作の補助関数。"""

import logging
import random
import time

from django.db import DatabaseError, IntegrityError, transaction

logger = logging.getLogger(__name__)

# 再試行で解消できる競合の SQLSTATE。
# 40001: serialization_failure / OC000・OC001: Aurora DSQL の楽観的同時実行制御（OCC）の競合
RETRYABLE_SQLSTATES = frozenset({"40001", "OC000", "OC001"})


class RetryExhausted(Exception):
    """再試行しても競合が解消しなかったことを表す。"""


def _sqlstate(error):
    """例外（Django がラップしたものを含む）から SQLSTATE を取り出す。"""
    while error is not None:
        code = getattr(error, "sqlstate", None) or getattr(error, "pgcode", None)
        if code:
            return code
        error = error.__cause__
    return None


def is_retryable_error(error):
    """同じトランザクションをやり直せば成功しうる競合かどうかを判定する。"""
    if _sqlstate(error) in RETRYABLE_SQLSTATES:
        return True
    # 同じ行の同時作成（get_or_create の競合）は、やり直すと既存行の更新として成功する
    return isinstance(error, IntegrityError)


def run_in_transaction_with_retry(func, *, attempts=3, base_delay=0.02, using=None):
    """func をトランザクション内で実行し、競合時はトランザクションごと再試行する。

    Aurora DSQL は楽観的同時実行制御のため、同時更新はコミット時に失敗することがある。
    その場合は短い待機（指数バックオフ＋ゆらぎ）の後、トランザクション全体をやり直す。
    すべて失敗した場合は RetryExhausted を送出する。
    """
    for attempt in range(1, attempts + 1):
        try:
            with transaction.atomic(using=using):
                return func()
        except DatabaseError as error:
            if not is_retryable_error(error):
                raise
            if attempt == attempts:
                logger.warning("トランザクションの競合が %d 回続いたため中断します", attempts)
                raise RetryExhausted from error
            delay = base_delay * (2 ** (attempt - 1))
            time.sleep(delay + random.uniform(0, delay))
    raise AssertionError("unreachable")  # pragma: no cover
