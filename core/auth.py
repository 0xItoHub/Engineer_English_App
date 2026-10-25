"""外部の認証基盤で認証されたユーザーの表現。"""


class ExternalUser:
    """外部の認証基盤（ID トークン）で認証されたユーザー。

    Django のユーザーテーブルは使わず、認証基盤が発行するユーザー ID（sub）で本人を識別する。
    DRF の request.user として扱えるよう、認証状態を表す属性を持つ。
    """

    is_authenticated = True
    is_anonymous = False
    is_active = True
    is_staff = False
    is_superuser = False

    def __init__(self, sub, username=""):
        if not sub:
            raise ValueError("sub は必須です")
        self.sub = str(sub)
        self.username = username or ""

    @property
    def pk(self):
        # DRF のレート制限（UserRateThrottle）はユーザー単位の識別に pk を使う
        return self.sub

    def __eq__(self, other):
        return isinstance(other, ExternalUser) and other.sub == self.sub

    def __hash__(self):
        return hash(self.sub)

    def __str__(self):
        return self.username or self.sub
