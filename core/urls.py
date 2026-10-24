from rest_framework import routers

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

urlpatterns = router.urls
