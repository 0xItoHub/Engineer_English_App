# Terraform リモートステート（S3）
# ロックは S3 ネイティブ機能（use_lockfile）を使用 — DynamoDB は不要（Terraform 1.10+）。
# 注: backend ブロックの値は変数を使えないためリテラル。いずれも機密ではない（バケットは公開ブロック済み）。
terraform {
  backend "s3" {
    bucket       = "ee-sqlite-demo-tfstate"
    key          = "ee-sqlite-demo/terraform.tfstate"
    region       = "ap-northeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
