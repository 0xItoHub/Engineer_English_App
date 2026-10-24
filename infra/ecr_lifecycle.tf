# ECR リポジトリのライフサイクルポリシー（manage_ecr_lifecycle=true のときのみ設定）
# リポジトリ自体はこの構成の管理外のため、名前（ecr_repository_name）で指定する。
#
# ルールは rulePriority の小さい順に評価され、上位ルールのタグ条件に一致したイメージは
# 下位ルールでは削除されない。これを利用して rollback- タグのイメージを常に保持する。
resource "aws_ecr_lifecycle_policy" "backend" {
  count      = var.manage_ecr_lifecycle ? 1 : 0
  repository = var.ecr_repository_name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1,
        description  = "rollback- で始まるタグのイメージは常に保持",
        selection = {
          tagStatus     = "tagged",
          tagPrefixList = ["rollback-"],
          countType     = "imageCountMoreThan",
          countNumber   = 9999
        },
        action = { type = "expire" }
      },
      {
        rulePriority = 2,
        description  = "タグなしイメージは ${var.ecr_untagged_expire_days} 日後に削除",
        selection = {
          tagStatus   = "untagged",
          countType   = "sinceImagePushed",
          countUnit   = "days",
          countNumber = var.ecr_untagged_expire_days
        },
        action = { type = "expire" }
      },
      {
        rulePriority = 3,
        description  = "タグ付きイメージは新しい ${var.ecr_keep_image_count} 件を保持",
        selection = {
          tagStatus      = "tagged",
          tagPatternList = ["*"],
          countType      = "imageCountMoreThan",
          countNumber    = var.ecr_keep_image_count
        },
        action = { type = "expire" }
      },
    ]
  })
}
