from unittest import mock

import pytest
from django.db import IntegrityError, OperationalError, connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from core import db as core_db
from core import views
from core.db import RetryExhausted
from core.models import UserProgress
from core.throttles import CompleteLessonRateThrottle

from .factories import (
    make_dialogue,
    make_lesson,
    make_phrase,
    make_progress,
    make_scene_with_content,
    make_user,
)

pytestmark = pytest.mark.django_db

COMPLETE_URL = "/api/progress/complete_lesson/"


@pytest.fixture
def content(lesson):
    phrase = make_phrase(lesson=lesson)
    dialogue = make_dialogue(lesson=lesson)
    return {"scene": lesson.scene, "lesson": lesson, "phrase": phrase, "dialogue": dialogue}


# --- 読み取り ---------------------------------------------------------------


@pytest.mark.parametrize("resource", ["scene", "lesson", "phrase", "dialogue"])
def test_list_and_detail_return_200(api_client, content, resource):
    obj = content[resource]
    base = f"/api/{resource}s/"

    res = api_client.get(base)
    assert res.status_code == 200
    assert isinstance(res.json(), list)
    assert [item["id"] for item in res.json()] == [obj.id]

    res = api_client.get(f"{base}{obj.id}/")
    assert res.status_code == 200
    assert res.json()["id"] == obj.id


def test_api_root_returns_200(api_client):
    assert api_client.get("/api/").status_code == 200


def test_lesson_detail_includes_children(api_client, content):
    res = api_client.get(f"/api/lessons/{content['lesson'].id}/")
    body = res.json()

    assert [p["id"] for p in body["lesson_phrases"]] == [content["phrase"].id]
    assert [d["id"] for d in body["lesson_dialogues"]] == [content["dialogue"].id]


def test_unknown_detail_returns_404(api_client, db):
    assert api_client.get("/api/scenes/9999/").status_code == 404
    assert api_client.get("/api/scenes/not-a-number/").status_code == 404


@pytest.mark.parametrize("resource", ["phrases", "dialogues"])
def test_filter_by_lesson_and_scene(api_client, resource):
    first = make_scene_with_content("First", lessons=2)
    make_scene_with_content("Second", lessons=1)
    lesson = first.lessons.first()

    by_scene = api_client.get(f"/api/{resource}/", {"scene": first.id}).json()
    assert len(by_scene) == 2

    by_lesson = api_client.get(f"/api/{resource}/", {"lesson": lesson.id}).json()
    assert len(by_lesson) == 1
    assert by_lesson[0]["lesson"] == lesson.id


@pytest.mark.parametrize("resource", ["phrases", "dialogues"])
@pytest.mark.parametrize("value", ["abc", "-1", "0", "99999999999999999999"])
def test_invalid_filter_returns_400(api_client, db, resource, value):
    res = api_client.get(f"/api/{resource}/", {"lesson": value})
    assert res.status_code == 400


def test_scene_list_query_count_does_not_grow(api_client, django_assert_max_num_queries):
    for i in range(5):
        make_scene_with_content(f"Scene {i}", lessons=3)

    # シーン本体 + phrases / dialogues / lessons の prefetch の計 4 クエリ
    with django_assert_max_num_queries(4):
        res = api_client.get("/api/scenes/")
    assert res.status_code == 200
    assert len(res.json()) == 5


def test_lesson_detail_query_count(api_client, content):
    with CaptureQueriesContext(connection) as ctx:
        api_client.get(f"/api/lessons/{content['lesson'].id}/")
    assert len(ctx.captured_queries) <= 3


# --- 書き込み権限 -----------------------------------------------------------


@pytest.mark.parametrize("resource", ["scene", "lesson", "phrase", "dialogue"])
def test_anonymous_write_is_rejected(api_client, content, resource):
    obj = content[resource]
    base = f"/api/{resource}s/"

    assert api_client.post(base, {"title": "x"}, format="json").status_code in (401, 405)
    assert api_client.put(f"{base}{obj.id}/", {"title": "x"}, format="json").status_code in (
        401,
        405,
    )
    assert api_client.patch(f"{base}{obj.id}/", {"title": "x"}, format="json").status_code in (
        401,
        405,
    )
    assert api_client.delete(f"{base}{obj.id}/").status_code in (401, 405)
    assert type(obj).objects.filter(id=obj.id).exists()


