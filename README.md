# Engineer English App

![CI](https://github.com/0xItoHub/Engineer_English_App/actions/workflows/ci.yml/badge.svg)

エンジニアの実務シーンに沿って英語を学習できる Web アプリケーション（Django + React）

- バックエンド: Django
- フロントエンド: React
- インフラ: AWS Lambda（コンテナ）+ API Gateway HTTP API + S3 + CloudFront
- DB: Aurora DSQL（本番）/ SQLite（ローカル開発・テスト）


## サイト
- **サイト**: https://d2w237yrqesgsh.cloudfront.net（API は同じドメインの `/api/` で提供）


---

## 機能
- シーン一覧/詳細、レッスン詳細（円形進捗メーター）
- 学習履歴
- 英文の読み上げ（事前に生成した音声を再生し、未対応の文は Web Speech API で読み上げ。速度は 0.75〜1.5 倍）
- 右下 AI チャット: 設定で有効化（Gemini API / OpenAI 互換 API / Amazon Bedrock。ログインユーザーが仕事で使う英語を質問できる。既定は入力内容をそのまま返すデモ。手順は [infra/README.md](infra/README.md#12-ai-チャットの有効化)）
- API エンドポイント例（相対パス）
  - `GET /api/scenes/`
  - `GET /api/lessons/`
  - `GET /api/phrases/`
  - `GET /api/dialogues/`
  - `GET /api/progress/my_progress/`
  - `POST /api/progress/complete_lesson/`
  - `GET /api/chat/status/`
  - `POST /api/chat/`（ログインが必要）

---

## ディレクトリ構成
```
.
├─ engineer_english/       # Django プロジェクト
├─ core/                   # アプリ（モデル/シリアライザ/ビュー等）
├─ frontend/               # React (Vite) フロント
├─ infra/                  # Terraform (Lambda+APIGW+S3 の最小構成)
├─ scripts/                # 開発用スクリプト（読み上げ音声の生成）
├─ lambda.py               # Lambda ハンドラ（Mangum）
├─ Dockerfile.lambda       # Lambda 用コンテナ Dockerfile
├─ requirements.txt        # Python 依存
└─ README.md
```

## 開発
ローカル環境のセットアップ、テスト・lint の実行方法、CI の構成は [DEVELOPMENT.md](DEVELOPMENT.md) を参照してください。環境変数の一覧は [.env.example](.env.example) にあります。

## AWS への最小デプロイ（サーバレス）
サーバ側は **Lambda（コンテナ）+ API Gateway**、フロントは任意で **S3 静的サイト** を利用できます。

1) **ECR リポジトリ作成 & Docker ログイン**
```bash
aws ecr create-repository --repository-name xxxxx
aws ecr get-login-password 
```

2) **コンテナのビルド & プッシュ**
```bash
docker build
docker push
```

3) **Terraform でインフラ作成**
```bash
cd infra
terraform init
terraform apply
```

4) **データベースの初期化（初回とモデル変更時）**

本番のデータは Aurora DSQL に保存します。管理専用の Lambda（`<project_name>-migrator`）を直接呼び出して、テーブル作成と学習データの投入を行います（初回のみ、事前に [infra/README.md](infra/README.md) の「Aurora DSQL の初期設定」を実施）。
```bash
MIGRATOR=$(terraform -chdir=infra output -raw migrator_function_name)
aws lambda invoke --function-name "$MIGRATOR" --cli-binary-format raw-in-base64-out \
  --payload '{"manage":"migrate"}' /dev/stdout   # テーブル作成 + 実行時ロールへの権限付与
aws lambda invoke --function-name "$MIGRATOR" --cli-binary-format raw-in-base64-out \
  --payload '{"manage":"seed"}' /dev/stdout
aws lambda invoke --function-name "$MIGRATOR" --cli-binary-format raw-in-base64-out \
  --payload '{"manage":"check"}' /dev/stdout     # 件数の確認
```

| 関数 | 接続するデータベースロール | 実行できる操作 |
|---|---|---|
| `<project_name>-migrator`（管理専用、`MANAGE_ONLY=1`） | `app`（テーブルの所有者。DDL を実行できる） | `migrate` / `seed` / `check` / `grant_runtime` |
| `<project_name>-api`（Web リクエストを処理） | `app_rw`（DML のみ） | `check` |

- 許可リストにない操作は `"status": "rejected"` を返します。管理専用の関数は HTTP のリクエストを処理しません。
- `{"manage": ...}` 形式のイベントは `lambda:InvokeFunction` 権限を持つ IAM プリンシパルからの直接呼び出しでのみ届きます（API Gateway 経由のリクエストはこの形式になりません）。
- `seed` は何度実行しても同じ内容・同じ ID になります。

### データベース
| 環境 | DB | 設定 |
|---|---|---|
| 本番（Lambda） | Aurora DSQL（IAM 認証、スキーマ `app`） | `DSQL_CLUSTER_ENDPOINT` が設定されていると自動で選択 |
| ローカル開発・テスト・CI | SQLite | `DSQL_CLUSTER_ENDPOINT` 未設定時（既定） |

- 接続のたびに IAM 認証トークンを生成するため、DB のパスワードは保持しません。通信は TLS（`verify-full`）で暗号化し、サーバ証明書を検証します。
- 主キーは整数の連番（`/scene/1` のような URL をそのまま利用可能）です。
- DSQL は楽観的同時実行制御のため、学習完了の記録は競合時にトランザクションごと自動で再試行します。

### デプロイ時に設定する値
Lambda の環境変数は Terraform（`infra/lambda_api.tf`）で管理します。`infra/terraform.tfvars` で指定する主な値:

| 変数 | 内容 |
|---|---|
| `secret_key_ssm_param_name` | Django `SECRET_KEY` を保存した SSM パラメータ名（必須） |
| `django_debug` | 本番は `"False"`（既定値） |
| `allowed_hosts` | 空なら API Gateway のホスト名を使用 |
| `cors_allowed_origins` | 空なら CloudFront（フロントエンド）のオリジンを使用 |

`SECRET_KEY` の値はコードや Terraform には書かず、SSM Parameter Store の SecureString として登録します。
```bash
aws ssm put-parameter --name "/<project>/django-secret-key" --type SecureString \
  --value "$(python -c 'import secrets;print(secrets.token_urlsafe(50))')"
```

---

## セキュリティ
- API Gateway は AWS Shield Standard により自動で DDoS 保護（無料）
- API は CloudFront 経由のリクエストのみを処理し（オリジン用のカスタムヘッダーで確認）、レート制限は閲覧者の IP アドレス単位で数える（[infra/README.md](infra/README.md) の 8 章）
- エラー応答は `{"detail": "..."}` 形式の日本語の JSON で返す
- 本番環境では HTTPS 前提の Cookie・HSTS を有効化し、CORS はフロントエンドのオリジンのみ許可
- ログインは Amazon Cognito（マネージドログイン、認可コード + PKCE）。API は Bearer のアクセストークンを署名・発行元・有効期限・アプリクライアントの各項目で検証
- 学習コンテンツは読み取り専用。学習進捗はログインユーザー本人のデータのみ参照・記録できる

---

## クレジット
- 音声: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)（Apache-2.0）で事前に生成した音声を配信（未対応の文はブラウザの音声合成）。生成手順は [DEVELOPMENT.md](DEVELOPMENT.md#読み上げ音声の生成) を参照

## ライセンス
MIT 
