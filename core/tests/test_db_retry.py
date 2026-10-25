from unittest import mock

import pytest
from django.db import DatabaseError, IntegrityError, OperationalError

from core import db as core_db
from core.db import RetryExhausted, is_retryable_error, run_in_transaction_with_retry
from core.models import Scene

pytestmark = pytest.mark.django_db


class _DriverError(Exception):
    """psycopg の例外を模したもの（sqlstate を持つ）。"""

    def __init__(self, sqlstate):
        super().__init__(sqlstate)
        self.sqlstate = sqlstate


def _wrapped(sqlstate, cls=OperationalError):
    """Django がドライバの例外をラップした状態を再現する。"""
    error = cls("conflict")
    error.__cause__ = _DriverError(sqlstate)
    return error


@pytest.fixture(autouse=True)
def no_sleep():
    with mock.patch.object(core_db.time, "sleep") as sleep:
        yield sleep


@pytest.mark.parametrize("sqlstate", ["40001", "OC000", "OC001"])
def test_conflict_errors_are_retryable(sqlstate):
    assert is_retryable_error(_wrapped(sqlstate))


def test_integrity_error_is_retryable():
    assert is_retryable_error(IntegrityError("duplicate"))


def test_other_errors_are_not_retryable():
    assert not is_retryable_error(_wrapped("42P01"))
    assert not is_retryable_error(OperationalError("no sqlstate"))


def test_pgcode_is_also_detected():
    cause = Exception()
    cause.pgcode = "OC000"
    error = OperationalError("conflict")
    error.__cause__ = cause

    assert is_retryable_error(error)


def test_returns_result_without_retry(no_sleep):
    func = mock.Mock(return_value="done")

    assert run_in_transaction_with_retry(func) == "done"
    assert func.call_count == 1
    no_sleep.assert_not_called()


def test_retries_until_success(no_sleep):
    func = mock.Mock(side_effect=[_wrapped("OC000"), _wrapped("40001"), "done"])

    assert run_in_transaction_with_retry(func) == "done"
    assert func.call_count == 3
    # 待機時間は指数的に伸びる（ゆらぎは基準値の 0〜1 倍）
    first, second = (c.args[0] for c in no_sleep.call_args_list)
    assert 0.02 <= first <= 0.04
    assert 0.04 <= second <= 0.08


def test_raises_retry_exhausted_after_attempts():
    func = mock.Mock(side_effect=_wrapped("OC001"))

    with pytest.raises(RetryExhausted):
        run_in_transaction_with_retry(func, attempts=3)
    assert func.call_count == 3


def test_non_retryable_error_is_raised_immediately():
    func = mock.Mock(side_effect=_wrapped("42P01"))

    with pytest.raises(DatabaseError):
        run_in_transaction_with_retry(func)
    assert func.call_count == 1


def test_failed_attempt_is_rolled_back():
    calls = []

    def func():
        Scene.objects.create(title=f"try {len(calls)}")
        calls.append(1)
        if len(calls) == 1:
            raise _wrapped("OC000")
        return Scene.objects.count()

    # 1 回目の書き込みは取り消され、2 回目の分だけが残る
    assert run_in_transaction_with_retry(func) == 1
    assert list(Scene.objects.values_list("title", flat=True)) == ["try 1"]
