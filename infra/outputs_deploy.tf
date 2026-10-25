output "github_deploy_role_arn" {
  value       = try(aws_iam_role.github_deploy[0].arn, null)
  description = "GitHub Actions のデプロイ用ロール ARN（リポジトリ変数 AWS_DEPLOY_ROLE_ARN に設定する）"
}

output "lambda_function_name" {
  value       = aws_lambda_function.backend.function_name
  description = "バックエンドの Lambda 関数名（リポジトリ変数 LAMBDA_FUNCTION_NAME に設定する）"
}

output "migrator_function_name" {
  value       = aws_lambda_function.migrator.function_name
  description = "管理専用の Lambda 関数名（migrate / seed / grant_runtime の実行先。リポジトリ変数 MIGRATOR_FUNCTION_NAME に設定する）"
}

# データベースロールと IAM ロールの対応付け（AWS IAM GRANT）に使う値
output "lambda_exec_role_arn" {
  value       = aws_iam_role.lambda_exec.arn
  description = "Web 用の Lambda の実行ロール ARN（実行時ロール app_rw に対応付ける）"
}

output "migrator_role_arn" {
  value       = aws_iam_role.migrator_exec.arn
  description = "管理専用の Lambda の実行ロール ARN（所有者ロール app に対応付ける）"
}

output "backup_vault_name" {
  value       = try(aws_backup_vault.dsql[0].name, null)
  description = "Aurora DSQL のバックアップ保管庫名（enable_backup=true のときのみ出力）"
}

output "backup_role_arn" {
  value       = try(aws_iam_role.backup[0].arn, null)
  description = "AWS Backup のバックアップ・復元に使う IAM ロール ARN（enable_backup=true のときのみ出力）"
}
