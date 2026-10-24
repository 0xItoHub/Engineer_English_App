# デプロイ自動化・監視まわりの変数（いずれも既定値では無効＝追加リソースなし）

# ------------------------------------------------------------
# GitHub Actions（OIDC）デプロイロール
# ------------------------------------------------------------
variable "enable_github_deploy" {
  type        = bool
  default     = false
  description = "true にすると GitHub Actions から OIDC で引き受けるデプロイ用 IAM ロールを作成する"
}

variable "github_repository" {
  type        = string
  default     = "0xItoHub/Engineer_English_App"
  description = "デプロイを許可する GitHub リポジトリ（owner/repo 形式）"
}

variable "github_environment" {
  type        = string
  default     = "production"
  description = "デプロイを許可する GitHub Environment 名。空文字なら main ブランチ（ref）からの実行のみ許可"
}

variable "github_oidc_provider_arn" {
  type        = string
  default     = ""
  description = "既存の GitHub OIDC プロバイダの ARN。空文字なら（enable_github_deploy=true のとき）新規作成する"
}

variable "ecr_repository_name" {
  type        = string
  default     = "ee-backend"
  description = "バックエンドのコンテナイメージを格納する ECR リポジトリ名（このTF構成の管理外）"
}
