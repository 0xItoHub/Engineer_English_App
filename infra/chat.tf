# AI チャット（chat_provider を disabled 以外にした場合のみ、環境変数と権限を追加する）

locals {
  chat_enabled = var.chat_provider != "disabled"

  chat_env_values = {
    CHAT_PROVIDER           = var.chat_provider
    CHAT_MODEL              = var.chat_model
    CHAT_API_BASE_URL       = var.chat_api_base_url
    CHAT_API_KEY_SSM_PARAM  = var.chat_api_key_ssm_param_name
    CHAT_MAX_INPUT_CHARS    = tostring(var.chat_max_input_chars)
    CHAT_MAX_OUTPUT_TOKENS  = tostring(var.chat_max_output_tokens)
    CHAT_MAX_HISTORY        = tostring(var.chat_max_history)
    CHAT_USER_DAILY_LIMIT   = tostring(var.chat_user_daily_limit)
    CHAT_GLOBAL_DAILY_LIMIT = tostring(var.chat_global_daily_limit)
    CHAT_TIMEOUT_SECONDS    = tostring(var.chat_timeout_seconds)
    DJANGO_THROTTLE_CHAT    = var.chat_throttle_rate
  }

  # Web 用の Lambda に追加する環境変数（無効の場合は空のため、既存の環境変数は変わらない）
  chat_lambda_env = { for name, value in local.chat_env_values : name => value if local.chat_enabled }

  chat_api_key_param_arn = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${trimprefix(var.chat_api_key_ssm_param_name, "/")}"
}

# API キー（SSM SecureString）の読み取り権限（パラメータ名を指定した場合のみ）
resource "aws_iam_role_policy" "lambda_read_chat_api_key" {
  count = var.chat_api_key_ssm_param_name != "" ? 1 : 0

  name = "${var.project_name}-read-chat-api-key"
  role = aws_iam_role.lambda_exec.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect   = "Allow",
      Action   = "ssm:GetParameter",
      Resource = local.chat_api_key_param_arn
    }]
  })
}

# Amazon Bedrock の呼び出し権限（Converse API は bedrock:InvokeModel で許可する）。
# 対象は chat_bedrock_resource_arns に指定したモデル・推論プロファイルのみ。
resource "aws_iam_role_policy" "lambda_invoke_bedrock" {
  count = var.chat_provider == "bedrock" && length(var.chat_bedrock_resource_arns) > 0 ? 1 : 0

  name = "${var.project_name}-invoke-bedrock-chat"
  role = aws_iam_role.lambda_exec.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect   = "Allow",
      Action   = "bedrock:InvokeModel",
      Resource = var.chat_bedrock_resource_arns
    }]
  })
}