@pytest.mark.parametrize("resource", ["scene", "lesson", "phrase", "dialogue"])
def test_content_is_read_only_for_authenticated_user(auth_client, content, resource):
    obj = content[resource]
    base = f"/api/{resource}s/"

    assert auth_client.post(base, {"title": "x"}, format="json").status_code == 405
    assert auth_client.put(f"{base}{obj.id}/", {"title": "x"}, format="json").status_code == 405
    assert auth_client.patch(f"{base}{obj.id}/", {"title": "x"}, format="json").status_code == 405
    assert auth_client.delete(f"{base}{obj.id}/").status_code == 405
    assert type(obj).objects.filter(id=obj.id).exists()


# --- 進捗の一覧・詳細 -------------------------------------------------------


def test_progress_list_requires_login(api_client, user, lesson):
    make_progress(user, lesson, score=60)

    # 未ログインは 401（Bearer トークンでの認証を求める）
    assert api_client.get("/api/progress/").status_code == 401


def test_progress_list_returns_only_own_records(auth_client, user, lesson):
    other = make_user("bob")
    other_lesson = make_lesson(lesson.scene, title="Other")
    make_progress(user, lesson, score=60)
    make_progress(other, other_lesson, score=30)

    body = auth_client.get("/api/progress/").json()

    assert len(body) == 1
    assert body[0]["username"] == "alice"


def test_progress_detail_of_other_user_returns_404(auth_client, user, lesson):
    other = make_user("bob")
    others = make_progress(other, lesson, score=30)

    assert auth_client.get(f"/api/progress/{others.id}/").status_code == 404


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_progress_direct_write_is_not_allowed(auth_client, user, lesson, method):
    progress = make_progress(user, lesson, score=60)
    url = "/api/progress/" if method == "post" else f"/api/progress/{progress.id}/"

    res = getattr(auth_client, method)(url, {"lesson": lesson.id, "score": 100}, format="json")

    assert res.status_code == 405
    progress.refresh_from_db()
    assert progress.score == 60


# --- complete_lesson --------------------------------------------------------


def test_complete_lesson_anonymous_returns_ok_without_saving(api_client, lesson):
    res = api_client.post(
        COMPLETE_URL, {"lesson_id": lesson.id, "score": 80, "time_spent": 120}, format="json"
    )

    assert res.status_code == 200
    assert res.json() == {"ok": True, "lesson": lesson.id, "score": 80, "time_spent": 120}
    assert UserProgress.objects.count() == 0


def test_complete_lesson_authenticated_creates_progress(auth_client, user, lesson):
    res = auth_client.post(
        COMPLETE_URL, {"lesson_id": lesson.id, "score": 80, "time_spent": 120}, format="json"
    )

    assert res.status_code == 200
    progress = UserProgress.objects.get(user_sub=user.sub, lesson=lesson)
    assert (progress.score, progress.time_spent) == (80, 120)
    assert res.json()["lesson_title"] == lesson.title


def test_complete_lesson_authenticated_updates_progress(auth_client, user, lesson):
    make_progress(user, lesson, score=90, time_spent=10)

    auth_client.post(COMPLETE_URL, {"lesson_id": lesson.id, "score": 50, "time_spent": 200})
    progress = UserProgress.objects.get(user_sub=user.sub, lesson=lesson)
    # 最高スコアを保持し、学習時間は最新の値に更新する
    assert (progress.score, progress.time_spent) == (90, 200)

    auth_client.post(COMPLETE_URL, {"lesson_id": lesson.id, "score": 95, "time_spent": 5})
    progress.refresh_from_db()
    assert (progress.score, progress.time_spent) == (95, 5)
    assert UserProgress.objects.count() == 1


@pytest.mark.parametrize(
    ("score", "time_spent", "expected"),
    [(150, -5, (100, 0)), (-20, 30, (0, 30)), (10**30, 10**30, (100, 2_147_483_647))],
)
def test_complete_lesson_clamps_values(auth_client, user, lesson, score, time_spent, expected):
    res = auth_client.post(
        COMPLETE_URL,
        {"lesson_id": lesson.id, "score": score, "time_spent": time_spent},
        format="json",
    )

    assert res.status_code == 200
    progress = UserProgress.objects.get(user_sub=user.sub, lesson=lesson)
    assert (progress.score, progress.time_spent) == expected


def test_complete_lesson_records_username_and_hides_sub(auth_client, user, lesson):
    res = auth_client.post(COMPLETE_URL, {"lesson_id": lesson.id, "score": 70}, format="json")

    body = res.json()
    assert body["username"] == "alice"
    assert body["lesson"] == lesson.id
    assert "user_sub" not in body
    assert UserProgress.objects.get().user_sub == "sub-alice"


