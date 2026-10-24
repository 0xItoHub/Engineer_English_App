# Engineer English App

エンジニアの実務シーンに沿って英語を学習できる Web アプリケーション（Django + React）

- バックエンド: Django
- フロントエンド: React
- インフラ: AWS Lambda（コンテナ）+ API Gateway HTTP API + S3 + CloudFront
- DB: SQLite


## サイト
- **TOPページ**: https://vri07nkptg.execute-api.ap-northeast-1.amazonaws.com
- **学習ページ**: https://d2w237yrqesgsh.cloudfront.net


---

## 機能
- シーン一覧/詳細、レッスン詳細（円形進捗メーター）
- 学習履歴
- TTS（Web Speech API）
- 右下 AI Chatbot（ダミー実装）
- API エンドポイント例（相対パス）
  - `GET /api/scenes/`
  - `GET /api/lessons/`
  - `GET /api/phrases/`
  - `GET /api/dialogues/`
  - `GET /api/progress/my_progress/`
  - `POST /api/progress/complete_lesson/`

---

## ディレクトリ構成
```
.
├─ engineer_english/       # Django プロジェクト
├─ core/                   # アプリ（モデル/シリアライザ/ビュー等）
├─ frontend/               # React (CRA) フロント
├─ infra/                  # Terraform (Lambda+APIGW+S3 の最小構成)
├─ lambda.py               # Lambda ハンドラ（Mangum）
├─ Dockerfile.lambda       # Lambda 用コンテナ Dockerfile
├─ requirements.txt        # Python 依存
└─ README.md
```

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

> SQLite は Lambda の `/tmp/db.sqlite3` を使用（コールドスタートで消える可能性あり）。永続化が必要になったら RDS に切替を推奨。
```
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
- 本番環境では HTTPS 前提の Cookie・HSTS を有効化し、CORS はフロントエンドのオリジンのみ許可
- API は読み取りを公開、書き込みは認証ユーザーのみ（学習完了の記録を除く）

---

## ライセンス
MIT 
