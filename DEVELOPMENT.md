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
- DSQL はセーブポイントに対応しないため、トランザクション内では `get_or_create()` を使わず、検索（`filter().first()`）と作成（`create()`）を分けて書きます。同時作成による一意制約の競合（`IntegrityError`）も上記の再試行で処理します。
- 一覧の並び順はモデルの `Meta.ordering`（ID 順など）で固定しています。並び順のみの変更は SQL を発行しないマイグレーション（`AlterModelOptions`）になります。

### エラー応答

- API のエラーは `{"detail": "..."}` 形式の日本語の JSON で返します（`LANGUAGE_CODE = "ja"`、`core/exceptions.py`）。入力エラーは `detail` に加えて項目ごとの内訳を `errors` に入れます。
- データベースに接続できない場合は 503、想定外の例外は 500 を返し、例外の内容はログ（メソッドとパスのみ）に記録します。
- DRF を通らないパス（未定義の URL など）も `handler404` などで同じ形式の JSON を返します。

### CloudFront 経由のリクエストの確認

本番では `ORIGIN_VERIFY_SECRET` が設定され、`core.middleware.OriginVerifyMiddleware` が CloudFront からのリクエストかを確認し、閲覧者の IP アドレス（`X-Viewer-IP`）を `REMOTE_ADDR` に設定します（詳細は [infra/README.md](infra/README.md) の 8 章）。
ローカル開発・テストでは未設定のため、確認は行いません。

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

### 読み上げ音声の生成

フレーズ・対話の英文は、[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)（Apache-2.0）で事前に生成した MP3 を再生します（声: `af_heart`、速度 1.0）。
音声ファイルは `frontend/public/audio/<key>.mp3`、英文との対応表は `frontend/src/data/audioManifest.json` にあり、どちらもリポジトリに含めます。
対応表に無い英文は、ブラウザの音声合成（Web Speech API）で読み上げます。

`core/management/commands/seed_six_scenes.py` の英文を追加・変更したら、次の手順で音声を生成し直します（CI では実行しません）。

1. 依存をインストールします（アプリ用とは別に、リポジトリの外に仮想環境を作ります）。

   ```bash
   python3 -m venv ~/.venvs/kokoro-audio
   ~/.venvs/kokoro-audio/bin/pip install -r scripts/requirements-audio.txt
   ```

2. モデルファイル `kokoro-v1.0.onnx` と `voices-v1.0.bin` を [kokoro-onnx のリリース（model-files-v1.0）](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0) から取得し、リポジトリの外に置きます。
3. 英語の発音記号への変換に使う espeak-ng をインストールします（macOS: `brew install espeak-ng`）。
4. スクリプトを実行します。パスは引数または環境変数（`KOKORO_MODEL` / `KOKORO_VOICES` / `ESPEAK_LIB` / `ESPEAK_DATA`）で指定します。

   ```bash
   ~/.venvs/kokoro-audio/bin/python scripts/generate_audio.py \
     --model /path/to/kokoro-v1.0.onnx \
     --voices /path/to/voices-v1.0.bin \
     --espeak-lib "$(brew --prefix espeak-ng)/lib/libespeak-ng.dylib" \
     --espeak-data "$(brew --prefix espeak-ng)/share/espeak-ng-data" \
     --prune
   ```

   - まだ音声が無い英文だけを生成し、対応表を更新します（`--force` ですべて生成し直します）。
   - `--prune` を付けると、使われなくなった MP3 を削除します。
   - `--list` で、音声を生成せずに対象の英文とファイル名を確認できます。
   - `--help` で、その他の指定（声・速度など）を確認できます。

5. 生成した `frontend/public/audio/*.mp3` と `frontend/src/data/audioManifest.json` をコミットします。

ファイル名は英文と生成の条件から求めたハッシュのため、内容が変わるとファイル名も変わります。デプロイでは `audio/` を長期間キャッシュする設定でアップロードします（[frontend/README.md](frontend/README.md#ビルドとデプロイ) を参照）。

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
6. フロントエンドは `npm run build` の結果を S3 にアップロードします。ハッシュ付きのアセットは長期キャッシュ、`index.html` は `no-cache` を指定します（手順は [frontend/README.md](frontend/README.md) の「ビルドとデプロイ」）
