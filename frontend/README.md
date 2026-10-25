# Engineer English App — フロントエンド

エンジニアの実務シーンに沿って英語を学ぶ Web アプリのフロントエンドです。
プロジェクト全体の構成・バックエンド・デプロイ手順は [ルートの README](../README.md) を参照してください。

## 技術スタック

- React 19 / TypeScript 6.0
- Vite 8（`@vitejs/plugin-react`）
- MUI 9（`@mui/material` / `@mui/icons-material`）
- TanStack Query 5（API レスポンスのキャッシュ・画面間での共有）
- React Router 8（`react-router`）
- axios（インターセプターでエラーを一元処理・API 宛てのみアクセストークンを付与）
- oidc-client-ts / react-oidc-context（Amazon Cognito によるログイン。認可コード + PKCE）
- Vitest + React Testing Library（jsdom）
- ESLint（フラット設定 `eslint.config.js`、typescript-eslint / react-hooks / react-refresh）

> TypeScript は typescript-eslint の対応範囲（6.0 系）に合わせています。

## セットアップ

Node.js 22.22 以上が必要です（Vite 8 / React Router 8 の要件。CI も Node.js 22 を使用）。

```bash
cd frontend
npm ci
npm run dev   # http://localhost:3000
```

バックエンド（Django）をローカルで `http://127.0.0.1:8000` に起動しておくと、開発サーバーが `/api/...` へのリクエストを中継し（`vite.config.ts` の `server.proxy`）、API と接続して動作を確認できます。
API に接続できない場合でも画面は表示され、学習進捗はブラウザの localStorage に保存されます。

## 環境変数

Vite の仕様により、`VITE_` で始まる変数がビルド時に埋め込まれます（秘密情報は設定しないでください）。
型定義は `src/vite-env.d.ts`、参照箇所は `src/lib/config.ts` に一元化しています。

| 変数 | 内容 | 既定値 |
|---|---|---|
| `VITE_API_BASE_URL` | API のベース URL（任意。別オリジンの API を呼び出す場合のみ指定） | 空（同一オリジンの `/api/...` を呼び出す） |
| `VITE_COGNITO_AUTHORITY` | Cognito ユーザープールの OIDC 発行者 URL（`https://cognito-idp.<region>.amazonaws.com/<userPoolId>`） | 空（ログイン機能なし） |
| `VITE_COGNITO_CLIENT_ID` | Cognito アプリクライアント ID（クライアントシークレットなしのパブリッククライアント） | 空（ログイン機能なし） |
| `VITE_COGNITO_DOMAIN` | マネージドログインのドメイン（`https://<prefix>.auth.<region>.amazoncognito.com`。ログアウトに使用） | 空（ログイン機能なし） |

Cognito の 3 つの変数がすべてそろった場合のみ、ヘッダーにログインボタンを表示します。
いずれかが未設定の場合はログイン機能を表示せず、これまでどおり匿名で利用できます（学習進捗はブラウザに保存）。
GitHub Actions のデプロイでは、リポジトリ変数 `COGNITO_AUTHORITY` / `COGNITO_CLIENT_ID` / `COGNITO_DOMAIN` からビルド時に設定します。

本番環境・ローカル開発ともに、通常は未設定のままで利用します。

- 本番環境: CloudFront が SPA と `/api/*`（バックエンドへの中継）を同一オリジンで配信するため、相対パスの `/api/...` で API に接続します。
- ローカル開発: Vite の proxy（`npm run dev` / `npm run preview`）経由でバックエンドに接続します。

別オリジンの API を使う場合は `frontend/.env.local` に記述します（Git 管理対象外）。

```bash
VITE_API_BASE_URL=http://localhost:8000
```

## ログイン（Amazon Cognito）

Cognito のマネージドログイン画面を利用し、OAuth 2.0 認可コードフロー + PKCE でログインします（スコープ: `openid email profile`）。

1. ヘッダーの「ログイン」から Cognito のログイン画面へ移動します（現在の画面を戻り先として保存）。
2. ログイン後は `/auth/callback` に戻り、トークンを取得してから元の画面へ移動します。戻り先は同一オリジン内のパス（`/` で始まり `//` で始まらないもの）のみ受け付けます。
3. ログイン中は、自サービスの API（同一オリジンの `/api/...`、または `VITE_API_BASE_URL` のオリジン）宛てのリクエストにのみ `Authorization: Bearer <アクセストークン>` を付与します。
4. API が 401 を返した場合は、リフレッシュトークンでトークンを 1 回更新して再送します。それでも 401 の場合はログアウト状態に戻し、再ログインを案内します。
5. 「ログアウト」でブラウザのログイン情報を削除し、Cognito のログアウトエンドポイント（`/logout?client_id=...&logout_uri=<オリジン>/`）を経由してトップページへ戻ります。

