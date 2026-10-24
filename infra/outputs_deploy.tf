output "github_deploy_role_arn" {
  value       = try(aws_iam_role.github_deploy[0].arn, null)
  description = "GitHub Actions のデプロイ用ロール ARN（リポジトリ変数 AWS_DEPLOY_ROLE_ARN に設定する）"
}

output "lambda_function_name" {
  value       = aws_lambda_function.backend.function_name
  description = "バックエンドの Lambda 関数名（リポジトリ変数 LAMBDA_FUNCTION_NAME に設定する）"
}
