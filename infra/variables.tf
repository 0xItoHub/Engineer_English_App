variable "project_name" {
  type = string
}

variable "aws_region" {
  type    = string
  default = "ap-northeast-1"
}

variable "lambda_image_uri" {
  type = string # 例: xxxxxxxx.dkr.ecr.ap-northeast-1.amazonaws.com/ee-backend:latest
}

variable "frontend_bucket_name" {
  type    = string
  default = null # S3を使う場合のみ指定
}

variable "django_debug" {
  type    = string
  default = "False"
}

variable "allowed_hosts" {
  type        = string
  default     = ""
  description = "カンマ区切り。空なら API Gateway のホスト名を使用"
}

variable "cors_allowed_origins" {
  type        = string
  default     = ""
  description = "カンマ区切り。空なら CloudFront（フロントエンド）のオリジンを使用"
}

variable "secret_key_ssm_param_name" {
  type        = string
  description = "Django SECRET_KEY を保存した SSM SecureString パラメータ名"
}

# 重要: SQLite実体の保存先（Lambdaの書込可能領域）
variable "sqlite_path" {
  type    = string
  default = "/tmp/db.sqlite3"
}

# 初回起動時に seed_db.sqlite3 を /tmp にコピーするか（lambda.py で利用）
variable "startup_copy_seed_db" {
  type    = string
  default = "1"
}

variable "api_throttling_burst_limit" {
  type        = number
  default     = 50
  description = "API Gateway のバースト上限（リクエスト数）。デモ用途に合わせ、処理量の上限を抑える"
}

variable "api_throttling_rate_limit" {
  type        = number
  default     = 20
  description = "API Gateway の定常上限（リクエスト/秒）"
}

variable "origin_verify_enforced" {
  type        = bool
  default     = true
  description = "Lambda に ORIGIN_VERIFY_SECRET を渡し、CloudFront を経由しない API へのアクセスを 403 にする。秘密の値の更新時は一時的に false にする（infra/README.md 参照）"
}

variable "enable_local_callbacks" {
  type        = bool
  default     = false
  description = "Cognito のアプリクライアントにローカル開発用（http://localhost:3000）の URL を登録する"
}

variable "csp_enforce" {
  type        = bool
  default     = false
  description = "true にすると CSP を Content-Security-Policy として適用する。false（既定）は Content-Security-Policy-Report-Only で違反の報告のみ行う"
}

# データベースロールの分離（infra/README.md の「データベースロールの分離」参照）
variable "web_db_user" {
  type        = string
  default     = "app_rw"
  description = "Web 用の Lambda が接続するデータベースロール。既定は DML のみの実行時ロール app_rw。ロール分離への移行中は app を指定する（infra/README.md 参照）"

  validation {
    condition     = can(regex("^[a-z_][a-z0-9_]{0,62}$", var.web_db_user)) && var.web_db_user != "admin"
    error_message = "web_db_user は英小文字・数字・_ で指定してください（admin 以外）。"
  }
}

variable "runtime_db_user" {
  type        = string
  default     = "app_rw"
  description = "管理専用の Lambda（migrator）が DML の権限を付与する実行時ロール"

  validation {
    condition     = can(regex("^[a-z_][a-z0-9_]{0,62}$", var.runtime_db_user)) && var.runtime_db_user != "admin"
    error_message = "runtime_db_user は英小文字・数字・_ で指定してください（admin 以外）。"
  }
}

variable "migrator_db_user" {
  type        = string
  default     = "app"
  description = "管理専用の Lambda（migrator）が接続するデータベースロール（テーブルの所有者）"

  validation {
    condition     = can(regex("^[a-z_][a-z0-9_]{0,62}$", var.migrator_db_user)) && var.migrator_db_user != "admin"
    error_message = "migrator_db_user は英小文字・数字・_ で指定してください（admin 以外）。"
  }
}

# Aurora DSQL のバックアップ（backup.tf）
variable "enable_backup" {
  type        = bool
  default     = false
  description = "true にすると AWS Backup で Aurora DSQL クラスターを毎日バックアップする"
}

variable "backup_retention_days" {
  type        = number
  default     = 14
  description = "バックアップの保持日数"

  validation {
    condition     = var.backup_retention_days >= 1
    error_message = "backup_retention_days は 1 以上を指定してください。"
  }
}
