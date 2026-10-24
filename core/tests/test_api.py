import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from core.models import Phrase, Scene, UserProgress
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
def test_anonymous_write_is_forbidden(api_client, content, resource):
    obj = content[resource]
    base = f"/api/{resource}s/"

    assert api_client.post(base, {"title": "x"}, format="json").status_code == 403
    assert api_client.put(f"{base}{obj.id}/", {"title": "x"}, format="json").status_code == 403
    assert api_client.patch(f"{base}{obj.id}/", {"title": "x"}, format="json").status_code == 403
    assert api_client.delete(f"{base}{obj.id}/").status_code == 403
    assert type(obj).objects.filter(id=obj.id).exists()


def test_authenticated_user_can_create_scene(auth_client, db):
    res = auth_client.post("/api/scenes/", {"title": "Pairing"}, format="json")

    assert res.status_code == 201
    assert Scene.objects.filter(title="Pairing").exists()


def test_authenticated_progress_create_sets_owner(auth_client, user, lesson):
    res = auth_client.post(
        "/api/progress/", {"lesson": lesson.id, "score": 70, "time_spent": 30}, format="json"
    )

    assert res.status_code == 201
    assert UserProgress.objects.get().user == user


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
    progress = UserProgress.objects.get(user=user, lesson=lesson)
    assert (progress.score, progress.time_spent) == (80, 120)
    assert res.json()["lesson_title"] == lesson.title


def test_complete_lesson_authenticated_updates_progress(auth_client, user, lesson):
    make_progress(user, lesson, score=90, time_spent=10)

    auth_client.post(COMPLETE_URL, {"lesson_id": lesson.id, "score": 50, "time_spent": 200})
    progress = UserProgress.objects.get(user=user, lesson=lesson)
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
    progress = UserProgress.objects.get(user=user, lesson=lesson)
    assert (progress.score, progress.time_spent) == expected


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
    assert "error" in res.json()


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


def test_home_renders_stats(client, content):
    make_phrase(scene=content["scene"])
    res = client.get("/")

    assert res.status_code == 200
    assert res.context["stats"] == {"scenes": 1, "lessons": 1, "phrases": 2, "dialogues": 1}
    assert Phrase.objects.count() == 2
