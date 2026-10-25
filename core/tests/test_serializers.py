import pytest

from core.serializers import (
    LessonDetailSerializer,
    LessonSerializer,
    SceneSerializer,
    UserProgressSerializer,
)

from .factories import make_dialogue, make_phrase, make_progress, make_scene_with_content

pytestmark = pytest.mark.django_db


def test_scene_serializer_nests_children():
    scene = make_scene_with_content("Code Review", lessons=2)
    data = SceneSerializer(scene).data

    assert set(data) == {"id", "title", "phrases", "dialogues", "lessons"}
    assert data["title"] == "Code Review"
    assert len(data["lessons"]) == 2
    assert len(data["phrases"]) == 2
    assert len(data["dialogues"]) == 2


def test_lesson_serializer_fields(lesson):
    data = LessonSerializer(lesson).data

    assert set(data) == {"id", "scene", "title", "description"}
    assert data["scene"] == lesson.scene_id


def test_lesson_detail_serializer_includes_phrases_and_dialogues(lesson):
    make_phrase(lesson=lesson)
    make_dialogue(lesson=lesson)
    data = LessonDetailSerializer(lesson).data

    assert len(data["lesson_phrases"]) == 1
    assert len(data["lesson_dialogues"]) == 1


def test_user_progress_serializer_exposes_titles(user, lesson):
    progress = make_progress(user, lesson, score=80, time_spent=120)
    data = UserProgressSerializer(progress).data

    assert data["lesson_title"] == lesson.title
    assert data["scene_title"] == lesson.scene.title
    assert data["username"] == "alice"
    assert data["score"] == 80


def test_user_progress_serializer_fields(user, lesson):
    data = UserProgressSerializer(make_progress(user, lesson)).data

    # 外部ユーザー ID は応答に含めない
    assert set(data) == {
        "id",
        "lesson",
        "lesson_title",
        "scene_title",
        "username",
        "completed_at",
        "score",
        "time_spent",
    }


def test_user_progress_serializer_ignores_read_only_fields(lesson):
    serializer = UserProgressSerializer(
        data={"lesson": lesson.id, "username": "mallory", "score": 10, "time_spent": 5}
    )

    assert serializer.is_valid(), serializer.errors
    assert "username" not in serializer.validated_data
