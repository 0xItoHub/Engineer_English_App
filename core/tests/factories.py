"""テスト用のデータ作成ヘルパー。"""

from django.contrib.auth.models import User

from core.models import Dialogue, Lesson, Phrase, Scene, UserProgress


def make_scene(title="Daily Standup"):
    return Scene.objects.create(title=title)


def make_lesson(scene=None, title="Reporting progress", description=""):
    scene = scene or make_scene()
    return Lesson.objects.create(scene=scene, title=title, description=description)


def make_phrase(scene=None, lesson=None, text_en="I'm working on it.", text_ja="対応中です。"):
    if scene is None:
        scene = lesson.scene if lesson else make_scene()
    return Phrase.objects.create(scene=scene, lesson=lesson, text_en=text_en, text_ja=text_ja)


def make_dialogue(scene=None, lesson=None, order=1, speaker="A"):
    if scene is None:
        scene = lesson.scene if lesson else make_scene()
    return Dialogue.objects.create(
        scene=scene,
        lesson=lesson,
        speaker=speaker,
        line_en="Any blockers?",
        line_ja="ブロッカーはありますか？",
        order=order,
    )


def make_user(username="alice", password="test-pass"):
    return User.objects.create_user(username=username, password=password)


def make_progress(user, lesson, score=50, time_spent=60):
    return UserProgress.objects.create(user=user, lesson=lesson, score=score, time_spent=time_spent)


def make_scene_with_content(title="Code Review", lessons=2):
    """レッスン・フレーズ・対話を含むシーンを作成する。"""
    scene = make_scene(title)
    for i in range(lessons):
        lesson = make_lesson(scene, title=f"{title} lesson {i}")
        make_phrase(lesson=lesson, text_en=f"{title} phrase {i}")
        make_dialogue(lesson=lesson, order=i + 1)
    return scene
