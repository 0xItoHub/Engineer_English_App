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