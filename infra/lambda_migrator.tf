# 管理専用の Lambda（migrator）
# - Web 用の関数と同じコンテナイメージを使い、環境変数 MANAGE_ONLY=1 で管理操作（{"manage": ...}）のみ受け付ける
# - テーブルの所有者ロール（migrator_db_user、既定 app）で接続し、migrate / seed / grant_runtime を実行する
# - API Gateway とは接続せず、lambda:InvokeFunction 権限を持つ運用者の直接呼び出しでのみ動作する
# Web 用の関数は DML のみの実行時ロール（web_db_user、既定 app_rw）で接続するため、DDL を実行できない。

resource "aws_iam_role" "migrator_exec" {
  name = "${var.project_name}-migrator-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "migrator_logs" {
  role       = aws_iam_role.migrator_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# SECRET_KEY（SSM SecureString）の読み取り権限（Django の起動に使用）
resource "aws_iam_role_policy" "migrator_read_secret_key" {
  name = "${var.project_name}-migrator-read-secret-key"
  role = aws_iam_role.migrator_exec.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect   = "Allow",
      Action   = "ssm:GetParameter",
      Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${trimprefix(var.secret_key_ssm_param_name, "/")}"
    }]
  })
}

# DSQL へ接続する権限（所有者ロールでの接続。管理者 admin での接続は許可しない）
resource "aws_iam_role_policy" "migrator_dsql_connect" {
  name = "${var.project_name}-migrator-dsql-connect"
  role = aws_iam_role.migrator_exec.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect   = "Allow",
      Action   = "dsql:DbConnect",
      Resource = aws_dsql_cluster.main.arn
    }]
  })
}

resource "aws_lambda_function" "migrator" {
  function_name = "${var.project_name}-migrator"
  package_type  = "Image"
  image_uri     = var.lambda_image_uri
  role          = aws_iam_role.migrator_exec.arn
  # DSQL の DDL は 1 トランザクションに 1 文ずつ実行するため、migrate に余裕を持たせる
  timeout     = 300
  memory_size = 512

  environment {
    variables = {
      DJANGO_SETTINGS_MODULE      = "engineer_english.settings"
      DJANGO_DEBUG                = "False"
      DJANGO_SECRET_KEY_SSM_PARAM = var.secret_key_ssm_param_name
      DSQL_CLUSTER_ENDPOINT       = local.dsql_endpoint
      # テーブルの所有者ロールで接続し、Web 用の実行時ロールに DML の権限を付与する
      DSQL_DB_USER         = var.migrator_db_user
      DSQL_RUNTIME_DB_USER = var.runtime_db_user
      # 管理操作のみ受け付ける（HTTP のリクエストは処理しない）
      MANAGE_ONLY = "1"
    }
  }

  # Web 用の関数と同じく、イメージは GitHub Actions（deploy.yml）が更新する
  lifecycle {
    ignore_changes = [image_uri]
  }
}
