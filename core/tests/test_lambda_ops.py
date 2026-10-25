import importlib
from unittest import mock

import pytest

from core import lambda_ops
from core.lambda_ops import (
    allowed_operations,
    is_manage_event,
    is_manage_only,
    run_manage_event,
    runtime_grant_statements,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def manage_only(monkeypatch):
    """管理専用の関数（所有者ロール）として動作させる。"""
    monkeypatch.setenv("MANAGE_ONLY", "1")
    monkeypatch.delenv("DSQL_RUNTIME_DB_USER", raising=False)


@pytest.fixture
def web_function(monkeypatch):
    """Web リクエストを処理する関数（実行時ロール）として動作させる。"""
    monkeypatch.delenv("MANAGE_ONLY", raising=False)


@pytest.fixture
def dsql_connection():
    """grant_runtime が Aurora DSQL に接続しているものとして SQL の実行を記録する。"""
    cursor = mock.MagicMock()
    with (
        mock.patch.object(type(lambda_ops.connection), "vendor", "dsql", create=True),
        mock.patch.object(lambda_ops.connection, "cursor") as make_cursor,
    ):
        make_cursor.return_value.__enter__.return_value = cursor
        yield cursor


def _executed(cursor):
    return [call.args[0] for call in cursor.execute.call_args_list]


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


@pytest.mark.parametrize(
    ("environ", "expected"),
    [({"MANAGE_ONLY": "1"}, True), ({"MANAGE_ONLY": " 1 "}, True), ({"MANAGE_ONLY": "0"}, False)],
)
def test_is_manage_only(environ, expected):
    assert is_manage_only(environ) is expected
    assert is_manage_only({}) is False


def test_allowed_operations_by_function():
    assert allowed_operations({"MANAGE_ONLY": "1"}) == ["check", "grant_runtime", "migrate", "seed"]
    assert allowed_operations({}) == ["check"]


@pytest.mark.parametrize("name", ["shell", "flush", "dbshell", "", None, 1, ["migrate"]])
def test_unknown_operation_is_rejected(manage_only, name):
    with mock.patch.object(lambda_ops, "call_command") as call_command:
        result = run_manage_event({"manage": name})

    assert result["status"] == "rejected"
    assert result["allowed"] == ["check", "grant_runtime", "migrate", "seed"]
    call_command.assert_not_called()


@pytest.mark.parametrize("name", ["migrate", "seed", "grant_runtime"])
def test_web_function_allows_only_check(web_function, name):
    with mock.patch.object(lambda_ops, "call_command") as call_command:
        result = run_manage_event({"manage": name})

    assert result["status"] == "rejected"
    assert result["allowed"] == ["check"]
    call_command.assert_not_called()


def test_web_function_runs_check(web_function):
    result = run_manage_event({"manage": "check"})
    assert result["status"] == "ok"
    assert result["result"]["scenes"] == 0


def test_migrate_runs_with_syncdb(manage_only):
    with mock.patch.object(lambda_ops, "call_command") as call_command:
        result = run_manage_event({"manage": "migrate"})

    assert result["status"] == "ok"
    assert result["operation"] == "migrate"
    assert "result" not in result
    args, kwargs = call_command.call_args
    assert args == ("migrate",)
    assert kwargs["run_syncdb"] is True
    assert kwargs["interactive"] is False


def test_migrate_grants_runtime_role_when_configured(manage_only, monkeypatch, dsql_connection):
    monkeypatch.setenv("DSQL_RUNTIME_DB_USER", "app_rw")
    with mock.patch.object(lambda_ops, "call_command") as call_command:
        result = run_manage_event({"manage": "migrate"})

    assert result["status"] == "ok"
    call_command.assert_called_once()
    assert result["result"]["grant_runtime"]["role"] == "app_rw"
    assert len(_executed(dsql_connection)) == 4


def test_seed_then_check_returns_counts(manage_only):
    result = run_manage_event({"manage": "seed"})
    assert result["status"] == "ok"
    assert "Scene-specific seed done" in result["output"]

    result = run_manage_event({"manage": "check"})
    assert result["status"] == "ok"
    assert result["result"]["scenes"] == 6
    assert result["result"]["lessons"] == 30
    assert result["result"]["progress"] == 0


def test_runtime_grant_statements_cover_tables_sequences_and_defaults():
    statements = runtime_grant_statements("app_rw", "app")

    assert statements == [
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "app" TO "app_rw"',
        'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "app" TO "app_rw"',
        'ALTER DEFAULT PRIVILEGES IN SCHEMA "app" '
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app_rw"',
        'ALTER DEFAULT PRIVILEGES IN SCHEMA "app" GRANT USAGE, SELECT ON SEQUENCES TO "app_rw"',
    ]
    # DDL に関わる権限は付与しない
    assert not any(word in " ".join(statements) for word in ("CREATE", "TRUNCATE", "ALL PRIV"))


@pytest.mark.parametrize(
    ("role", "schema"),
    [("app_rw; DROP TABLE x", "app"), ("APP", "app"), ("app_rw", 'app"'), ("", "app")],
)
def test_runtime_grant_statements_reject_invalid_identifiers(role, schema):
    with pytest.raises(ValueError):
        runtime_grant_statements(role, schema)


def test_grant_runtime_executes_each_statement(manage_only, monkeypatch, dsql_connection):
    monkeypatch.setenv("DSQL_RUNTIME_DB_USER", "app_rw")
    monkeypatch.setenv("DSQL_SCHEMA", "app")

    result = run_manage_event({"manage": "grant_runtime"})

    assert result["status"] == "ok"
    assert result["result"] == {"role": "app_rw", "schema": "app", "statements": 4}
    assert _executed(dsql_connection) == runtime_grant_statements("app_rw", "app")
    assert result["output"].count("\n") == 4


def test_grant_runtime_is_idempotent(manage_only, monkeypatch, dsql_connection):
    monkeypatch.setenv("DSQL_RUNTIME_DB_USER", "app_rw")

    first = run_manage_event({"manage": "grant_runtime"})
    second = run_manage_event({"manage": "grant_runtime"})

    assert first["status"] == second["status"] == "ok"
    executed = _executed(dsql_connection)
    assert executed[:4] == executed[4:]


def test_grant_runtime_requires_runtime_role(manage_only, dsql_connection):
    result = run_manage_event({"manage": "grant_runtime"})

    assert result["status"] == "error"
    assert "DSQL_RUNTIME_DB_USER" in result["error"]
    dsql_connection.execute.assert_not_called()


def test_grant_runtime_requires_dsql(manage_only, monkeypatch):
    monkeypatch.setenv("DSQL_RUNTIME_DB_USER", "app_rw")

    result = run_manage_event({"manage": "grant_runtime"})

    assert result["status"] == "error"
    assert "Aurora DSQL" in result["error"]


def test_grant_runtime_rejects_owner_as_runtime_role(manage_only, monkeypatch, dsql_connection):
    monkeypatch.setenv("DSQL_RUNTIME_DB_USER", "app")
    monkeypatch.setitem(lambda_ops.connection.settings_dict, "USER", "app")

    result = run_manage_event({"manage": "grant_runtime"})

    assert result["status"] == "error"
    dsql_connection.execute.assert_not_called()


def test_failure_returns_error_without_raising(manage_only):
    with mock.patch.object(lambda_ops, "call_command", side_effect=RuntimeError("boom")):
        result = run_manage_event({"manage": "seed"})

    assert result["status"] == "error"
    assert result["error"] == "RuntimeError: boom"


def test_long_output_is_truncated(manage_only):
    def noisy(*args, stdout, **kwargs):
        stdout.write("x" * (lambda_ops.MAX_OUTPUT_CHARS + 100))

    with mock.patch.object(lambda_ops, "call_command", side_effect=noisy):
        result = run_manage_event({"manage": "seed"})

    assert result["output"].startswith("...(省略)...")
    assert len(result["output"]) < lambda_ops.MAX_OUTPUT_CHARS + 20


def test_lambda_handler_routes_events(web_function):
    # lambda は予約語のため importlib で読み込む
    module = importlib.import_module("lambda")

    with mock.patch.object(module, "asgi_handler", return_value={"statusCode": 200}) as asgi:
        assert module.handler({"manage": "unknown"}, None)["status"] == "rejected"
        asgi.assert_not_called()

        event = {"version": "2.0", "rawPath": "/api/scenes/"}
        assert module.handler(event, None) == {"statusCode": 200}
        asgi.assert_called_once_with(event, None)


def test_manage_only_handler_rejects_http_events(manage_only):
    module = importlib.import_module("lambda")

    with mock.patch.object(module, "asgi_handler") as asgi:
        event = {"version": "2.0", "rawPath": "/api/scenes/"}
        result = module.handler(event, None)

        assert result["status"] == "rejected"
        asgi.assert_not_called()

        assert module.handler({"manage": "check"}, None)["status"] == "ok"
