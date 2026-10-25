# インフラ運用手順

このディレクトリの Terraform で、バックエンド（Lambda + API Gateway）とフロントエンド（S3 + CloudFront）を管理しています。
ここでは、GitHub Actions による自動デプロイ・監視・ECR ライフサイクルの有効化手順と、日々の運用手順をまとめます。

追加機能はいずれも **既定では無効**（変数のフラグで opt-in）です。フラグを有効にしない限り、既存リソースへの変更や追加費用は発生しません。

| フラグ（`terraform.tfvars`） | 既定値 | 有効にすると作成されるもの |
| --- | --- | --- |
| `enable_github_deploy` | `false` | GitHub OIDC プロバイダ（`github_oidc_provider_arn` が空の場合）、デプロイ用 IAM ロール `<project_name>-github-deploy` とインラインポリシー |
| `enable_monitoring` | `false` | SNS トピック `<project_name>-alarms`、CloudWatch アラーム 3 件（Lambda Errors / Lambda Throttles / API Gateway 5xx）、`alarm_email` 指定時はメール購読 |
| `manage_lambda_log_group` | `false` | Lambda ロググループ `/aws/lambda/<function_name>` の保持期間設定（`log_retention_days`、既定 30 日） |
| `manage_ecr_lifecycle` | `false` | ECR リポジトリ（`ecr_repository_name`、既定 `ee-backend`）のライフサイクルポリシー |

> Terraform の実行（`plan` / `apply`）は従来どおり手元から手動で行います。GitHub Actions のデプロイロールにはインフラ変更や state へのアクセス権限は含めていません。

## 1. GitHub Actions による自動デプロイ

### 1-1. デプロイ用ロールの作成

`terraform.tfvars` に以下を追加して `terraform apply` します。

```hcl
enable_github_deploy = true
github_repository    = "<owner>/<repo>"   # 既定値: 0xItoHub/Engineer_English_App
github_environment   = "production"       # 空文字にすると main ブランチからの実行のみ許可

# アカウントに GitHub の OIDC プロバイダが既にある場合はその ARN を指定（新規作成しない）
# github_oidc_provider_arn = "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
```

```bash
cd infra
terraform plan
terraform apply
terraform output github_deploy_role_arn
terraform output lambda_function_name
terraform output cloudfront_distribution_id
terraform output api_invoke_url
```

ロールを引き受けられるのは、指定リポジトリの `main` ブランチ（`ref:refs/heads/main`）または指定した Environment（`environment:production`）で実行されるワークフローのみです。
付与される権限は次のとおりです。

- ECR: `ee-backend` リポジトリへのイメージ push（`ecr:GetAuthorizationToken` はリソース指定不可のため `*`）
- Lambda: 対象関数の `UpdateFunctionCode` / `GetFunction` / `GetFunctionConfiguration`
- S3: フロントエンド用バケットの `ListBucket` / `PutObject` / `DeleteObject`
- CloudFront: 対象ディストリビューションの `CreateInvalidation` / `GetInvalidation`

### 1-2. GitHub 側の設定

1. **Environment の作成**: Settings → Environments → `production` を作成します。
   Deployment branches を `main` のみに制限しておくと、Environment 経由の実行も main ブランチに限定できます（必要に応じて Required reviewers も設定）。
2. **リポジトリ変数の登録**: Settings → Secrets and variables → Actions → **Variables** タブに以下を登録します。
   いずれも機密情報ではないため Secrets ではなく Variables に置きます（アクセスキーは OIDC により不要）。

| 変数名 | 値 |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `terraform output github_deploy_role_arn` の値 |
| `AWS_REGION` | 例: `ap-northeast-1` |
| `ECR_REPOSITORY` | 例: `ee-backend` |
| `LAMBDA_FUNCTION_NAME` | `terraform output lambda_function_name` の値 |
| `API_BASE_URL` | `terraform output api_invoke_url` の値（末尾 `/` なし） |
| `FRONTEND_BUCKET` | フロントエンド用 S3 バケット名（`frontend_bucket_name`） |
| `CLOUDFRONT_DISTRIBUTION_ID` | `terraform output cloudfront_distribution_id` の値 |

`AWS_DEPLOY_ROLE_ARN` が未設定の間、ワークフロー（`.github/workflows/deploy.yml`）の各ジョブはスキップされます。
`FRONTEND_BUCKET` が未設定の場合はフロントエンドのジョブのみスキップされます。

### 1-3. ワークフローの動作

