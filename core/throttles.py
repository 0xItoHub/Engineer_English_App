from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle


class CompleteLessonRateThrottle(UserRateThrottle):
    """学習完了の記録用のレート制限（認証済みはユーザー単位、未認証は IP 単位）。

    上限は settings の DEFAULT_THROTTLE_RATES["complete_lesson"] で指定する。
    """

    scope = "complete_lesson"


class CspReportRateThrottle(SimpleRateThrottle):
    """CSP 違反レポートの受け付け用のレート制限（IP 単位）。

    上限は settings の DEFAULT_THROTTLE_RATES["csp_report"] で指定する。
    """

    scope = "csp_report"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class ChatRateThrottle(UserRateThrottle):
    """AI チャットの質問用のレート制限（ユーザー単位）。

    上限は settings の DEFAULT_THROTTLE_RATES["chat"] で指定する。
    日ごとの上限（core.chat.usage）とは別に、短時間の連続した送信を抑える。
    """

    scope = "chat"
