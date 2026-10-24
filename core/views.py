from django.shortcuts import render
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Dialogue, Lesson, Phrase, Scene, UserProgress
from .serializers import (
    DialogueSerializer,
    LessonDetailSerializer,  # 追加
    LessonSerializer,
    PhraseSerializer,
    SceneSerializer,
    UserProgressSerializer,
)


class SceneViewSet(viewsets.ModelViewSet):
    # ネストしたフレーズ・対話・レッスンをまとめて取得し、シーン数に依存しないクエリ数にする
    queryset = Scene.objects.prefetch_related("phrases", "dialogues", "lessons")
    serializer_class = SceneSerializer


class PhraseViewSet(viewsets.ModelViewSet):
    queryset = Phrase.objects.all()
    serializer_class = PhraseSerializer

    def get_queryset(self):
        qs = Phrase.objects.all()
        lesson_id = self.request.query_params.get("lesson")
        scene_id = self.request.query_params.get("scene")
        if lesson_id:
            qs = qs.filter(lesson_id=lesson_id)
        if scene_id:
            qs = qs.filter(scene_id=scene_id)
        return qs


class DialogueViewSet(viewsets.ModelViewSet):
    queryset = Dialogue.objects.all()
    serializer_class = DialogueSerializer

    def get_queryset(self):
        qs = Dialogue.objects.all()
        lesson_id = self.request.query_params.get("lesson")
        scene_id = self.request.query_params.get("scene")
        if lesson_id:
            qs = qs.filter(lesson_id=lesson_id)
        if scene_id:
            qs = qs.filter(scene_id=scene_id)
        return qs


class LessonViewSet(viewsets.ModelViewSet):
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


class UserProgressViewSet(viewsets.ModelViewSet):
    # シリアライザで参照するレッスン・シーン・ユーザーを JOIN で同時に取得する
    queryset = UserProgress.objects.select_related("lesson__scene", "user")
    serializer_class = UserProgressSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=["get"])
    def my_progress(self, request):
        if request.user.is_authenticated:
            progress = self.get_queryset().filter(user=request.user)
        else:
            progress = UserProgress.objects.none()
        serializer = self.get_serializer(progress, many=True)
        return Response(serializer.data)

    # 既存UXを維持するため complete_lesson は未認証でも呼べる（未認証時は保存せず ok を返す）。
    @action(detail=False, methods=["post"], permission_classes=[AllowAny])
    def complete_lesson(self, request):
        # 入力の検証・型変換（不正値は 500 ではなく 400 を返す）
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

        # スコアを 0〜100 に、学習時間を 0 以上に制限
        score = min(max(0, score), 100)
        time_spent = max(0, time_spent)

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
    stats = {
        "scenes": Scene.objects.count(),
        "lessons": Lesson.objects.count(),
        "phrases": Phrase.objects.count(),
        "dialogues": Dialogue.objects.count(),
    }
    ctx = {
        "stats": stats,
        "frontend_url": "http://localhost:3000/",
        "api_base": "/api/",
    }
    return render(request, "core/home.html", ctx)
