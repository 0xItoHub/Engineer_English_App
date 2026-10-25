import importlib
from unittest import mock

import pytest

from core import lambda_ops
from core.lambda_ops import is_manage_event, run_manage_event

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    ("event", "expected"),
    [
        ({"manage": "migrate"}, True),
        ({"manage": None}, True),
        ({"version": "2.0", "rawPath": "/api/scenes/"}, False),
        ([], False),
        ("manage", False),
        (None, False),
    ],
)
def test_is_manage_event(event, expected):
    assert is_manage_event(event) is expected


@pytest.mark.parametrize("name", ["shell", "flush", "dbshell", "", None, 1, ["migrate"]])
def test_unknown_operation_is_rejected(name):
    with mock.patch.object(lambda_ops, "call_command") as call_command:
        result = run_manage_event({"manage": name})

    assert result["status"] == "rejected"
    assert result["allowed"] == ["check", "migrate", "seed"]
    call_command.assert_not_called()


def test_migrate_runs_with_syncdb():
    with mock.patch.object(lambda_ops, "call_command") as call_command:
        result = run_manage_event({"manage": "migrate"})

    assert result["status"] == "ok"
    assert result["operation"] == "migrate"
    args, kwargs = call_command.call_args
    assert args == ("migrate",)
    assert kwargs["run_syncdb"] is True
    assert kwargs["interactive"] is False


def test_seed_then_check_returns_counts():
    result = run_manage_event({"manage": "seed"})
    assert result["status"] == "ok"
    assert "Scene-specific seed done" in result["output"]

    result = run_manage_event({"manage": "check"})
    assert result["status"] == "ok"
    assert result["result"]["scenes"] == 6
    assert result["result"]["lessons"] == 30
    assert result["result"]["progress"] == 0


def test_failure_returns_error_without_raising():
    with mock.patch.object(lambda_ops, "call_command", side_effect=RuntimeError("boom")):
        result = run_manage_event({"manage": "seed"})

    assert result["status"] == "error"
    assert result["error"] == "RuntimeError: boom"


def test_long_output_is_truncated():
    def noisy(*args, stdout, **kwargs):
        stdout.write("x" * (lambda_ops.MAX_OUTPUT_CHARS + 100))

    with mock.patch.object(lambda_ops, "call_command", side_effect=noisy):
        result = run_manage_event({"manage": "seed"})

    assert result["output"].startswith("...(省略)...")
    assert len(result["output"]) < lambda_ops.MAX_OUTPUT_CHARS + 20


def test_lambda_handler_routes_events():
    # lambda は予約語のため importlib で読み込む
    module = importlib.import_module("lambda")

    with mock.patch.object(module, "asgi_handler", return_value={"statusCode": 200}) as asgi:
        assert module.handler({"manage": "unknown"}, None)["status"] == "rejected"
        asgi.assert_not_called()

        event = {"version": "2.0", "rawPath": "/api/scenes/"}
        assert module.handler(event, None) == {"statusCode": 200}
        asgi.assert_called_once_with(event, None)
