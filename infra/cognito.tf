# Amazon Cognito（ユーザー登録・ログイン）
# マネージドログイン（Cognito がホストするログイン画面）と、SPA 向けの認可コードフロー（PKCE）を使う
locals {
  # ドメインのプレフィックス（リージョン内で一意。アカウント情報を含めないようハッシュで生成）
  cognito_domain_prefix = "${var.project_name}-${substr(sha256("${var.project_name}-${data.aws_caller_identity.current.account_id}"), 0, 8)}"
  frontend_origin       = try("https://${aws_cloudfront_distribution.frontend[0].domain_name}", "")
}

resource "aws_cognito_user_pool" "main" {
  name                = "${var.project_name}-users"
  user_pool_tier      = "ESSENTIALS"
  deletion_protection = "ACTIVE"

  # メールアドレスでサインインし、登録時にメールで確認する
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 3
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  tags = {
    Project = var.project_name
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  domain                = local.cognito_domain_prefix
  user_pool_id          = aws_cognito_user_pool.main.id
  managed_login_version = 2
}

# SPA 用のアプリクライアント（クライアントシークレットなし・認可コード + PKCE）
resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.project_name}-spa"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]

  # ローカル開発用の URL は enable_local_callbacks=true のときだけ登録する
  callback_urls = compact([
    local.frontend_origin != "" ? "${local.frontend_origin}/auth/callback" : "",
    var.enable_local_callbacks ? "http://localhost:3000/auth/callback" : "",
  ])
  logout_urls = compact([
    local.frontend_origin != "" ? "${local.frontend_origin}/" : "",
    var.enable_local_callbacks ? "http://localhost:3000/" : "",
  ])

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 7
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  enable_token_revocation       = true
  prevent_user_existence_errors = "ENABLED"
}

# マネージドログインの画面（Cognito 標準のデザインを使用）
resource "aws_cognito_managed_login_branding" "spa" {
  user_pool_id                = aws_cognito_user_pool.main.id
  client_id                   = aws_cognito_user_pool_client.spa.id
  use_cognito_provided_values = true
}
