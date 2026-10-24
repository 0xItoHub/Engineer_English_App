# 監視設定（いずれも既定では無効）
# - manage_lambda_log_group=true : Lambda ロググループの保持期間を Terraform で管理
# - enable_monitoring=true       : CloudWatch アラーム + SNS 通知（alarm_email 指定時はメール購読も作成）

# Lambda のロググループ（Lambda が自動作成したものを import して保持期間を設定する）
resource "aws_cloudwatch_log_group" "lambda" {
  count             = var.manage_lambda_log_group ? 1 : 0
  name              = "/aws/lambda/${aws_lambda_function.backend.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_sns_topic" "alarms" {
  count = var.enable_monitoring ? 1 : 0
  name  = "${var.project_name}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.enable_monitoring && var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarm_actions = var.enable_monitoring ? [aws_sns_topic.alarms[0].arn] : []
}

# Lambda の実行エラー（5分間に1件以上）
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  count               = var.enable_monitoring ? 1 : 0
  alarm_name          = "${var.project_name}-lambda-errors"
  alarm_description   = "Lambda ${aws_lambda_function.backend.function_name} でエラーが発生"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.backend.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# Lambda のスロットリング（5分間に1件以上）
resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  count               = var.enable_monitoring ? 1 : 0
  alarm_name          = "${var.project_name}-lambda-throttles"
  alarm_description   = "Lambda ${aws_lambda_function.backend.function_name} でスロットリングが発生"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = aws_lambda_function.backend.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# API Gateway（HTTP API）の 5xx 応答（5分間に1件以上）
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  count             = var.enable_monitoring ? 1 : 0
  alarm_name        = "${var.project_name}-api-5xx"
  alarm_description = "API Gateway ${aws_apigatewayv2_api.http_api.name} で 5xx 応答が発生"
  namespace         = "AWS/ApiGateway"
  metric_name       = "5xx"
  dimensions = {
    ApiId = aws_apigatewayv2_api.http_api.id
    Stage = aws_apigatewayv2_stage.default.name
  }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}
