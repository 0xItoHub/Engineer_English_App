import os

from django.shortcuts import redirect
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

from .models import Dialogue, Lesson, Phrase, Scene, UserProgress
from .serializers import (
    DialogueSerializer,
    LessonDetailSerializer,
    LessonSerializer,
    PhraseSerializer,
    SceneSerializer,
    UserProgressSerializer,
)
from .throttles import CompleteLessonRateThrottle

# PositiveIntegerField に保存できる上限（PostgreSQL の integer 型の最大値）
MAX_POSITIVE_INT = 2_147_483_647


def _int_query_param(request, name):
    """クエリパラメータを整数として取得する（未指定は None、不正値は 400）。"""
    value = request.query_params.get(name)
    if not value:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValidationError({name: "整数で指定してください"}) from None
    if not 0 < parsed <= MAX_POSITIVE_INT:
        raise ValidationError({name: "正の整数で指定してください"})
    return parsed


class LessonSceneFilterMixin:
    """?lesson= / ?scene= による絞り込みを提供する。"""

    def get_queryset(self):
        qs = super().get_queryset()
        lesson_id = _int_query_param(self.request, "lesson")
        scene_id = _int_query_param(self.request, "scene")
        if lesson_id is not None:
            qs = qs.filter(lesson_id=lesson_id)
        if scene_id is not None:
            qs = qs.filter(scene_id=scene_id)
        return qs


# 学習コンテンツは読み取り専用で公開する（編集は管理画面から行う）
class SceneViewSet(viewsets.ReadOnlyModelViewSet):
    # ネストしたフレーズ・対話・レッスンをまとめて取得し、シーン数に依存しないクエリ数にする
    queryset = Scene.objects.prefetch_related("phrases", "dialogues", "lessons")
    serializer_class = SceneSerializer


class PhraseViewSet(LessonSceneFilterMixin, viewsets.ReadOnlyModelViewSet):
    queryset = Phrase.objects.all()
    serializer_class = PhraseSerializer


class DialogueViewSet(LessonSceneFilterMixin, viewsets.ReadOnlyModelViewSet):
    queryset = Dialogue.objects.all()
    serializer_class = DialogueSerializer


class LessonViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Lesson.objects.all()

    def get_queryset(self):
        qs = super().get_queryset()
        # 詳細取得ではレッスン内のフレーズ・対話をまとめて取得する
        if getattr(self, "action", None) == "retrieve":
            qs = qs.prefetch_related("lesson_phrases", "lesson_dialogues")
        return qs

    def get_serializer_class(self):
        # 詳細取得（/lessons/:id/）ではフレーズ・対話を含む詳細シリアライザを返す
        if getattr(self, "action", None) == "retrieve":
            return LessonDetailSerializer
        return LessonSerializer


class UserProgressViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """学習進捗。一覧・詳細はログインユーザー本人のデータのみを返す。

    記録は complete_lesson から行う。
    """

    # シリアライザで参照するレッスン・シーン・ユーザーを JOIN で同時に取得する
    queryset = UserProgress.objects.select_related("lesson__scene", "user")
    serializer_class = UserProgressSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return UserProgress.objects.none()
        return super().get_queryset().filter(user=user)

    @action(detail=False, methods=["get"], permission_classes=[AllowAny])
    def my_progress(self, request):
        # 未ログイン時は空の一覧を返す（画面側はブラウザに保存した進捗を表示する）
        serializer = self.get_serializer(self.get_queryset(), many=True)
        return Response(serializer.data)

    # 既存UXを維持するため complete_lesson は未認証でも呼べる（未認証時は保存せず ok を返す）。
    # 書き込みを伴うため、通常のレート制限に加えて専用スコープでも制限する。
    @action(
        detail=False,
        methods=["post"],
        permission_classes=[AllowAny],
        throttle_classes=[AnonRateThrottle, UserRateThrottle, CompleteLessonRateThrottle],
    )
    def complete_lesson(self, request):
        # 入力の検証・型変換（不正値は 500 ではなく 400 を返す）
        if not isinstance(request.data, dict):
            return Response(
                {"error": "リクエスト本文はオブジェクト形式で指定してください"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            lesson_id = int(request.data.get("lesson_id"))
        except (TypeError, ValueError):
            return Response(
                {"error": "lesson_id は整数で指定してください"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            score = int(request.data.get("score", 0))
            time_spent = int(request.data.get("time_spent", 0))
        except (TypeError, ValueError):
            return Response(
                {"error": "score / time_spent は整数で指定してください"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not 0 < lesson_id <= MAX_POSITIVE_INT:
            return Response({"error": "レッスンが見つかりません"}, status=status.HTTP_404_NOT_FOUND)

        # スコアを 0〜100 に、学習時間を 0〜保存可能な上限に制限
        score = min(max(0, score), 100)
        time_spent = min(max(0, time_spent), MAX_POSITIVE_INT)

        try:
            lesson = Lesson.objects.get(id=lesson_id)
            if request.user.is_authenticated:
                progress, created = UserProgress.objects.get_or_create(
                    user=request.user,
                    lesson=lesson,
                    defaults={"score": score, "time_spent": time_spent},
                )
                if not created:
                    progress.score = max(progress.score, score)
                    progress.time_spent = time_spent
                    progress.save()
                serializer = self.get_serializer(progress)
                return Response(serializer.data)
            else:
                return Response(
                    {
                        "ok": True,
                        "lesson": lesson.id,
                        "score": score,
                        "time_spent": time_spent,
                    }
                )
        except Lesson.DoesNotExist:
            return Response({"error": "レッスンが見つかりません"}, status=status.HTTP_404_NOT_FOUND)


def home(request):
    """API のトップへのアクセスはフロントエンドへ転送する（転送先は環境変数で固定）。"""
    return redirect(os.getenv("DJANGO_FRONTEND_URL", "http://localhost:3000/"))
