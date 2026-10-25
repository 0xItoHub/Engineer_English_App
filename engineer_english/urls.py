from django.urls import include, path

from core.views import home

urlpatterns = [
    path("", home),
    path("api/", include("core.urls")),
]
