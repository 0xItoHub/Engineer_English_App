from django.contrib import admin
from .models import Scene, Phrase, Dialogue, Lesson, UserProgress

admin.site.register(Scene)
admin.site.register(Phrase)
admin.site.register(Dialogue)
admin.site.register(Lesson)


@admin.register(UserProgress)
class UserProgressAdmin(admin.ModelAdmin):
    list_display = ["user", "lesson", "completed_at", "score", "time_spent"]
    list_filter = ["completed_at", "score"]
    search_fields = ["user__username", "lesson__title"]
    readonly_fields = ["completed_at"]
