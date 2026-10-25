"""CloudFront 経由のリクエストの確認と、閲覧者の IP アドレスの設定。

本番では API を CloudFront の /api/* から配信する。CloudFront は API Gateway への転送時に
オリジン用のカスタムヘッダー X-Origin-Verify（Terraform が生成した秘密の値）を付与し、
CloudFront Function が閲覧者の IP アドレスを X-Viewer-IP に設定する。

環境変数 ORIGIN_VERIFY_SECRET が設定されている場合、このミドルウェアは
- X-Origin-Verify が一致しないリクエスト（API Gateway の URL への直接のアクセスなど）に 403 を返す
- 確認できたリクエストでは X-Viewer-IP を REMOTE_ADDR に設定し、DRF のレート制限が
  閲覧者の IP アドレス単位で数えられるようにする
- 転送用のヘッダー（X-Forwarded-For / X-Origin-Verify / X-Viewer-IP）を request.META から取り除き、
  秘密の値がビューやログに渡らないようにする

ORIGIN_VERIFY_SECRET が未設定の環境（ローカル開発・テスト）では何もしない。
"""

import hmac
import ipaddress

from django.conf import settings
from django.http import JsonResponse
from django.utils.deprecation import MiddlewareMixin

ORIGIN_VERIFY_META = "HTTP_X_ORIGIN_VERIFY"
VIEWER_IP_META = "HTTP_X_VIEWER_IP"
FORWARDED_FOR_META = "HTTP_X_FORWARDED_FOR"

# 確認後に request.META から取り除くヘッダー
STRIPPED_META_KEYS = (ORIGIN_VERIFY_META, VIEWER_IP_META, FORWARDED_FOR_META)

FORBIDDEN_DETAIL = "このリクエストは許可されていない経路から送信されています。"


def parse_ip(value):
    """IP アドレスとして正しい値なら正規化した文字列を、そうでなければ None を返す。"""
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def _matches(supplied, secret):
    # 一致の判定にかかる時間から値を推測されないよう、一定時間で比較する
    return hmac.compare_digest(supplied.encode(), secret.encode())


class OriginVerifyMiddleware(MiddlewareMixin):
    """CloudFront からのリクエストかを確認し、閲覧者の IP アドレスを REMOTE_ADDR に設定する。"""

    def process_request(self, request):
        secret = getattr(settings, "ORIGIN_VERIFY_SECRET", "")
        if not secret:
            return None

        meta = request.META
        if not _matches(meta.get(ORIGIN_VERIFY_META, ""), secret):
            return JsonResponse({"detail": FORBIDDEN_DETAIL}, status=403)

        viewer_ip = parse_ip(meta.get(VIEWER_IP_META))
        if viewer_ip is not None:
            meta["REMOTE_ADDR"] = viewer_ip
        for key in STRIPPED_META_KEYS:
            meta.pop(key, None)
        return None
