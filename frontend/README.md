# Engineer English App — フロントエンド

エンジニアの実務シーンに沿って英語を学ぶ Web アプリのフロントエンドです。
プロジェクト全体の構成・バックエンド・デプロイ手順は [ルートの README](../README.md) を参照してください。

## 技術スタック

- React 19 / TypeScript 6.0
- Vite 8（`@vitejs/plugin-react`）
- MUI 7（`@mui/material` / `@mui/icons-material`）
- React Router 7
- axios
- Vitest + React Testing Library（jsdom）
- ESLint（フラット設定 `eslint.config.js`、typescript-eslint / react-hooks / react-refresh）

> TypeScript は typescript-eslint の対応範囲（6.0 系）に合わせています。

## セットアップ

Node.js 22.12 以上が必要です（Vite 8 / Vitest の要件。CI も Node.js 22 を使用）。

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
| `VITE_API_BASE_URL` | API のベース URL（例: API Gateway の URL） | 空（同一オリジンの `/api/...` を呼び出す） |

ローカル開発では未設定のままで、Vite の proxy 経由でバックエンドに接続できます。
別の API を使う場合は `frontend/.env.local` に記述します（Git 管理対象外）。

```bash
VITE_API_BASE_URL=http://localhost:8000
```

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
├─ ScenesList.tsx          # シーン一覧（トップ）
├─ SceneDetail.tsx         # シーン詳細（レッスン一覧）
├─ LessonDetail.tsx        # レッスン（フレーズ・対話・読み上げ）
├─ ProgressHistory.tsx     # 学習履歴
├─ components/             # 背景アニメーション・チャット・フッター・ErrorBoundary
├─ hooks/                  # チャットクライアント・prefers-reduced-motion
└─ lib/                    # API 接続先の設定・HTTP エラー処理・localStorage ヘルパー
```

## エラーハンドリングとアクセシビリティ

- 描画中のエラーは ErrorBoundary が受け止め、再試行・再読み込みできるフォールバックを表示します。
- API の 4xx / 5xx は axios のインターセプターで一元的に処理し、画面にはユーザー向けのメッセージを表示します。
- OS の「視差効果を減らす」設定（`prefers-reduced-motion`）に合わせて背景アニメーションを停止します。
- 音声読み上げ（Web Speech API）に対応していないブラウザでは、読み上げボタンを無効化して案内を表示します。

## ビルドとデプロイ

```bash
VITE_API_BASE_URL=<API のベース URL> npm run build
```

`build/` の内容を S3 にアップロードし、CloudFront から配信します。
インフラ構成とデプロイ手順の詳細は [ルートの README](../README.md) を参照してください。
