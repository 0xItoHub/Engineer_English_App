from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.contrib.auth.models import User
from django.shortcuts import render
from .models import Scene, Phrase, Dialogue, Lesson, UserProgress
from .serializers import (
    SceneSerializer,
    PhraseSerializer,
    DialogueSerializer,
    LessonSerializer,
    UserProgressSerializer,
    LessonDetailSerializer,  # 追加
)


class SceneViewSet(viewsets.ModelViewSet):
    queryset = Scene.objects.all()
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

    def get_serializer_class(self):
        # 詳細取得（/lessons/:id/）ではフレーズ・対話を含む詳細シリアライザを返す
        if getattr(self, "action", None) == "retrieve":
            return LessonDetailSerializer
        return LessonSerializer


class UserProgressViewSet(viewsets.ModelViewSet):
    queryset = UserProgress.objects.all()
    serializer_class = UserProgressSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=["get"])
    def my_progress(self, request):
        if request.user.is_authenticated:
            progress = UserProgress.objects.filter(user=request.user)
        else:
            progress = UserProgress.objects.none()
        serializer = self.get_serializer(progress, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["post"])
    def complete_lesson(self, request):
        lesson_id = request.data.get("lesson_id")
        score = request.data.get("score", 0)
        time_spent = request.data.get("time_spent", 0)

        # スコアを100%を超えないように制限
        score = min(max(0, score), 100)

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
            return Response(
                {"error": "レッスンが見つかりません"}, status=status.HTTP_404_NOT_FOUND
            )


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
