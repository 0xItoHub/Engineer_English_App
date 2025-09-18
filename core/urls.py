from rest_framework import routers
from .views import (
    SceneViewSet,
    PhraseViewSet,
    DialogueViewSet,
    LessonViewSet,
    UserProgressViewSet,
)

router = routers.DefaultRouter()
router.register("scenes", SceneViewSet)
router.register("phrases", PhraseViewSet)
router.register("dialogues", DialogueViewSet)
router.register("lessons", LessonViewSet)
router.register("progress", UserProgressViewSet)

urlpatterns = router.urls
