"""AI チャットの日ごとの利用回数の上限（ユーザー単位・全体）。

接続先を呼び出す前に 1 回分を確保（回数を加算）する。接続先の失敗時も回数は戻さない
（費用の上限を確実に守るため）。日付は日本時間で区切る。
"""

import datetime
from zoneinfo import ZoneInfo

from ..db import run_in_transaction_with_retry
from ..models import ChatUsage

TOKYO = ZoneInfo("Asia/Tokyo")


class DailyLimitExceeded(Exception):
    """日ごとの上限に達したことを表す（scope: "user" または "global"）。"""

    def __init__(self, scope):
        super().__init__(scope)
        self.scope = scope


def today_tokyo(now=None):
    now = now or datetime.datetime.now(datetime.UTC)
    return now.astimezone(TOKYO).date()


def _increment(user_sub, date):
    """利用回数に 1 を加算して新しい回数を返す（run_in_transaction_with_retry の中で呼び出す）。

    Aurora DSQL はセーブポイントに対応しないため、検索と作成を分けて行う。
    同時に作成された場合は一意制約の競合となり、トランザクションごとやり直す。
    """
    usage = ChatUsage.objects.filter(user_sub=user_sub, date=date).first()
    if usage is None:
        ChatUsage.objects.create(user_sub=user_sub, date=date, count=1)
        return 1
    usage.count += 1
    usage.save(update_fields=["count"])
    return usage.count


def _used(user_sub, date):
    usage = ChatUsage.objects.filter(user_sub=user_sub, date=date).first()
    return usage.count if usage else 0


def reserve(user_sub, config, *, date=None):
    """1 回分の利用を確保し、そのユーザーの本日の残り回数を返す。

    上限に達している場合は DailyLimitExceeded を送出する（回数は加算しない）。
    競合が続いた場合は core.db.RetryExhausted を送出する。
    """
    date = date or today_tokyo()

    def _reserve():
        if _used(user_sub, date) >= config.user_daily_limit:
            raise DailyLimitExceeded("user")
        if _used(ChatUsage.GLOBAL_SUB, date) >= config.global_daily_limit:
            raise DailyLimitExceeded("global")
        count = _increment(user_sub, date)
        _increment(ChatUsage.GLOBAL_SUB, date)
        return max(0, config.user_daily_limit - count)

    return run_in_transaction_with_retry(_reserve)


def remaining(user_sub, config, *, date=None):
    """そのユーザーの本日の残り回数。"""
    date = date or today_tokyo()
    return max(0, config.user_daily_limit - _used(user_sub, date))
