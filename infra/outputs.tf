output "api_invoke_url" {
  value = aws_apigatewayv2_api.http_api.api_endpoint
}

output "frontend_website_url" {
  value       = try(aws_s3_bucket_website_configuration.frontend[0].website_endpoint, null)
  description = "S3を使う場合のみ出力"
}

output "cloudfront_domain_name" {
  value       = try(aws_cloudfront_distribution.frontend[0].domain_name, null)
  description = "CloudFrontを使う場合のみ出力"
}

output "cloudfront_distribution_id" {
  value       = try(aws_cloudfront_distribution.frontend[0].id, null)
  description = "CloudFrontを使う場合のみ出力"
}
output "dsql_endpoint" {
  value       = local.dsql_endpoint
  description = "Aurora DSQL のエンドポイント"
}

# フロントエンドのビルド時に使う値（VITE_COGNITO_*）
output "cognito_authority" {
  value = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "cognito_domain" {
  value = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}
