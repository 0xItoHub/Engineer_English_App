from django.urls import path
from rest_framework import routers

from .csp_report import CspReportView
from .views import (
    DialogueViewSet,
    LessonViewSet,
    PhraseViewSet,
    SceneViewSet,
    UserProgressViewSet,
)

router = routers.DefaultRouter()
router.register("scenes", SceneViewSet)
router.register("phrases", PhraseViewSet)
router.register("dialogues", DialogueViewSet)
router.register("lessons", LessonViewSet)
router.register("progress", UserProgressViewSet)

urlpatterns = [
    # CSP の違反レポートの受け付け（CloudFront のレスポンスヘッダーで report-uri に指定）
    path("csp-report/", CspReportView.as_view(), name="csp-report"),
    *router.urls,
]
