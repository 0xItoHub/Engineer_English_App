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
        # 外部ユーザー ID（user_sub）・ユーザー名は応答に含めない
        fields = [
            "id",
            "lesson",
            "lesson_title",
            "scene_title",
            "completed_at",
            "score",
            "time_spent",
        ]
        read_only_fields = ["completed_at"]


class CompleteLessonSerializer(serializers.Serializer):
    """学習完了の記録（POST /api/progress/complete_lesson/）の入力。

    整数以外（文字列・真偽値・小数部のある数値など）は 400 とする。
    score / time_spent の範囲外の値は拒否せず、ビューで保存可能な範囲に丸める。
    """

    lesson_id = serializers.IntegerField(min_value=1)
    score = serializers.IntegerField(required=False, default=0)
    time_spent = serializers.IntegerField(required=False, default=0)

    def to_internal_value(self, data):
        # 真偽値は整数として扱わない（JSON の true / false を 1 / 0 として受け付けない）
        if isinstance(data, dict):
            errors = {
                name: ["整数で指定してください。"]
                for name in self.fields
                if isinstance(data.get(name), bool)
            }
            if errors:
                raise serializers.ValidationError(errors)
        return super().to_internal_value(data)
