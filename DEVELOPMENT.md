# 開発ガイド

Engineer English App をローカルで開発・テストするための手順です。

## 必要なツール

| ツール | バージョン |
|---|---|
| Python | 3.14 |
| Node.js | 22 LTS |
| Terraform | 1.10 以上（CI は 1.15 系） |
| Docker | インフラ用イメージをビルドする場合のみ |

## バックエンド（Django）

```bash
# 仮想環境を作成して有効化
python3.14 -m venv venv
source venv/bin/activate

# 開発用の依存（requirements.txt + テスト・lint ツール）をインストール
pip install -r requirements-dev.txt

# 環境変数を用意（値の説明は .env.example を参照）
cp .env.example .env
set -a; source .env; set +a

# DB を作成し、学習データを投入
# （auth / contenttypes はマイグレーション履歴を持たないため --run-syncdb でテーブルを作成します）
python manage.py migrate --run-syncdb
python manage.py seed_six_scenes

# 開発サーバを起動（http://127.0.0.1:8000）
python manage.py runserver
```

`.env.example` の既定値では `DJANGO_DEBUG=True` になります。ローカルの SQLite はリポジトリ直下の `db.sqlite3` に作成されます。

### データベースの切り替え

`engineer_english/settings.py` の `build_databases()` が環境変数から接続先を決めます。

| 条件 | 接続先 |
|---|---|
| `DSQL_CLUSTER_ENDPOINT` 未設定（既定） | SQLite（`SQLITE_PATH`、未指定なら `db.sqlite3`） |
| `DSQL_CLUSTER_ENDPOINT` 設定あり | Aurora DSQL（アダプタ `aurora-dsql-django`、IAM 認証） |

- テスト・CI・コンテナイメージのビルドは SQLite で動作します（DSQL への接続は不要）。
- DSQL では主キーを整数の連番（`USE_SEQUENCE_AUTOFIELDS`、キャッシュ 1）で採番し、テーブルはスキーマ `DSQL_SCHEMA`（既定 `app`）に作成します。
- `core/migrations/0001_initial.py` は、参照先のテーブルから順に外部キーを含めて作成する構成です。モデルを変更するときは、DSQL の制約（列の型変更や既存テーブルへの NOT NULL 外部キー追加は不可、1 トランザクションの変更は 3,000 行まで）に収まるマイグレーションにしてください。
- 同時更新の競合（SQLSTATE `40001` / `OC000` / `OC001`）は `core/db.py` の `run_in_transaction_with_retry()` でトランザクションごと再試行します。

### ユーザーの識別

ログイン機能は外部の認証基盤で提供する予定で、現在の API は既定の認証方式を持ちません。
認証済みのリクエストでは `request.user` が `core.auth.ExternalUser`（認証基盤のユーザー ID `sub` とユーザー名を持つ）になり、学習進捗は `UserProgress.user_sub` で本人のものだけを扱います。
テストでは `APIClient.force_authenticate(user=ExternalUser(sub="sub-alice", username="alice"))` で認証済みの状態を再現します。

## フロントエンド（React）

```bash
cd frontend
npm ci
npm run dev   # http://localhost:3000
```

フロントエンドは Vite で構成しています（Node.js 22.12 以上）。`frontend/vite.config.ts` の `server.proxy` 設定により、開発サーバから `/api/...` へのリクエストは `http://127.0.0.1:8000` のバックエンドへ転送されます。先にバックエンドを起動しておいてください。
API の接続先は `VITE_API_BASE_URL`（ビルド時に埋め込み）で指定でき、未設定なら同一オリジンの `/api/...` を呼び出します。

## テストと lint

### バックエンド

```bash
ruff check .            # lint
ruff format --check .   # フォーマット確認（整形するなら ruff format .）
pytest --cov=core       # テスト + カバレッジ
```

ruff と pytest の設定は `pyproject.toml` にまとめています。

### フロントエンド

```bash
cd frontend
npm run lint        # ESLint（警告 0 件）
npm run typecheck   # TypeScript の型チェック
npm run test:ci     # Vitest を 1 回だけ実行（watch なし）
npm run build
```

### インフラ

```bash
terraform fmt -recursive infra
terraform -chdir=infra init -backend=false
terraform -chdir=infra validate
```

`-backend=false` を付けるとリモートステートに接続せずに構文チェックだけを行えます。

## pre-commit

コミット時に ruff・terraform fmt・ファイル衛生チェックを自動で実行できます。

```bash
pip install pre-commit   # requirements-dev.txt に含まれていない場合
pre-commit install
pre-commit run --all-files   # 初回や設定変更時に全ファイルへ実行
```

エディタの設定は `.editorconfig` で揃えています（Python は 4 スペース、その他は 2 スペース、UTF-8 / LF）。

## CI（GitHub Actions）

`.github/workflows/ci.yml` で、Pull Request と `main` への push のたびに次のジョブを並列実行します。

| ジョブ | 内容 |
|---|---|
| backend | ruff（lint / format）、`manage.py check`、pytest（カバレッジ付き）、`pip-audit -r requirements.txt` |
| frontend | `npm ci`、lint、テスト、ビルド、`npm audit --omit=dev --audit-level=critical` |
| terraform | `terraform fmt -check`、`init -backend=false`、`validate` |
| docker-build | `Dockerfile.lambda` のビルド確認（push はしない） |

- 依存監査（`pip-audit` / `npm audit`）もジョブの成否に含まれます。監査で指摘があった場合は、該当する依存を更新してから再実行してください。
- ワークフローの権限は `contents: read` のみで、同じブランチの古い実行は自動でキャンセルされます。
- 依存の更新は Dependabot（`.github/dependabot.yml`）が週次で PR を作成します。

## デプロイの概要

詳細な手順は [README](README.md) を参照してください。大まかな流れは次のとおりです。

1. `Dockerfile.lambda` からコンテナイメージをビルドする
2. イメージを Amazon ECR に push する
3. Terraform（`infra/`）で Lambda・API Gateway・S3・CloudFront を作成 / 更新する
   - Terraform のステートは S3 バックエンド（`infra/backend.tf`）で管理します
   - Lambda のイメージ URI などの値は `infra/terraform.tfvars` で指定します（コミットしません）
4. Django の `SECRET_KEY` は SSM Parameter Store の SecureString に保存し、Lambda からはパラメータ名（`DJANGO_SECRET_KEY_SSM_PARAM`）で参照します
5. データベース（Aurora DSQL）のテーブル作成と学習データの投入は、Lambda の直接呼び出し（`{"manage":"migrate"}` / `{"manage":"seed"}`）で行います（[README](README.md) の「データベースの初期化」）
