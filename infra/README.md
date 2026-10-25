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
| `enable_backup` | `false` | AWS Backup の保管庫 `<project_name>-dsql-backup`、毎日のバックアッププラン、Aurora DSQL クラスターの選択、AWS Backup 用 IAM ロール `<project_name>-backup`（[10 章](#10-aurora-dsql-のバックアップと復元)） |

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
terraform output public_base_url
```

ロールを引き受けられるのは、指定リポジトリの `main` ブランチ（`ref:refs/heads/main`）または指定した Environment（`environment:production`）で実行されるワークフローのみです。
付与される権限は次のとおりです。

- ECR: `ee-backend` リポジトリへのイメージ push（`ecr:GetAuthorizationToken` はリソース指定不可のため `*`）
- Lambda: 対象関数（Web 用と管理専用）の `UpdateFunctionCode` / `GetFunction` / `GetFunctionConfiguration`
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
| `MIGRATOR_FUNCTION_NAME` | `terraform output migrator_function_name` の値（設定すると管理専用の Lambda も同じイメージに更新する） |
| `API_BASE_URL` | `terraform output public_base_url` の値（CloudFront の URL、末尾 `/` なし） |
| `FRONTEND_BUCKET` | フロントエンド用 S3 バケット名（`frontend_bucket_name`） |
| `CLOUDFRONT_DISTRIBUTION_ID` | `terraform output cloudfront_distribution_id` の値 |

`AWS_DEPLOY_ROLE_ARN` が未設定の間、ワークフロー（`.github/workflows/deploy.yml`）の各ジョブはスキップされます。
`FRONTEND_BUCKET` が未設定の場合はフロントエンドのジョブのみスキップされます。

### 1-3. ワークフローの動作

- **トリガー**: `main` への push（変更されたパスに応じて対象を判定）と手動実行（`workflow_dispatch`、対象を `all` / `backend` / `frontend` から選択）
- **バックエンド**（`core/`、`engineer_english/`、`templates/`、`lambda.py`、`manage.py`、`requirements.txt`、`Dockerfile.lambda` の変更時）
  1. `Dockerfile.lambda` を `linux/amd64` でビルドし、コミット SHA（先頭 12 文字）をタグにして ECR へ push
  2. push したイメージを **ダイジェスト指定**（`<repo>@sha256:...`）で `aws lambda update-function-code` し、更新完了まで待機（`MIGRATOR_FUNCTION_NAME` を設定している場合は管理専用の Lambda も同じイメージに更新）
  3. `API_BASE_URL`（CloudFront）の `/` と `/api/scenes/` が 200 を返すことを確認（スモークテスト）
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
| Aurora DSQL のバックアップ（AWS Backup） | ウォームストレージ $0.12/GB・月（東京）。数百 KB のデータを 14 日分保持しても $0.01 未満（[10 章](#10-aurora-dsql-のバックアップと復元)） |
| 管理専用の Lambda（migrator） | 呼び出したときのみ課金（運用操作の頻度では無料枠内） |

すべて有効にしても、追加費用は月額 $1 未満が目安です。

## 6. Aurora DSQL の初期設定（初回のみ）

`dsql.tf` で作成したクラスターに、アプリ用のデータベースロールとスキーマを作成します。
いずれの Lambda も IAM 認証で接続し（管理者 `admin` では接続しません）、役割ごとにデータベースロールを分けています（詳細は [11 章](#11-データベースロールの分離)）。

| データベースロール | 接続する Lambda（IAM ロール） | 権限 |
| --- | --- | --- |
| `app` | 管理専用の `<project_name>-migrator`（`migrator_role_arn`） | スキーマ `app` のテーブルの所有者（`CREATE` / DDL） |
| `app_rw` | Web 用の `<project_name>-api`（`lambda_exec_role_arn`） | スキーマ `app` のテーブルへの `SELECT` / `INSERT` / `UPDATE` / `DELETE` のみ |

既存の環境を `app` のみの構成から移行する場合は [11 章](#11-データベースロールの分離) の手順を使います。以下は新しい環境の初回設定です。

1. 管理者の IAM 認証トークンで `admin` として接続します（`psql` の例）。

```bash
REGION=ap-northeast-1
ENDPOINT=$(terraform -chdir=infra output -raw dsql_endpoint)
export PGPASSWORD=$(aws dsql generate-db-connect-admin-auth-token \
  --region "$REGION" --hostname "$ENDPOINT")
PGSSLMODE=require psql --host "$ENDPOINT" --username admin --dbname postgres
```

2. 次の SQL を 1 文ずつ実行します（DSQL では DDL を 1 トランザクションに 1 文ずつ実行します）。
   `<migrator_role_arn>` / `<lambda_exec_role_arn>` は `terraform output -raw migrator_role_arn` / `terraform output -raw lambda_exec_role_arn` の値に置き換えてください。

```sql
CREATE ROLE app WITH LOGIN;
CREATE ROLE app_rw WITH LOGIN;
AWS IAM GRANT app TO '<migrator_role_arn>';
AWS IAM GRANT app_rw TO '<lambda_exec_role_arn>';
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app;
GRANT USAGE ON SCHEMA app TO app_rw;
```

3. 管理専用の Lambda（migrator）を直接呼び出して、テーブル作成（`migrate`）と学習データの投入（`seed`）を行います。`migrate` は続けて `app_rw` への権限付与（`grant_runtime`）も行います。手順はルートの [README](../README.md) の「データベースの初期化」を参照してください。

| 環境変数（Lambda） | 既定値 | 内容 |
| --- | --- | --- |
| `DSQL_CLUSTER_ENDPOINT` | （Terraform が設定） | 設定されていると Aurora DSQL に接続する |
| `DSQL_DB_USER` | `app`（Terraform は Web 用に `web_db_user`、migrator に `migrator_db_user` を設定） | 接続するデータベースロール |
| `DSQL_SCHEMA` | `app` | テーブルを作成・参照するスキーマ（`search_path`） |
| `DSQL_RUNTIME_DB_USER` | （migrator のみ、`runtime_db_user`） | `grant_runtime` / `migrate` で DML の権限を付与する実行時ロール |
| `MANAGE_ONLY` | （migrator のみ `1`） | 管理操作のみ受け付け、HTTP のリクエストは処理しない |

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

### 7-1. ログイン画面の表示言語とデザイン

- **表示言語**: フロントエンドはログイン開始時（`/oauth2/authorize`）に `lang=ja` を付けて、マネージドログインの画面を日本語で表示します（`frontend/src/lib/auth.ts` の `LOGIN_PAGE_LANGUAGE`）。選択した言語は Cognito の Cookie に保存されます。
- **デザイン**: `infra/cognito_branding.json` の設定（ブランディングの `Settings`）を `aws_cognito_managed_login_branding` に適用します。アプリのテーマに合わせ、ライトモードのみ・明るい背景・白いフォーム・紺色（`#0A1A2F`）のメインボタン・アクセント色（`#3c5aa6`）のリンクと選択状態・角丸（ボタンと入力欄 10px、フォーム 16px）を指定しています。
  - 色は `RRGGBBAA` 形式（末尾 2 桁は不透明度）で記述します。記載のない項目には Cognito の既定値が使われます。
  - ロゴ画像は設定していません（追加する場合は `asset` ブロックで `FORM_LOGO` などを PNG / SVG / JPEG で指定し、`components.form.logo.enabled` を `true` にします）。
- **確認コードのメール**: 登録時の確認やパスワード再設定で送るメールの件名・本文を日本語にしています（`verification_message_template`。`{####}` が確認コードに置き換わります）。

`terraform apply` の後は、次の点を確認してください。

1. `terraform plan` を再実行し、`aws_cognito_managed_login_branding.spa` に差分が出続けないこと
2. ログイン画面（`lang=ja`）が日本語で表示され、背景・フォーム・ボタン・リンクの色と角丸が意図どおりであること（新規登録・パスワード再設定の画面も含む）
3. 新規登録時の確認メールが日本語の件名・本文で届くこと

デザインを調整する場合は、Cognito コンソールの「マネージドログイン」→ スタイルの編集画面で見た目を確認し、`DescribeManagedLoginBrandingByClient`（`ReturnMergedResources=true`）で取得した `Settings` から必要な項目を `cognito_branding.json` に反映すると、Terraform の設定と画面を一致させられます。

## 8. CloudFront 経由のリクエストの確認とレート制限

API は CloudFront の `/api/*` から配信します。CloudFront と API（Django）の間で次の 2 つのヘッダーを使います。

| ヘッダー | 設定する場所 | 内容 |
|---|---|---|
| `X-Viewer-IP` | CloudFront Function `<project_name>-api-viewer-ip`（`/api/*` の viewer-request） | 閲覧者の IP アドレス（`event.viewer.ip`）。閲覧者が送った同名のヘッダーは上書きする |
| `X-Origin-Verify` | API Gateway オリジンのカスタムヘッダー（`cloudfront_frontend.tf`） | Terraform の `random_password` が生成した秘密の値。閲覧者が送った同名のヘッダーは取り除く |

- 同じ秘密の値を Lambda の環境変数 `ORIGIN_VERIFY_SECRET` として渡します。値は Terraform の state にのみ保存され、`plan` / `apply` の出力には `(sensitive value)` と表示されます。
- Django の `core.middleware.OriginVerifyMiddleware` は、`X-Origin-Verify` が一致しないリクエスト（API Gateway の URL `api_invoke_url` への直接のアクセスなど）に 403 を返します。API・フロントエンドは `public_base_url`（CloudFront）から利用します。API Gateway の URL の `/`（フロントエンドへの転送）も 403 になり、CloudFront の `/` はフロントエンドを返します。
- 確認できたリクエストでは `X-Viewer-IP` を `REMOTE_ADDR` に設定し、`X-Forwarded-For` / `X-Origin-Verify` / `X-Viewer-IP` を取り除いてからビューに渡します。
- 管理操作（`{"manage": ...}` の直接呼び出し）は HTTP を経由しないため、この確認の対象外です。
- CloudFront を使わない構成（`frontend_bucket_name` 未指定）では秘密の値を生成せず、確認も行いません。

### レート制限の単位

| 層 | 単位 | 上限 |
|---|---|---|
| API Gateway（`$default` ステージ） | API 全体 | `api_throttling_rate_limit`（既定 20 rps）/ `api_throttling_burst_limit`（既定 50） |
| Django REST framework | 未認証: 閲覧者の IP アドレス（`REMOTE_ADDR`）/ 認証済み: Cognito のユーザー ID（`sub`） | `DJANGO_THROTTLE_ANON` / `DJANGO_THROTTLE_USER` / `DJANGO_THROTTLE_COMPLETE_LESSON` |

DRF のカウンタは Lambda の実行環境ごとのメモリ（LocMem キャッシュ）に保持するため、上限は実行環境ごとに数えます。

### 秘密の値の更新（ローテーション）

CloudFront の設定の反映には数分かかるため、次の順で更新すると 403 を出さずに切り替えられます。

```bash
cd infra
# 1. Lambda 側の確認を止める（CloudFront は引き続き古い値を送る）
terraform apply -var 'origin_verify_enforced=false'
# 2. 秘密の値を作り直す（CloudFront に新しい値が設定される）
terraform apply -var 'origin_verify_enforced=false' -replace='random_password.origin_verify[0]'
# 3. CloudFront の反映完了を待つ
aws cloudfront wait distribution-deployed --id "$(terraform output -raw cloudfront_distribution_id)"
# 4. Lambda 側の確認を再開する（新しい値）
terraform apply
```

## 9. セキュリティヘッダーと Content Security Policy（CSP）

`infra/security_headers.tf` の CloudFront レスポンスヘッダーポリシーで、次のヘッダーを付与します。

| 対象 | ヘッダー | 値 |
| --- | --- | --- |
| フロントエンド・API | `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| フロントエンド・API | `X-Content-Type-Options` | `nosniff` |
| フロントエンド・API | `X-Frame-Options` | `DENY` |
| フロントエンド・API | `Referrer-Policy` | `strict-origin-when-cross-origin` |
| フロントエンド | `Content-Security-Policy-Report-Only`（`csp_enforce = true` のときは `Content-Security-Policy`） | 下記 |
| フロントエンド | `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |

API（`/api/*`）は JSON を返すため CSP は付与せず、Django（`SecurityMiddleware` など）が設定したヘッダーがある場合はそちらを優先します（`override = false`）。

CSP は Terraform のリソース（リージョン・Cognito のドメイン・API Gateway のエンドポイント）から組み立てます。

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com; img-src 'self' data:;
connect-src 'self' https://cognito-idp.<region>.amazonaws.com https://<prefix>.auth.<region>.amazoncognito.com;
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; report-uri /api/csp-report/
```

`csp_enforce = true` のときは、末尾に `upgrade-insecure-requests` も加わります（レポートのみのモードではブラウザが無視するため）。

### 8-1. 違反レポートの確認

ブラウザは CSP の違反を `POST /api/csp-report/` に送信し、Django が要点のみを 1 行のログ（WARNING）に記録します。

```text
csp_violation directive=img-src blocked=https://img.example.com document=/scene/1 disposition=report
```

- 記録するのは、ディレクティブ・ブロックされたリソースのオリジン（`data:` などはスキームのみ）・ページのパス・処理の種類のみです。クエリ文字列やレポート本文全体は記録せず、データベースにも保存しません。
- 本文は 8 KB まで（超える場合は 413）、IP 単位で 30 回/分まで受け付けます（環境変数 `DJANGO_THROTTLE_CSP_REPORT` で変更可能）。

CloudWatch Logs Insights でロググループ `/aws/lambda/<project_name>-api` を選び、次のクエリで集計できます。

```text
fields @timestamp, @message
| filter @message like /csp_violation/
| parse @message "directive=* blocked=* document=* disposition=*" as directive, blocked, document, disposition
| stats count(*) as reports by directive, blocked
| sort reports desc
```

### 8-2. CSP の適用（レポートのみ → ブロック）

既定（`csp_enforce = false`）では違反をブロックせず、報告のみを行います。
一定期間レポートを確認し、正常な画面操作（ログイン・ログアウト・学習・読み上げ）で違反が出ていないことを確かめてから、`terraform.tfvars` に次の 1 行を追加して `terraform apply` します。

```hcl
csp_enforce = true
```

ヘッダー名が `Content-Security-Policy` に切り替わり、ポリシーに反する読み込みがブロックされます。元に戻す場合は `false` にして再度 `apply` します。

## 10. Aurora DSQL のバックアップと復元

`infra/backup.tf` で、AWS Backup による Aurora DSQL クラスターの毎日のバックアップを設定します。

```hcl
enable_backup         = true
backup_retention_days = 14   # 既定値
```

| 項目 | 内容 |
| --- | --- |
| 対象 | `aws_dsql_cluster.main`（クラスター全体のフルバックアップ。テーブル単位の取得・復元は対象外） |
| 取得時刻 | 毎日 18:00 UTC（日本時間 03:00）。開始の猶予 60 分、完了の猶予 180 分 |
| 保持期間 | `backup_retention_days` 日（既定 14 日）の経過後に自動削除 |
| 保管庫 | `<project_name>-dsql-backup`（AWS Backup の管理する暗号化。既定は AWS マネージドキー `aws/backup`） |
| IAM ロール | `<project_name>-backup`（`backup.amazonaws.com` が引き受ける。AWS 管理ポリシー `AWSBackupServiceRolePolicyForBackup` / `AWSBackupServiceRolePolicyForRestores` に DSQL のバックアップ・復元の権限が含まれる） |
| 復旧時点 | 最後に取得したバックアップの時点（DSQL は AWS Backup の継続的バックアップ・ポイントインタイムリストアの対象外のため、日次のスナップショットから復元する） |

- AWS Backup のリージョン設定で、リソースタイプ `DSQL` のオプトインが有効であることを確認します（`aws backup describe-region-settings` の `ResourceTypeOptInPreference.DSQL` が `true`）。
- 初回のバックアップは `apply` 後の最初の 03:00 に取得されます。すぐに取得したい場合は AWS Backup コンソールの「オンデマンドバックアップを作成」から保管庫 `<project_name>-dsql-backup` とロール `<project_name>-backup` を指定して実行します。
- 取得の状況は `aws backup list-backup-jobs --by-resource-type DSQL` で確認できます。

### 10-1. 費用の目安（東京リージョン）

| 項目 | 単価 | このアプリでの目安 |
| --- | --- | --- |
| バックアップのストレージ（ウォーム） | $0.12/GB・月 | データは数百 KB。フルバックアップ 14 世代でも数 MB 程度 → 月額 $0.01 未満 |
| 復元 | $0.024/GB | 1 回あたり $0.01 未満 |
| 復元したクラスター | DSQL の通常料金（DPU・ストレージ） | 復元後に使わないクラスターは削除する |

### 10-2. 復元の手順

復元は **常に新しいクラスター** として作成され、元のクラスターは変更されません。新しいクラスターを Terraform の管理に切り替えることで、Lambda・IAM ポリシー・バックアップの対象が新しいクラスターに揃います。

1. 復元する復旧ポイントを選びます。

```bash
REGION=ap-northeast-1
VAULT=$(terraform -chdir=infra output -raw backup_vault_name)
aws backup list-recovery-points-by-backup-vault --region "$REGION" --backup-vault-name "$VAULT" \
  --query 'reverse(sort_by(RecoveryPoints,&CreationDate))[:5].[CreationDate,Status,RecoveryPointArn]' \
  --output table
```

2. 新しいクラスターとして復元します（削除保護を有効にし、元のクラスターのタグを引き継ぎます）。

```bash
aws backup start-restore-job --region "$REGION" \
  --recovery-point-arn "<recovery_point_arn>" \
  --iam-role-arn "$(terraform -chdir=infra output -raw backup_role_arn)" \
  --metadata "{\"regionalConfig\":\"[{\\\"region\\\":\\\"${REGION}\\\",\\\"isDeletionProtectionEnabled\\\":true}]\"}" \
  --copy-source-tags-to-restored-resource

# 完了（Status=COMPLETED）を確認し、作成されたクラスターの ARN（CreatedResourceArn）を控える
aws backup describe-restore-job --region "$REGION" --restore-job-id "<restore_job_id>" \
  --query '{Status: Status, CreatedResourceArn: CreatedResourceArn}'
```

3. 新しいクラスターに `admin` で接続し（[6 章](#6-aurora-dsql-の初期設定初回のみ) の手順 1 のエンドポイントを `<new_cluster_id>.dsql.<region>.on.aws` に置き換える）、データとロールの対応付けを確認します。

```sql
SELECT count(*) FROM app.core_scene;
SELECT count(*) FROM app.core_userprogress;
SELECT pg_role_name, arn FROM sys.iam_pg_role_mappings;
```

   対応付けが無い場合は、[6 章](#6-aurora-dsql-の初期設定初回のみ) の `AWS IAM GRANT` の 2 文を新しいクラスターで実行します。

4. Terraform の管理対象を新しいクラスターに切り替えます（`state rm` は state から外すだけで、元のクラスターは削除されません）。

```bash
cd infra
terraform state rm aws_dsql_cluster.main
terraform import aws_dsql_cluster.main <new_cluster_id>
terraform plan    # 両方の Lambda の DSQL_CLUSTER_ENDPOINT、IAM ポリシーの対象、バックアップの選択が新しいクラスターに変わることを確認
terraform apply
```

5. Web 用の Lambda で `{"manage":"check"}` を実行し、件数が返ることと、画面から学習データを表示できることを確認します。
6. 元のクラスターは調査のために残しておけます。不要になったら削除保護を無効にしてから削除します（`aws dsql update-cluster --no-deletion-protection-enabled` → `aws dsql delete-cluster`）。

> 復元したクラスターに切り替えると、最後のバックアップ以降に元のクラスターへ書き込まれた学習記録は含まれません（復旧時点は最大 24 時間前）。

## 11. データベースロールの分離

Web リクエストを処理する Lambda が DDL（テーブルの作成・変更・削除）を実行できないよう、データベースロールを 2 つに分けています。

| 役割 | データベースロール | IAM ロール（Lambda） | 権限 |
| --- | --- | --- | --- |
| 所有者 | `app` | `<project_name>-migrator-exec`（管理専用の `<project_name>-migrator`） | スキーマ `app` の `USAGE, CREATE`。テーブルの所有者として `migrate` を実行 |
| 実行時 | `app_rw` | `<project_name>-lambda-exec`（Web 用の `<project_name>-api`） | スキーマ `app` の `USAGE` と、テーブルへの `SELECT, INSERT, UPDATE, DELETE`、シーケンスへの `USAGE, SELECT` のみ |

- 管理専用の Lambda は Web 用と同じコンテナイメージで、環境変数 `MANAGE_ONLY=1` により `{"manage": ...}` の直接呼び出しのみ受け付けます（API Gateway には接続しません）。マイグレーションは手元の認証情報を使わず、毎回同じ環境から実行できます。
- Web 用の Lambda で実行できる管理操作は `check`（件数の確認）のみです。
- `grant_runtime` は、所有者ロール `app` として次の SQL を 1 文ずつ（それぞれ別のトランザクションで）実行します。何度実行しても結果は同じです。`migrate` の後にも自動で実行します。

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "app" TO "app_rw";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "app" TO "app_rw";
ALTER DEFAULT PRIVILEGES IN SCHEMA "app" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app_rw";
ALTER DEFAULT PRIVILEGES IN SCHEMA "app" GRANT USAGE, SELECT ON SEQUENCES TO "app_rw";
```

  主キーは IDENTITY 列（`GENERATED BY DEFAULT AS IDENTITY`）のため、`INSERT` の採番に使うシーケンスにも権限を付与しています。`ALTER DEFAULT PRIVILEGES` により、以降に `app` が作成するテーブルにも同じ権限が付与されます。

### 11-1. 既存の環境の移行手順（`app` のみ → `app` / `app_rw`）

各手順の間も Web 用の Lambda は接続を続けられるため、停止せずに切り替えられます。
事前に、この構成に対応したアプリ（`MANAGE_ONLY` / `grant_runtime` を含むイメージ）が GitHub Actions で Web 用の Lambda にデプロイされていることを確認します。
SQL は [6 章](#6-aurora-dsql-の初期設定初回のみ) の手順 1 と同じく `admin` で接続して 1 文ずつ実行します。ARN は次の値に置き換えます。

```bash
terraform -chdir=infra output -raw lambda_exec_role_arn   # <lambda_exec_role_arn>
terraform -chdir=infra output -raw migrator_role_arn      # <migrator_role_arn>
```

**手順 1. 管理専用の Lambda を作成する（Web 用は `app` のまま）**

`terraform.tfvars` に次の 1 行を追加して `apply` します。Web 用の Lambda は引き続き `app` で接続します。

```hcl
web_db_user = "app"   # 手順 4 で削除する
```

```bash
cd infra
terraform plan    # migrator の Lambda・IAM ロールの追加と、Web 用の Lambda の DSQL_DB_USER=app の追加であることを確認
terraform apply

# 管理専用の Lambda を、Web 用の Lambda で動いているイメージに揃える
API=$(terraform output -raw lambda_function_name)
MIGRATOR=$(terraform output -raw migrator_function_name)
IMAGE=$(aws lambda get-function --function-name "$API" --query 'Code.ImageUri' --output text)
aws lambda update-function-code --function-name "$MIGRATOR" --image-uri "$IMAGE"
aws lambda wait function-updated-v2 --function-name "$MIGRATOR"
```

GitHub のリポジトリ変数 `MIGRATOR_FUNCTION_NAME` に `terraform output -raw migrator_function_name` の値を登録すると、以降のデプロイで管理専用の Lambda も同じイメージに更新されます。

**手順 2. 実行時ロールを作成し、IAM ロールと対応付ける（`admin`）**

```sql
CREATE ROLE app_rw WITH LOGIN;
AWS IAM GRANT app TO '<migrator_role_arn>';
AWS IAM GRANT app_rw TO '<lambda_exec_role_arn>';
GRANT USAGE ON SCHEMA app TO app_rw;
SELECT pg_role_name, arn FROM sys.iam_pg_role_mappings ORDER BY pg_role_name;
```

この時点で Web 用の IAM ロールは `app` と `app_rw` の両方に対応付けられ、`app` での接続を続けます。

**手順 3. 既存のテーブルに権限を付与する（管理専用の Lambda）**

```bash
aws lambda invoke --function-name "$MIGRATOR" --cli-binary-format raw-in-base64-out \
  --payload '{"manage":"grant_runtime"}' /dev/stdout
aws lambda invoke --function-name "$MIGRATOR" --cli-binary-format raw-in-base64-out \
  --payload '{"manage":"check"}' /dev/stdout
```

`admin` で付与の結果を確認します（各テーブルに `DELETE, INSERT, SELECT, UPDATE` が並び、スキーマの `CREATE` 権限が無いこと）。

```sql
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE grantee = 'app_rw' AND table_schema = 'app'
 GROUP BY table_name ORDER BY table_name;
SELECT has_schema_privilege('app_rw', 'app', 'USAGE')  AS usage,
       has_schema_privilege('app_rw', 'app', 'CREATE') AS create;   -- usage=true, create=false
```

**手順 4. Web 用の Lambda を `app_rw` に切り替える**

`terraform.tfvars` から `web_db_user = "app"` を削除し（既定値 `app_rw`）、`apply` します。

```bash
terraform plan    # Web 用の Lambda の DSQL_DB_USER が app → app_rw に変わるだけであることを確認
terraform apply
aws lambda wait function-updated-v2 --function-name "$API"
```

**手順 5. 動作を確認する**

```bash
BASE=$(terraform output -raw public_base_url)
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/scenes/"   # 200
aws lambda invoke --function-name "$API" --cli-binary-format raw-in-base64-out \
  --payload '{"manage":"check"}' /dev/stdout                    # 件数が返る
```

- 画面からログインしてレッスンを完了し、学習記録の保存（`INSERT` / `UPDATE`）ができることを確認します。
- CloudWatch Logs（`/aws/lambda/<project_name>-api`）に `permission denied` が出ていないことを確認します。

**手順 6. Web 用の IAM ロールから所有者ロールの対応付けを外す（`admin`）**

```sql
AWS IAM REVOKE app FROM '<lambda_exec_role_arn>';
SELECT pg_role_name, arn FROM sys.iam_pg_role_mappings ORDER BY pg_role_name;
-- app → migrator の IAM ロール、app_rw → Web 用の IAM ロールの 2 行になる
```

以降、Web 用の Lambda は `app` で接続できなくなり、DDL を実行する手段はありません。

### 11-2. 切り戻し

| 状況 | 手順 |
| --- | --- |
| 手順 4 の後に問題が見つかった（手順 6 の前） | `terraform.tfvars` に `web_db_user = "app"` を戻して `apply`。Web 用の Lambda は `app` で接続する |
| 手順 6 の後に問題が見つかった | `admin` で `AWS IAM GRANT app TO '<lambda_exec_role_arn>';` を実行してから、上と同じく `web_db_user = "app"` で `apply` |
| 権限の付与漏れ（新しいテーブルで `permission denied`） | 管理専用の Lambda で `{"manage":"grant_runtime"}` を実行 |

### 11-3. 以降の運用

- モデルの変更時は、デプロイ後に管理専用の Lambda で `{"manage":"migrate"}` を実行します（テーブル作成に続けて `app_rw` への権限付与も行います）。
- 学習データの投入（`seed`）も管理専用の Lambda で実行します。
