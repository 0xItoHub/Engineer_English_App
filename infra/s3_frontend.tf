locals {
  use_frontend = var.frontend_bucket_name != null && var.frontend_bucket_name != ""
}

resource "aws_s3_bucket" "frontend" {
  count  = local.use_frontend ? 1 : 0
  bucket = var.frontend_bucket_name
  force_destroy = true
}

resource "aws_s3_bucket_website_configuration" "frontend" {
  count  = local.use_frontend ? 1 : 0
  bucket = aws_s3_bucket.frontend[0].id
  index_document { suffix = "index.html" }
  error_document { key    = "index.html" } # SPA
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  count  = local.use_frontend ? 1 : 0
  bucket                  = aws_s3_bucket.frontend[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_policy" "frontend_public" {
  count  = local.use_frontend ? 1 : 0
  bucket = aws_s3_bucket.frontend[0].id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Sid      = "AllowCloudFrontAccess",
      Effect   = "Allow",
      Principal = { Service = "cloudfront.amazonaws.com" },
      Action   = ["s3:GetObject"],
      Resource = "${aws_s3_bucket.frontend[0].arn}/*",
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${aws_cloudfront_distribution.frontend[0].id}"
        }
      }
    }]
  })
  depends_on = [aws_cloudfront_distribution.frontend]
} 