def test_complete_lesson_keys_progress_by_sub(user, lesson):
    # 同じユーザー名でも外部ユーザー ID が異なれば別の記録として扱う
    other = make_user("alice", sub="sub-other")
    make_progress(other, lesson, score=10)
    client = APIClient()
    client.force_authenticate(user=user)

    client.post(COMPLETE_URL, {"lesson_id": lesson.id, "score": 90}, format="json")

    assert UserProgress.objects.count() == 2
    assert UserProgress.objects.get(user_sub="sub-other").score == 10
    assert UserProgress.objects.get(user_sub="sub-alice").score == 90


def test_complete_lesson_retries_on_conflict(auth_client, user, lesson):
    real = views._record_progress
    calls = []

    def flaky(*args):
        calls.append(1)
        if len(calls) == 1:
            error = OperationalError("conflict")
            error.__cause__ = type("Conflict", (Exception,), {"sqlstate": "OC000"})()
            raise error
        return real(*args)

    with mock.patch.object(views, "_record_progress", side_effect=flaky):
        with mock.patch.object(core_db.time, "sleep"):
            res = auth_client.post(COMPLETE_URL, {"lesson_id": lesson.id, "score": 60})

    assert res.status_code == 200
    assert len(calls) == 2
    assert UserProgress.objects.get().score == 60


def test_complete_lesson_returns_503_when_conflicts_persist(auth_client, lesson):
    with mock.patch.object(views, "run_in_transaction_with_retry", side_effect=RetryExhausted):
        res = auth_client.post(COMPLETE_URL, {"lesson_id": lesson.id, "score": 60})

    assert res.status_code == 503
    assert "detail" in res.json()
    assert UserProgress.objects.count() == 0


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"lesson_id": "abc"},
        {"lesson_id": None},
        {"lesson_id": [1]},
        {"lesson_id": 1, "score": "high"},
        {"lesson_id": 1, "time_spent": {"a": 1}},
    ],
)
def test_complete_lesson_invalid_input_returns_400(api_client, lesson, payload):
    res = api_client.post(COMPLETE_URL, payload, format="json")
    assert res.status_code == 400
    assert "detail" in res.json()


@pytest.mark.parametrize("body", ["[1, 2]", '"text"', "not json"])
def test_complete_lesson_non_object_body_returns_400(api_client, db, body):
    res = api_client.post(COMPLETE_URL, body, content_type="application/json")
    assert res.status_code == 400


@pytest.mark.parametrize("lesson_id", [9999, 0, -1, 10**30])
def test_complete_lesson_unknown_lesson_returns_404(api_client, db, lesson_id):
    res = api_client.post(COMPLETE_URL, {"lesson_id": lesson_id}, format="json")
    assert res.status_code == 404


def test_complete_lesson_is_throttled(api_client, lesson, monkeypatch):
    monkeypatch.setattr(CompleteLessonRateThrottle, "THROTTLE_RATES", {"complete_lesson": "2/min"})
    payload = {"lesson_id": lesson.id, "score": 10}

    assert api_client.post(COMPLETE_URL, payload, format="json").status_code == 200
    assert api_client.post(COMPLETE_URL, payload, format="json").status_code == 200
    res = api_client.post(COMPLETE_URL, payload, format="json")
    assert res.status_code == 429
    assert "Retry-After" in res.headers


# --- my_progress ------------------------------------------------------------


def test_my_progress_anonymous_returns_empty_list(api_client, db):
    res = api_client.get("/api/progress/my_progress/")

    assert res.status_code == 200
    assert res.json() == []


def test_my_progress_returns_only_own_records(auth_client, user, lesson):
    other = make_user("bob")
    other_lesson = make_lesson(lesson.scene, title="Other")
    make_progress(user, lesson, score=60)
    make_progress(other, other_lesson, score=30)

    res = auth_client.get("/api/progress/my_progress/")
    body = res.json()

    assert res.status_code == 200
    assert len(body) == 1
    assert body[0]["username"] == "alice"
    assert body[0]["scene_title"] == lesson.scene.title


# --- その他 -----------------------------------------------------------------


def test_unknown_url_returns_404(client, db):
    assert client.get("/no-such-page/").status_code == 404
    assert client.get("/api/no-such-resource/").status_code == 404
    assert client.get("/admin/").status_code == 404


