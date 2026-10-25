from io import StringIO

import pytest
from django.core.management import call_command

from core.models import Dialogue, Lesson, Phrase, Scene

pytestmark = pytest.mark.django_db


def _ids():
    return {
        model.__name__: sorted(model.objects.values_list("id", flat=True))
        for model in (Scene, Lesson, Phrase, Dialogue)
    }


def test_seed_six_scenes_is_idempotent():
    call_command("seed_six_scenes", stdout=StringIO())
    counts = (Scene.objects.count(), Lesson.objects.count(), Phrase.objects.count())

    assert counts[0] == 6
    assert counts[1] == 30
    assert Dialogue.objects.count() >= 30
    ids = _ids()

    # 2 回目の実行でデータが重複せず、既存行の ID もそのまま維持されること
    out = StringIO()
    call_command("seed_six_scenes", stdout=out)
    assert (Scene.objects.count(), Lesson.objects.count(), Phrase.objects.count()) == counts
    assert _ids() == ids
    assert "+0 lessons, +0 phrases, +0 dialogues" in out.getvalue()


def test_seed_restores_changed_rows_and_removes_outdated_seed_phrases():
    call_command("seed_six_scenes", stdout=StringIO())
    phrase = Phrase.objects.order_by("id").first()
    dialogue = Dialogue.objects.order_by("id").first()
    original = (phrase.text_ja, phrase.lesson_id, dialogue.speaker, dialogue.line_en)
    other_lesson = Lesson.objects.exclude(id=phrase.lesson_id).first()

    Phrase.objects.filter(id=phrase.id).update(text_ja="変更", note="", lesson=other_lesson)
    Dialogue.objects.filter(id=dialogue.id).update(
        speaker="X", line_en="changed", line_ja="変更", lesson=other_lesson
    )
    outdated = Phrase.objects.create(
        scene=phrase.scene, text_en="Outdated", text_ja="古い", note="seed"
    )
    custom = Phrase.objects.create(scene=phrase.scene, text_en="Custom", text_ja="独自")

    out = StringIO()
    call_command("seed_six_scenes", stdout=out)

    phrase.refresh_from_db()
    dialogue.refresh_from_db()
    assert (phrase.text_ja, phrase.lesson_id, dialogue.speaker, dialogue.line_en) == original
    assert phrase.note == "seed"
    assert not Phrase.objects.filter(id=outdated.id).exists()
    # seed 以外で追加したフレーズは残す
    assert Phrase.objects.filter(id=custom.id).exists()
    assert "updated 1 phrases, 1 dialogues" in out.getvalue()
