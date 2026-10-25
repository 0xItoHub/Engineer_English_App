# 環境ごとの設定は変数で管理（未指定時は同じ構成内のリソースから導出）
locals {
  api_host             = replace(aws_apigatewayv2_api.http_api.api_endpoint, "https://", "")
  allowed_hosts        = var.allowed_hosts != "" ? var.allowed_hosts : local.api_host
  cors_allowed_origins = var.cors_allowed_origins != "" ? var.cors_allowed_origins : try("https://${aws_cloudfront_distribution.frontend[0].domain_name}", "")
  frontend_url         = try("https://${aws_cloudfront_distribution.frontend[0].domain_name}/", "")
}

resource "aws_lambda_function" "backend" {
  function_name = "${var.project_name}-api"
  package_type  = "Image"
  image_uri     = var.lambda_image_uri
  role          = aws_iam_role.lambda_exec.arn
  timeout       = 30
  memory_size   = 512

  environment {
    variables = {
      DJANGO_SETTINGS_MODULE      = "engineer_english.settings"
      DJANGO_DEBUG                = var.django_debug
      DJANGO_ALLOWED_HOSTS        = local.allowed_hosts
      DJANGO_CORS_ALLOWED_ORIGINS = local.cors_allowed_origins
      # API のトップ（/）へのアクセスの転送先
      DJANGO_FRONTEND_URL = local.frontend_url
      # SECRET_KEY の値は SSM Parameter Store に置き、ここではパラメータ名のみ渡す
      DJANGO_SECRET_KEY_SSM_PARAM = var.secret_key_ssm_param_name
      # Cognito のアクセストークン検証に使う値（いずれも公開情報）
      COGNITO_USER_POOL_ID  = aws_cognito_user_pool.main.id
      COGNITO_APP_CLIENT_ID = aws_cognito_user_pool_client.spa.id
      # Aurora DSQL のエンドポイント（接続はアプリ用ロールで IAM 認証）
      DSQL_CLUSTER_ENDPOINT = local.dsql_endpoint
      SQLITE_PATH           = var.sqlite_path
      STARTUP_COPY_SEED_DB  = var.startup_copy_seed_db
    }
  }

  # イメージの更新は GitHub Actions（.github/workflows/deploy.yml）が SHA タグ／ダイジェスト指定で行う。
  # CI でデプロイしたイメージを Terraform が lambda_image_uri の値に戻さないよう、image_uri は差分対象外とする。
  # 手動でイメージを切り替える場合は aws lambda update-function-code を使う（infra/README.md 参照）。
  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_apigatewayv2_api" "http_api" {
  name          = "${var.project_name}-httpapi"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda_proxy" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.backend.arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda_proxy.id}"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGWInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true

  # スロットリングの上限を明示（未指定時は 0 として扱われるため）
  default_route_settings {
    throttling_burst_limit = var.api_throttling_burst_limit
    throttling_rate_limit  = var.api_throttling_rate_limit
  }
} 