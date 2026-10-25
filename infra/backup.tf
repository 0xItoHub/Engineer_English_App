# Aurora DSQL のバックアップ（AWS Backup、enable_backup=true のときのみ作成）
# - 毎日 03:00（日本時間）にクラスター全体のフルバックアップを取得し、backup_retention_days 日保持する
# - 復元は常に新しいクラスターとして作成される（手順は infra/README.md の「Aurora DSQL のバックアップと復元」）
# - バックアップは AWS Backup が管理し、保管庫の暗号化キー（既定は AWS マネージドキー aws/backup）で暗号化される

resource "aws_backup_vault" "dsql" {
  count = var.enable_backup ? 1 : 0
  name  = "${var.project_name}-dsql-backup"

  tags = {
    Project = var.project_name
  }
}

# AWS Backup がバックアップ・復元を実行するときに引き受けるロール
resource "aws_iam_role" "backup" {
  count = var.enable_backup ? 1 : 0
  name  = "${var.project_name}-backup"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "backup.amazonaws.com" },
      Action    = "sts:AssumeRole"
    }]
  })
}

# AWS 管理ポリシーに Aurora DSQL のバックアップ（dsql:StartBackupJob など）と
# 復元（dsql:StartRestoreJob / dsql:CreateCluster など）に必要な権限が含まれる
resource "aws_iam_role_policy_attachment" "backup_service" {
  count      = var.enable_backup ? 1 : 0
  role       = aws_iam_role.backup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "backup_restores" {
  count      = var.enable_backup ? 1 : 0
  role       = aws_iam_role.backup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

resource "aws_backup_plan" "dsql" {
  count = var.enable_backup ? 1 : 0
  name  = "${var.project_name}-dsql-daily"

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.dsql[0].name
    # 毎日 18:00 UTC（日本時間 03:00）。利用の少ない時間帯に取得する
    schedule          = "cron(0 18 * * ? *)"
    start_window      = 60  # 予定時刻から開始までの猶予（分）
    completion_window = 180 # 開始から完了までの猶予（分）

    lifecycle {
      delete_after = var.backup_retention_days
    }
  }

  tags = {
    Project = var.project_name
  }
}

resource "aws_backup_selection" "dsql" {
  count        = var.enable_backup ? 1 : 0
  name         = "${var.project_name}-dsql"
  plan_id      = aws_backup_plan.dsql[0].id
  iam_role_arn = aws_iam_role.backup[0].arn
  resources    = [aws_dsql_cluster.main.arn]
}
