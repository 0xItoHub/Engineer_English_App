resource "aws_cloudfront_origin_access_control" "frontend_oac" {
  count                             = local.use_frontend ? 1 : 0
  name                              = "${var.project_name}-frontend-oac"
  description                       = "OAC for ${var.project_name} frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# SPA のルーティング用: 拡張子のないパス（/scene/1 など）は index.html を返す
resource "aws_cloudfront_function" "spa_rewrite" {
  count   = local.use_frontend ? 1 : 0
  name    = "${var.project_name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite SPA routes to /index.html"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var lastSegment = request.uri.split("/").pop();
      if (lastSegment.indexOf(".") === -1) {
        request.uri = "/index.html";
      }
      return request;
    }
  EOT
}

# /api/* の閲覧者リクエスト: 閲覧者の IP アドレスを X-Viewer-IP に設定する。
# 閲覧者が送った X-Viewer-IP / X-Origin-Verify は取り除き、CloudFront が設定した値のみを API に渡す
# （X-Origin-Verify はこの後、オリジンのカスタムヘッダーとして CloudFront が付与する）。
resource "aws_cloudfront_function" "api_viewer_ip" {
  count   = local.use_frontend ? 1 : 0
  name    = "${var.project_name}-api-viewer-ip"
  runtime = "cloudfront-js-2.0"
  comment = "Set X-Viewer-IP for API requests"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      delete request.headers["x-origin-verify"];
      request.headers["x-viewer-ip"] = { value: event.viewer.ip };
      return request;
    }
  EOT
}

# CloudFront から API Gateway への転送であることを確認するための秘密の値。
# 値は state にのみ保存され、plan / apply の出力には表示されない（sensitive）。
resource "random_password" "origin_verify" {
  count   = local.use_frontend ? 1 : 0
  length  = 48
  special = false
}

# API はキャッシュせず、Host ヘッダー以外のリクエスト情報をそのまま転送する
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_distribution" "frontend" {
  count   = local.use_frontend ? 1 : 0
  enabled = true

  aliases             = []
  comment             = "${var.project_name} frontend"
  default_root_object = "index.html"
  price_class         = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.frontend[0].bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend_oac[0].id
  }

  # /api/* は API Gateway へ転送し、フロントエンドと同一オリジンで配信する
  origin {
    domain_name = local.api_host
    origin_id   = "api-gateway"

    # API（Django の core.middleware）は、この値が一致するリクエストのみを処理する
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify[0].result
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api-gateway"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
    # セキュリティ関連のレスポンスヘッダー（security_headers.tf）
    response_headers_policy_id = aws_cloudfront_response_headers_policy.api[0].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api_viewer_ip[0].arn
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    # セキュリティ関連のレスポンスヘッダーと CSP（security_headers.tf）
    response_headers_policy_id = aws_cloudfront_response_headers_policy.frontend[0].id

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
    compress    = true
    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite[0].arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
      locations        = []
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
