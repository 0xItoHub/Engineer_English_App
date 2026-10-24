import pytest
from django.db import IntegrityError

from core.models import Lesson, Phrase, Scene

from .factories import make_dialogue, make_lesson, make_phrase, make_progress, make_scene

pytestmark = pytest.mark.django_db


def test_str_representations(user):
    scene = make_scene("Incident Response")
    lesson = make_lesson(scene, title="Postmortem")
    phrase = make_phrase(lesson=lesson, text_en="Root cause")
    dialogue = make_dialogue(lesson=lesson, order=3, speaker="Lead")
    progress = make_progress(user, lesson)

    assert str(scene) == "Incident Response"
    assert str(lesson) == "Postmortem"
    assert str(phrase) == "Root cause"
    assert str(dialogue) == "3: Lead"
    assert str(progress).startswith("alice - Postmortem (")


def test_related_names(lesson):
    phrase = make_phrase(lesson=lesson)
    dialogue = make_dialogue(lesson=lesson)

    assert list(lesson.scene.lessons.all()) == [lesson]
    assert list(lesson.lesson_phrases.all()) == [phrase]
    assert list(lesson.lesson_dialogues.all()) == [dialogue]
    assert list(lesson.scene.phrases.all()) == [phrase]


def test_dialogue_default_ordering(scene):
    second = make_dialogue(scene=scene, order=2)
    first = make_dialogue(scene=scene, order=1)

    assert list(scene.dialogues.all()) == [first, second]


def test_user_progress_is_unique_per_user_and_lesson(user, lesson):
    make_progress(user, lesson)
    with pytest.raises(IntegrityError):
        make_progress(user, lesson)


def test_deleting_scene_cascades(lesson):
    make_phrase(lesson=lesson)
    lesson.scene.delete()

    assert Scene.objects.count() == 0
    assert Lesson.objects.count() == 0
    assert Phrase.objects.count() == 0
