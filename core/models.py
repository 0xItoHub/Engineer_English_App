from django.db import models
from django.contrib.auth.models import User


class Scene(models.Model):
    title = models.CharField(max_length=120)

    def __str__(self):
        return self.title


class Lesson(models.Model):
    scene = models.ForeignKey(Scene, on_delete=models.CASCADE, related_name="lessons")
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True)

    def __str__(self):
        return self.title


class Phrase(models.Model):
    scene = models.ForeignKey(Scene, on_delete=models.CASCADE, related_name="phrases")
    # レッスン個別のフレーズを持てるように（任意）
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.CASCADE,
        related_name="lesson_phrases",
        null=True,
        blank=True,
    )
    text_en = models.CharField(max_length=255)
    text_ja = models.CharField(max_length=255)
    note = models.TextField(blank=True)

    def __str__(self):
        return self.text_en


class Dialogue(models.Model):
    scene = models.ForeignKey(Scene, on_delete=models.CASCADE, related_name="dialogues")
    # レッスン個別の対話を持てるように（任意）
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.CASCADE,
        related_name="lesson_dialogues",
        null=True,
        blank=True,
    )
    speaker = models.CharField(max_length=50)
    line_en = models.TextField()
    line_ja = models.TextField()
    order = models.PositiveIntegerField()

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"{self.order}: {self.speaker}"


class UserProgress(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="progress")
    lesson = models.ForeignKey(
        Lesson, on_delete=models.CASCADE, related_name="user_progress"
    )
    completed_at = models.DateTimeField(auto_now_add=True)
    score = models.PositiveIntegerField(default=0, help_text="学習スコア（0-100）")
    time_spent = models.PositiveIntegerField(default=0, help_text="学習時間（秒）")

    class Meta:
        unique_together = ["user", "lesson"]
        ordering = ["-completed_at"]

    def __str__(self):
        return f"{self.user.username} - {self.lesson.title} ({self.completed_at.strftime('%Y-%m-%d')})"
