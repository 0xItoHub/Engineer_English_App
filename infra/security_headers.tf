# CloudFront で付与するセキュリティ関連のレスポンスヘッダー
# - フロントエンド（S3）: HSTS などの基本ヘッダー + Content Security Policy（CSP）+ Permissions-Policy
# - API（/api/*）     : 基本ヘッダーのみ（JSON を返すため CSP は付与せず、Django が設定した値を優先する）
locals {
  cognito_idp_origin    = "https://cognito-idp.${var.aws_region}.amazonaws.com"
  cognito_domain_origin = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"

  # CSP の各ディレクティブ（同一オリジンを基本とし、外部は利用中のサービスのみ許可する）
  csp_directives = compact([
    # 個別に指定のない種類のリソースは同一オリジンのみ（manifest.json など）
    "default-src 'self'",
    # スクリプトは Vite がビルドした同一オリジンのファイルのみ（index.html にインラインスクリプトはない）
    "script-src 'self'",
    # MUI（Emotion）が実行時に <style> を挿入するため 'unsafe-inline' を許可し、Google Fonts の CSS を読み込む
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    # Web フォントは Google Fonts の配信元から読み込む
    "font-src 'self' https://fonts.gstatic.com",
    # 画像は /images 配下などの同一オリジンと、data: URI（インライン画像）のみ
    "img-src 'self' data:",
    # API（同一オリジンの /api）と、Cognito の OIDC 設定・JWKS（cognito-idp）・トークン発行（ドメイン）
    "connect-src 'self' ${local.cognito_idp_origin} ${local.cognito_domain_origin}",
    # 他サイトの iframe への埋め込みを禁止する
    "frame-ancestors 'none'",
    # <base> タグによる相対 URL の書き換えを同一オリジンに限定する
    "base-uri 'self'",
    # フォームの送信先は同一オリジンのみ（ログインは Cognito への画面遷移で行う）
    "form-action 'self'",
    # プラグイン（<object> / <embed>）は使わない
    "object-src 'none'",
    # HTTP の読み込みを HTTPS に切り替える（レポートのみのモードでは無視されるため、適用時のみ付与する）
    var.csp_enforce ? "upgrade-insecure-requests" : "",
    # 違反内容の送信先（Django の /api/csp-report/ で受け取り、ログに記録する）
    "report-uri /api/csp-report/",
  ])
  content_security_policy = join("; ", local.csp_directives)

  # ブラウザの機能のうち、アプリで使わないものを無効にする（音声の読み上げ speechSynthesis は対象外のため影響しない）
  permissions_policy = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
}

resource "aws_cloudfront_response_headers_policy" "frontend" {
  count   = local.use_frontend ? 1 : 0
  name    = "${var.project_name}-frontend-security-headers"
  comment = "Security headers and CSP for ${var.project_name} frontend"

  security_headers_config {
    # HTTPS のみで接続させる（1 年間、サブドメインを含む）
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    # csp_enforce=true のときは Content-Security-Policy ヘッダーとして適用する
    dynamic "content_security_policy" {
      for_each = var.csp_enforce ? [1] : []
      content {
        content_security_policy = local.content_security_policy
        override                = true
      }
    }
  }

  custom_headers_config {
    # csp_enforce=false（既定）のときは、ブロックせずに違反の報告のみを行う
    dynamic "items" {
      for_each = var.csp_enforce ? [] : [1]
      content {
        header   = "Content-Security-Policy-Report-Only"
        value    = local.content_security_policy
        override = true
      }
    }
    items {
      header   = "Permissions-Policy"
      value    = local.permissions_policy
      override = true
    }
  }
}

resource "aws_cloudfront_response_headers_policy" "api" {
  count   = local.use_frontend ? 1 : 0
  name    = "${var.project_name}-api-security-headers"
  comment = "Security headers for ${var.project_name} API"

  # Django（SecurityMiddleware など）が設定したヘッダーがあればそちらを優先する（override = false）
  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = false
    }
    content_type_options {
      override = false
    }
    frame_options {
      frame_option = "DENY"
      override     = false
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = false
    }
  }
}