Cognito のアプリクライアントには、コールバック URL `https://<配信ドメイン>/auth/callback` とサインアウト URL `https://<配信ドメイン>/` を登録します。

- トークンは sessionStorage に保存します（タブを閉じると破棄。localStorage には保存しません）。
- ログイン中の学習履歴・シーンの完了状況は、アカウントに保存された進捗（`/api/progress/my_progress/`）を表示します。進捗のキャッシュはユーザーごとに分け、ログアウト時に削除します。
- ログイン直後（タブごとに 1 回）、ブラウザに保存されていた進捗をアカウントへ反映します。API のレート制限に合わせて 1 回あたり最大 30 件を順番に送信し、429 を受け取った場合は残りを次回に持ち越します。反映できた進捗はブラウザから削除します。
- ログイン中にレッスンを完了した場合も、まずブラウザに保存してからアカウントへ送信し、保存できた時点でブラウザの記録を削除します。

ローカルでログインを試す場合は、`frontend/.env.local`（Git 管理対象外）に 3 つの変数を設定し、アプリクライアントに `http://localhost:3000/auth/callback` と `http://localhost:3000/` を登録します。

## npm スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバーを起動（http://localhost:3000） |
| `npm run build` | 型チェック後、本番用ビルドを `build/` に出力 |
| `npm run preview` | ビルド結果をローカルで配信して確認 |
| `npm run typecheck` | TypeScript の型チェック |
| `npm run lint` | ESLint を実行（警告 0 件を必須） |
| `npm test` | テストをウォッチモードで実行（Vitest） |
| `npm run test:ci` | テストを 1 回だけ実行（CI 向け） |

コード整形のルールは `.prettierrc` にまとめています（エディタの Prettier 連携で利用できます）。

## ディレクトリ構成

```
src/
├─ App.tsx                 # ルーティング・テーマ・共通レイアウト
├─ ScenesList.tsx          # ホーム（概要・収録コンテンツ数・シーン一覧・技術スタック）
├─ SceneDetail.tsx         # シーン詳細（レッスン一覧）
├─ LessonDetail.tsx        # レッスン（フレーズ・対話・読み上げ）
├─ ProgressHistory.tsx     # 学習履歴
├─ components/             # 背景アニメーション・ホーム画面の各セクション・チャット・フッター・ErrorBoundary・ログイン関連
├─ hooks/                  # チャットクライアント・prefers-reduced-motion
├─ lib/                    # API 接続先の設定・データ取得（queries.ts）・HTTP エラー処理・localStorage ヘルパー・ログイン（auth.ts / authHttp.ts / progressSync.ts）
└─ test/                   # テスト用の描画ヘルパー（QueryClientProvider 付き）
```

## データ取得

API の取得処理は TanStack Query で管理し、クエリキーとクエリ関数を `src/lib/queries.ts` にまとめています。

- `/api/scenes/` の結果はホーム・シーン詳細・学習履歴で共有し、収録コンテンツ数もこの結果から集計します。
- 教材データ（シーン・レッスン）は 5 分間キャッシュを再利用し、学習進捗は画面表示ごとに最新を取得します。
- 取得に失敗した場合は 1 回だけ再試行します（4xx は再試行しません）。
- 画面遷移などで不要になったリクエストは、クエリの `signal` により中断されます。
- レッスン完了時は、進捗をブラウザに保存したうえでサーバに送信します（`useMutation`）。
- 学習進捗のクエリキーにはログイン中のユーザー（未ログイン時は `anonymous`）を含め、ユーザー間でキャッシュが混ざらないようにしています。

## エラーハンドリングとアクセシビリティ

- 描画中のエラーは ErrorBoundary が受け止め、再試行・再読み込みできるフォールバックを表示します。
- API の 4xx / 5xx は axios のインターセプターで一元的に処理し、画面にはユーザー向けのメッセージを表示します。
- OS の「視差効果を減らす」設定（`prefers-reduced-motion`）に合わせて背景アニメーションを停止します。
- 音声読み上げ（Web Speech API）に対応していないブラウザでは、読み上げボタンを無効化して案内を表示します。

## ビルドとデプロイ

```bash
npm run build
```

`build/` の内容を S3 にアップロードし、CloudFront から配信します。
API は同一オリジンの `/api/...` で呼び出すため、通常は `VITE_API_BASE_URL` を指定せずにビルドします。

ビルド結果をローカルで確認する場合は、バックエンドを `http://127.0.0.1:8000` で起動したうえで `npm run preview` を実行します（`/api` は開発サーバーと同じくバックエンドへ中継されます）。
インフラ構成とデプロイ手順の詳細は [ルートの README](../README.md) を参照してください。
