# AI チャットの設定（既定は無効。有効化の手順は infra/README.md「AI チャットの有効化」を参照）
# 既定値のままであれば、Lambda の環境変数・IAM ポリシーは追加されない。

variable "chat_provider" {
  type        = string
  default     = "disabled"
  description = "AI チャットの接続先: disabled（無効）/ gemini / openai_compatible / bedrock"
  validation {
    condition     = contains(["disabled", "gemini", "openai_compatible", "bedrock"], var.chat_provider)
    error_message = "chat_provider は disabled / gemini / openai_compatible / bedrock のいずれかを指定してください。"
  }
}

variable "chat_model" {
  type        = string
  default     = ""
  description = "モデル名（空ならアプリの既定値: gemini は gemini-3.5-flash-lite、bedrock は apac.amazon.nova-micro-v1:0）"
}

variable "chat_api_base_url" {
  type        = string
  default     = ""
  description = "openai_compatible の接続先（/chat/completions の手前まで。例: https://api.openai.com/v1）"
  validation {
    condition     = var.chat_api_base_url == "" || startswith(var.chat_api_base_url, "https://")
    error_message = "chat_api_base_url は https:// で始まる URL を指定してください。"
  }
}

variable "chat_api_key_ssm_param_name" {
  type        = string
  default     = ""
  description = "API キーを保存した SSM SecureString のパラメータ名（gemini / openai_compatible で使用）。値は Terraform で扱わない"
}

variable "chat_bedrock_resource_arns" {
  type        = list(string)
  default     = []
  description = "bedrock で呼び出しを許可するモデル・推論プロファイルの ARN（推論プロファイルの場合は、転送先リージョンのモデルの ARN も含める）"
  validation {
    condition     = alltrue([for arn in var.chat_bedrock_resource_arns : startswith(arn, "arn:aws:bedrock:") && arn != "*"])
    error_message = "chat_bedrock_resource_arns には arn:aws:bedrock: で始まる ARN を指定してください（\"*\" は指定できません）。"
  }
}

variable "chat_max_input_chars" {
  type        = number
  default     = 500
  description = "質問 1 件の最大文字数"
}

variable "chat_max_output_tokens" {
  type        = number
  default     = 300
  description = "回答の最大トークン数"
}

variable "chat_max_history" {
  type        = number
  default     = 6
  description = "1 回の質問で送る会話の履歴の最大件数（質問と回答の合計）"
}

variable "chat_user_daily_limit" {
  type        = number
  default     = 20
  description = "1 ユーザーあたりの 1 日（日本時間）の質問回数の上限"
}

variable "chat_global_daily_limit" {
  type        = number
  default     = 200
  description = "全ユーザー合計の 1 日（日本時間）の質問回数の上限"
}

variable "chat_timeout_seconds" {
  type        = number
  default     = 20
  description = "接続先の応答を待つ時間（秒）。API Gateway の統合のタイムアウト（30 秒）より短くする"
  validation {
    condition     = var.chat_timeout_seconds >= 1 && var.chat_timeout_seconds <= 25
    error_message = "chat_timeout_seconds は 1〜25 の範囲で指定してください。"
  }
}

variable "chat_throttle_rate" {
  type        = string
  default     = "6/min"
  description = "1 ユーザーあたりの短時間の質問回数の上限（Lambda のインスタンス単位）"
}
