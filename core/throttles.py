from rest_framework.throttling import UserRateThrottle


class CompleteLessonRateThrottle(UserRateThrottle):
    """学習完了の記録用のレート制限（認証済みはユーザー単位、未認証は IP 単位）。

    上限は settings の DEFAULT_THROTTLE_RATES["complete_lesson"] で指定する。
    """

    scope = "complete_lesson"
