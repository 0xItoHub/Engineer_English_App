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
