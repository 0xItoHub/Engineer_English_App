# Aurora DSQL（サーバーレスの分散 SQL データベース）
# 学習コンテンツとユーザーごとの学習進捗を保存する。接続は IAM 認証（パスワード不要）
resource "aws_dsql_cluster" "main" {
  deletion_protection_enabled = true

  tags = {
    Name    = "${var.project_name}-db"
    Project = var.project_name
  }
}

locals {
  dsql_endpoint = "${aws_dsql_cluster.main.identifier}.dsql.${var.aws_region}.on.aws"
}

# Lambda から DSQL へ接続する権限（アプリ用のデータベースロールでの接続のみ。管理者接続は許可しない）
resource "aws_iam_role_policy" "lambda_dsql_connect" {
  name = "${var.project_name}-dsql-connect"
  role = aws_iam_role.lambda_exec.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect   = "Allow",
      Action   = "dsql:DbConnect",
      Resource = aws_dsql_cluster.main.arn
    }]
  })
}