- **トリガー**: `main` への push（変更されたパスに応じて対象を判定）と手動実行（`workflow_dispatch`、対象を `all` / `backend` / `frontend` から選択）
- **バックエンド**（`core/`、`engineer_english/`、`templates/`、`lambda.py`、`manage.py`、`requirements.txt`、`Dockerfile.lambda` の変更時）
  1. `Dockerfile.lambda` を `linux/amd64` でビルドし、コミット SHA（先頭 12 文字）をタグにして ECR へ push
  2. push したイメージを **ダイジェスト指定**（`<repo>@sha256:...`）で `aws lambda update-function-code` し、更新完了まで待機
  3. `API_BASE_URL` の `/` と `/api/scenes/` が 200 を返すことを確認（スモークテスト）
- **フロントエンド**（`frontend/` の変更時）
  1. Node.js 22 で `npm ci` → `VITE_API_BASE_URL=$API_BASE_URL` を指定して `npm run build`（Vite）
  2. `aws s3 sync build/ s3://$FRONTEND_BUCKET --delete`
  3. CloudFront のキャッシュを無効化（`/*`）し、完了まで待機
- 同時に複数のデプロイが走らないよう `concurrency: deploy-production` で直列化しています。

### 1-4. タグ運用と Terraform との関係

- イメージタグはコミットごとに一意な **SHA タグ** を使い、既存タグの上書き（`:latest` の付け替えなど）は行いません。どのコミットが動いているかはダイジェストとタグから追跡できます。
- Lambda のイメージは CI が更新するため、`aws_lambda_function.backend` には `lifecycle { ignore_changes = [image_uri] }` を設定しています。
  これにより `terraform apply` を実行しても、CI がデプロイしたイメージが `lambda_image_uri` の値に戻ることはありません。
- `lambda_image_uri` は関数の初回作成時に使われます。新規環境を構築する場合は、事前に ECR へ push したイメージ（ダイジェスト指定推奨）を指定してください。

## 2. ロールバック

### 2-1. 以前のイメージに戻す

```bash
REGION=ap-northeast-1
REPO=ee-backend
FUNCTION=<lambda_function_name>

# 直近のイメージ一覧（新しい順）
aws ecr describe-images --region "$REGION" --repository-name "$REPO" \
  --query 'reverse(sort_by(imageDetails,&imagePushedAt))[:10].[imagePushedAt,imageTags[0],imageDigest]' \
  --output table

# 戻したいイメージのダイジェストを指定して更新
aws lambda update-function-code --region "$REGION" \
  --function-name "$FUNCTION" \
  --image-uri "<registry>/$REPO@sha256:<digest>"
aws lambda wait function-updated-v2 --region "$REGION" --function-name "$FUNCTION"
```

ロールバック後に `main` へ新しいコミットが push されると、そのコミットのイメージが再びデプロイされます。

### 2-2. 安定版イメージを長期保持する（`rollback-` タグ）

ライフサイクルポリシーで削除されないよう、安定版のイメージに `rollback-` で始まるタグを追加しておけます。

```bash
MANIFEST=$(aws ecr batch-get-image --region "$REGION" --repository-name "$REPO" \
  --image-ids imageTag=<sha-tag> --query 'images[0].imageManifest' --output text)
aws ecr put-image --region "$REGION" --repository-name "$REPO" \
  --image-tag rollback-<YYYYMMDD> --image-manifest "$MANIFEST"
```

## 3. 監視

### 3-1. アラームの有効化

```hcl
enable_monitoring = true
alarm_email       = "you@example.com"   # 空文字ならメール購読を作成しない
```

`terraform apply` 後、指定アドレスに届く SNS の確認メールのリンクを開くと通知が有効になります。

| アラーム | 条件 |
| --- | --- |
| `<project_name>-lambda-errors` | Lambda `Errors` の合計が 5 分間で 1 件以上 |
| `<project_name>-lambda-throttles` | Lambda `Throttles` の合計が 5 分間で 1 件以上 |
| `<project_name>-api-5xx` | API Gateway（`$default` ステージ）の `5xx` の合計が 5 分間で 1 件以上 |

データが無い期間は `notBreaching`（正常）として扱います。復旧時にも通知（OK アクション）が届きます。

### 3-2. ログの保持期間

Lambda のロググループは Lambda が初回実行時に自動作成するため、Terraform で管理する前に既存のロググループを import します。

```hcl
manage_lambda_log_group = true
log_retention_days      = 30
```

```bash
cd infra
terraform import 'aws_cloudwatch_log_group.lambda[0]' "/aws/lambda/<project_name>-api"
terraform plan   # retention_in_days の変更のみであることを確認
terraform apply
```

