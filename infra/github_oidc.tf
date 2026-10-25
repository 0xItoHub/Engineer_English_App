# GitHub Actions から OIDC で引き受けるデプロイ用ロール（enable_github_deploy=true のときのみ作成）
# 権限はアプリのデプロイ（イメージ push / Lambda 更新 / フロント配信）に限定し、
# インフラ変更（terraform apply）は従来どおり手動で行う。

locals {
  create_github_oidc_provider = var.enable_github_deploy && var.github_oidc_provider_arn == ""
  github_oidc_provider_arn = var.enable_github_deploy ? (
    local.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : var.github_oidc_provider_arn
  ) : null

  # 引き受けを許可する OIDC トークンの sub クレーム
  github_deploy_subjects = concat(
    ["repo:${var.github_repository}:ref:refs/heads/main"],
    var.github_environment != "" ? ["repo:${var.github_repository}:environment:${var.github_environment}"] : []
  )

  ecr_repository_arn = "arn:aws:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/${var.ecr_repository_name}"
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = local.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # GitHub の OIDC は AWS 側で信頼済み CA により検証される。
  # 古いプロバイダバージョンとの互換のため、GitHub が公開している既知のサムプリントを指定しておく。
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

resource "aws_iam_role" "github_deploy" {
  count = var.enable_github_deploy ? 1 : 0
  name  = "${var.project_name}-github-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Federated = local.github_oidc_provider_arn },
      Action    = "sts:AssumeRoleWithWebIdentity",
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = local.github_deploy_subjects
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  count = var.enable_github_deploy ? 1 : 0
  name  = "${var.project_name}-github-deploy"
  role  = aws_iam_role.github_deploy[0].id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = concat(
      [
        {
          Sid      = "EcrLogin",
          Effect   = "Allow",
          Action   = "ecr:GetAuthorizationToken",
          Resource = "*"
        },
        {
          Sid    = "EcrPushBackendImage",
          Effect = "Allow",
          Action = [
            "ecr:BatchCheckLayerAvailability",
            "ecr:BatchGetImage",
            "ecr:CompleteLayerUpload",
            "ecr:DescribeImages",
            "ecr:GetDownloadUrlForLayer",
            "ecr:InitiateLayerUpload",
            "ecr:PutImage",
            "ecr:UploadLayerPart",
          ],
          Resource = local.ecr_repository_arn
        },
        {
          Sid    = "UpdateLambdaCode",
          Effect = "Allow",
          Action = [
            "lambda:GetFunction",
            "lambda:GetFunctionConfiguration",
            "lambda:UpdateFunctionCode",
          ],
          # Web 用の関数と管理専用の関数（同じイメージ）
          Resource = [aws_lambda_function.backend.arn, aws_lambda_function.migrator.arn]
        },
      ],
      # フロントエンド（S3 + CloudFront）を使う構成のときのみ付与
      [for stmt in [
        {
          Sid      = "ListFrontendBucket",
          Effect   = "Allow",
          Action   = "s3:ListBucket",
          Resource = try(aws_s3_bucket.frontend[0].arn, "")
        },
        {
          Sid      = "WriteFrontendObjects",
          Effect   = "Allow",
          Action   = ["s3:PutObject", "s3:DeleteObject"],
          Resource = "${try(aws_s3_bucket.frontend[0].arn, "")}/*"
        },
        {
          Sid      = "InvalidateFrontendCache",
          Effect   = "Allow",
          Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
          Resource = try(aws_cloudfront_distribution.frontend[0].arn, "")
        },
      ] : stmt if local.use_frontend]
    )
  })
}
