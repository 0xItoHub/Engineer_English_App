from django.urls import include, path

from core.views import home

urlpatterns = [
    path("", home),
    path("api/", include("core.urls")),
]

# DRF を通らないパス（未定義の URL など）のエラーも {"detail": ...} 形式の JSON で返す
handler400 = "core.exceptions.bad_request"
handler403 = "core.exceptions.permission_denied"
handler404 = "core.exceptions.page_not_found"
handler500 = "core.exceptions.server_error"