## 4. ECR ライフサイクルポリシー

```hcl
manage_ecr_lifecycle     = true
ecr_keep_image_count     = 10   # 保持するタグ付きイメージ数
ecr_untagged_expire_days = 14   # タグなしイメージの保持日数
```

ルール（優先度順）:

1. `rollback-` で始まるタグを持つイメージは常に保持
2. タグなしイメージは push から 14 日後に削除
3. タグ付きイメージは新しい 10 件を保持し、それより古いものを削除

ECR リポジトリ自体はこの構成の管理外のため、ポリシーのみを `ecr_repository_name` で指定したリポジトリに設定します。

## 5. 費用の目安（東京リージョン、月額）

| 項目 | 目安 |
| --- | --- |
| OIDC プロバイダ / IAM ロール | 無料 |
| CloudWatch アラーム（標準解像度） | 1 件あたり約 $0.10 → 3 件で約 $0.30 |
| SNS トピック / メール通知 | 無料枠（メール 1,000 件/月）内であれば実質無料 |
| ロググループの保持期間設定 | 設定自体は無料。保持期間を区切ることでログ保存料金（約 $0.033/GB・月）を抑えられる |
| ECR ライフサイクルポリシー | 無料。古いイメージが削除されストレージ料金（約 $0.10/GB・月）を抑えられる |
| GitHub Actions | パブリックリポジトリの標準ランナーは無料 |
| CloudFront 無効化 | 月 1,000 パスまで無料（`/*` は 1 パスとして計上） |

すべて有効にしても、追加費用は月額 $1 未満が目安です。

## 6. Aurora DSQL の初期設定（初回のみ）

`dsql.tf` で作成したクラスターに、アプリ用のデータベースロールとスキーマを作成します。
Lambda はデータベースロール `app` として IAM 認証で接続し（管理者 `admin` では接続しません）、スキーマ `app` にテーブルを作成します。

1. 管理者の IAM 認証トークンで `admin` として接続します（`psql` の例）。

```bash
REGION=ap-northeast-1
ENDPOINT=$(terraform -chdir=infra output -raw dsql_endpoint)
export PGPASSWORD=$(aws dsql generate-db-connect-admin-auth-token \
  --region "$REGION" --hostname "$ENDPOINT")
PGSSLMODE=require psql --host "$ENDPOINT" --username admin --dbname postgres
```

2. 次の SQL を 1 文ずつ実行します（DSQL では DDL を 1 トランザクションに 1 文ずつ実行します）。
   `<lambda_exec_role_arn>` は Lambda の実行ロールの ARN に置き換えてください。

```sql
CREATE ROLE app WITH LOGIN;
AWS IAM GRANT app TO '<lambda_exec_role_arn>';
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app;
```

3. Lambda を直接呼び出して、テーブル作成（`migrate`）と学習データの投入（`seed`）を行います。手順はルートの [README](../README.md) の「データベースの初期化」を参照してください。

| 環境変数（Lambda） | 既定値 | 内容 |
| --- | --- | --- |
| `DSQL_CLUSTER_ENDPOINT` | （Terraform が設定） | 設定されていると Aurora DSQL に接続する |
| `DSQL_DB_USER` | `app` | 接続するデータベースロール |
| `DSQL_SCHEMA` | `app` | テーブルを作成・参照するスキーマ（`search_path`） |

## 7. Amazon Cognito（ログイン）

`infra/cognito.tf` でユーザープール（Essentials プラン、月間アクティブユーザー 10,000 人まで無料）、マネージドログインのドメイン、SPA 用アプリクライアント（クライアントシークレットなし・認可コード + PKCE）を作成します。

フロントエンドのビルド時には次の出力値を環境変数として渡します（いずれも公開情報）。

| Terraform の出力 | フロントエンドの環境変数 |
|---|---|
| `cognito_authority` | `VITE_COGNITO_AUTHORITY` |
| `cognito_client_id` | `VITE_COGNITO_CLIENT_ID` |
| `cognito_domain` | `VITE_COGNITO_DOMAIN` |

```bash
terraform -chdir=infra output -raw cognito_authority
```

ローカル開発でログインを試す場合は、`terraform.tfvars` で `enable_local_callbacks = true` を指定して `http://localhost:3000` の URL を登録します（既定では登録しません）。

バックエンド（Lambda）には `COGNITO_USER_POOL_ID` と `COGNITO_APP_CLIENT_ID` が Terraform から設定され、API はアクセストークンを検証します。
