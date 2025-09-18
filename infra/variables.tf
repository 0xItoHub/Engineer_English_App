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
  type    = string
  default = "*"
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