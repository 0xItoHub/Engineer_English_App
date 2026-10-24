from io import StringIO

import pytest
from django.core.management import call_command

from core.models import Dialogue, Lesson, Phrase, Scene

pytestmark = pytest.mark.django_db


def test_seed_six_scenes_is_idempotent():
    call_command("seed_six_scenes", stdout=StringIO())
    counts = (Scene.objects.count(), Lesson.objects.count(), Phrase.objects.count())

    assert counts[0] == 6
    assert counts[1] == 30
    assert Dialogue.objects.count() >= 30

    # 2 回目の実行でデータが重複しないこと
    call_command("seed_six_scenes", stdout=StringIO())
    assert (Scene.objects.count(), Lesson.objects.count(), Phrase.objects.count()) == counts