def test_home_redirects_to_frontend(client, monkeypatch):
    monkeypatch.setenv("DJANGO_FRONTEND_URL", "https://frontend.example/")
    res = client.get("/")

    assert res.status_code == 302
    assert res["Location"] == "https://frontend.example/"


def test_home_redirect_ignores_query_parameters(client, monkeypatch):
    monkeypatch.setenv("DJANGO_FRONTEND_URL", "https://frontend.example/")
    res = client.get("/?next=https://evil.example/")

    assert res["Location"] == "https://frontend.example/"


# --- 並び順 -----------------------------------------------------------------


@pytest.mark.parametrize("resource", ["scenes", "lessons", "phrases", "dialogues"])
def test_list_queries_are_ordered(api_client, db, resource):
    make_scene_with_content("First", lessons=2)
    make_scene_with_content("Second", lessons=2)

    with CaptureQueriesContext(connection) as ctx:
        res = api_client.get(f"/api/{resource}/")

    assert res.status_code == 200
    # 一覧・ネストした一覧の取得クエリはすべて並び順を指定する
    assert ctx.captured_queries
    assert all("ORDER BY" in q["sql"] for q in ctx.captured_queries)


def test_scene_nested_lists_are_sorted(api_client, scene):
    lesson_a = make_lesson(scene, title="A")
    lesson_b = make_lesson(scene, title="B")
    phrases = [make_phrase(lesson=lesson_a, text_en=f"p{i}") for i in range(3)]
    # 表示順（order）を優先し、同じ order の場合は ID 順に並べる
    late = make_dialogue(lesson=lesson_a, order=2)
    tie_first = make_dialogue(lesson=lesson_b, order=1)
    tie_second = make_dialogue(lesson=lesson_b, order=1)

    body = api_client.get(f"/api/scenes/{scene.id}/").json()

    assert [lesson["id"] for lesson in body["lessons"]] == [lesson_a.id, lesson_b.id]
    assert [p["id"] for p in body["phrases"]] == [p.id for p in phrases]
    assert [d["id"] for d in body["dialogues"]] == [tie_first.id, tie_second.id, late.id]


def test_lesson_detail_dialogues_are_sorted(api_client, lesson):
    second = make_dialogue(lesson=lesson, order=2)
    first = make_dialogue(lesson=lesson, order=1)

    body = api_client.get(f"/api/lessons/{lesson.id}/").json()

    assert [d["id"] for d in body["lesson_dialogues"]] == [first.id, second.id]


def test_progress_list_is_newest_first(auth_client, user, scene):
    older = make_progress(user, make_lesson(scene, title="Old"))
    newer = make_progress(user, make_lesson(scene, title="New"))
    # 完了日時が同じ場合は ID の降順に並べる
    UserProgress.objects.update(completed_at=older.completed_at)

    body = auth_client.get("/api/progress/").json()

    assert [p["id"] for p in body] == [newer.id, older.id]


# --- 同時作成時の再試行 -----------------------------------------------------


def test_complete_lesson_retries_concurrent_create_as_update(auth_client, user, lesson):
    """同じ記録が同時に作成された場合は、トランザクションをやり直して既存の記録を更新する。"""
    calls = []

    def concurrent_create(**kwargs):
        calls.append(1)
        if len(calls) == 1:
            # 別のリクエストが同じ記録を先に作成した場合の一意制約の競合
            raise IntegrityError("duplicate key value violates unique constraint")
        raise AssertionError("再試行では作成ではなく更新を行う")

    def other_request_commits(_delay):
        # 再試行の待機中に、別のリクエストの記録がコミットされた状態を再現する
        UserProgress(user_sub=user.sub, lesson=lesson, score=90, time_spent=10).save()

    with mock.patch.object(UserProgress.objects, "create", side_effect=concurrent_create):
        with mock.patch.object(core_db.time, "sleep", side_effect=other_request_commits):
            res = auth_client.post(
                COMPLETE_URL, {"lesson_id": lesson.id, "score": 70, "time_spent": 30}
            )

    assert res.status_code == 200
    assert len(calls) == 1
    progress = UserProgress.objects.get(user_sub=user.sub, lesson=lesson)
    # 最高スコアを保持し、学習時間は最新の値に更新する
    assert (progress.score, progress.time_spent) == (90, 30)


def test_record_progress_does_not_use_get_or_create(auth_client, lesson):
    with mock.patch.object(
        UserProgress.objects, "get_or_create", side_effect=AssertionError("unused")
    ):
        res = auth_client.post(COMPLETE_URL, {"lesson_id": lesson.id, "score": 70})

    assert res.status_code == 200
