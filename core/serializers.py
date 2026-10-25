from rest_framework import serializers

from .models import Dialogue, Lesson, Phrase, Scene, UserProgress


class PhraseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Phrase
        fields = "__all__"


class DialogueSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dialogue
        fields = "__all__"


class LessonDetailSerializer(serializers.ModelSerializer):
    lesson_phrases = PhraseSerializer(many=True, read_only=True)
    lesson_dialogues = DialogueSerializer(many=True, read_only=True)

    class Meta:
        model = Lesson
        fields = [
            "id",
            "scene",
            "title",
            "description",
            "lesson_phrases",
            "lesson_dialogues",
        ]


class LessonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lesson
        fields = "__all__"


class SceneSerializer(serializers.ModelSerializer):
    phrases = PhraseSerializer(many=True, read_only=True)
    dialogues = DialogueSerializer(many=True, read_only=True)
    lessons = LessonSerializer(many=True, read_only=True)

    class Meta:
        model = Scene
        fields = [
            "id",
            "title",
            "phrases",
            "dialogues",
            "lessons",
        ]


class UserProgressSerializer(serializers.ModelSerializer):
    lesson_title = serializers.CharField(source="lesson.title", read_only=True)
    scene_title = serializers.CharField(source="lesson.scene.title", read_only=True)

    class Meta:
        model = UserProgress
        # 外部ユーザー ID（user_sub）は応答に含めない
        fields = [
            "id",
            "lesson",
            "lesson_title",
            "scene_title",
            "username",
            "completed_at",
            "score",
            "time_spent",
        ]
        read_only_fields = ["username", "completed_at"]
