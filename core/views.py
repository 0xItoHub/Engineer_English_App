import os

from django.db.models import Prefetch
from django.shortcuts import redirect
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

from .db import RetryExhausted, run_in_transaction_with_retry
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


# 学習コンテンツは読み取り専用で公開する（内容は seed コマンドで投入・更新する）
class SceneViewSet(viewsets.ReadOnlyModelViewSet):
    # ネストしたフレーズ・対話・レッスンをまとめて取得し、シーン数に依存しないクエリ数にする。
    # ネストした一覧も並び順を明示して、応答の順序を一定にする
    queryset = Scene.objects.prefetch_related(
        Prefetch("phrases", queryset=Phrase.objects.order_by("id")),
        Prefetch("dialogues", queryset=Dialogue.objects.order_by("order", "id")),
        Prefetch("lessons", queryset=Lesson.objects.order_by("id")),
    )
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
            qs = qs.prefetch_related(
                Prefetch("lesson_phrases", queryset=Phrase.objects.order_by("id")),
                Prefetch("lesson_dialogues", queryset=Dialogue.objects.order_by("order", "id")),
            )
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

    # シリアライザで参照するレッスン・シーンを JOIN で同時に取得する
    queryset = UserProgress.objects.select_related("lesson__scene")
    serializer_class = UserProgressSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return UserProgress.objects.none()
        return super().get_queryset().filter(user_sub=user.sub)

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
            lesson = Lesson.objects.select_related("scene").get(id=lesson_id)
        except Lesson.DoesNotExist:
            return Response({"error": "レッスンが見つかりません"}, status=status.HTTP_404_NOT_FOUND)

        if not request.user.is_authenticated:
            return Response(
                {
                    "ok": True,
                    "lesson": lesson.id,
                    "score": score,
                    "time_spent": time_spent,
                }
            )

        try:
            progress = run_in_transaction_with_retry(
                lambda: _record_progress(request.user, lesson, score, time_spent)
            )
        except RetryExhausted:
            return Response(
                {"error": "混み合っているため記録できませんでした。時間をおいて再度お試しください"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        serializer = self.get_serializer(progress)
        return Response(serializer.data)


def _record_progress(user, lesson, score, time_spent):
    """学習の完了を記録する（最高スコアを保持し、学習時間は最新の値に更新する）。"""
    progress, created = UserProgress.objects.get_or_create(
        user_sub=user.sub,
        lesson=lesson,
        defaults={"username": user.username, "score": score, "time_spent": time_spent},
    )
    if not created:
        progress.score = max(progress.score, score)
        progress.time_spent = time_spent
        progress.username = user.username or progress.username
        progress.save(update_fields=["score", "time_spent", "username"])
    return progress


def home(request):
    """API のトップへのアクセスはフロントエンドへ転送する（転送先は環境変数で固定）。"""
    return redirect(os.getenv("DJANGO_FRONTEND_URL", "http://localhost:3000/"))
