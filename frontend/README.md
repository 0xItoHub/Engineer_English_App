# Engineer English App — フロントエンド

エンジニアの実務シーンに沿って英語を学ぶ Web アプリのフロントエンドです。
プロジェクト全体の構成・バックエンド・デプロイ手順は [ルートの README](../README.md) を参照してください。

## 技術スタック

- React 19 / TypeScript 4.9（Create React App 5 / react-scripts 5.0.1）
- MUI 7（`@mui/material` / `@mui/icons-material`）
- React Router 7
- axios
- Jest + React Testing Library

> TypeScript は react-scripts 5 の対応範囲に合わせて 4.9 系を使用しています。

## セットアップ

Node.js 20 以上が必要です（React Router 7 の要件）。

```bash
cd frontend
npm ci
npm start   # http://localhost:3000
```

バックエンド（Django）をローカルで `http://localhost:8000` に起動しておくと、API と接続して動作を確認できます。
API に接続できない場合でも画面は表示され、学習進捗はブラウザの localStorage に保存されます。

## 環境変数

CRA の仕様により、`REACT_APP_` で始まる変数がビルド時に埋め込まれます（秘密情報は設定しないでください）。

| 変数 | 内容 | 既定値 |
|---|---|---|
| `REACT_APP_API_BASE_URL` | 各画面が呼び出す API のベース URL（例: API Gateway の URL） | `http://localhost:8000` |
| `REACT_APP_API_BASE` | axios の `baseURL`（相対パスでの呼び出し用） | `/` |

ローカルで値を変える場合は `frontend/.env.local` に記述します（Git 管理対象外）。

```bash
REACT_APP_API_BASE_URL=http://localhost:8000
```

## npm スクリプト

| コマンド | 内容 |
|---|---|
| `npm start` | 開発サーバーを起動 |
| `npm test` | テストをウォッチモードで実行 |
| `npm run test:ci` | テストを 1 回だけ実行（CI 向け。`CI=true npm run test:ci`） |
| `npm run lint` | ESLint を実行（警告 0 件を必須） |
| `npm run build` | 本番用ビルドを `build/` に出力 |

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
└─ lib/                    # HTTP エラー処理・localStorage ヘルパー
```

## エラーハンドリングとアクセシビリティ

- 描画中のエラーは ErrorBoundary が受け止め、再試行・再読み込みできるフォールバックを表示します。
- API の 4xx / 5xx は axios のインターセプターで一元的に処理し、画面にはユーザー向けのメッセージを表示します。
- OS の「視差効果を減らす」設定（`prefers-reduced-motion`）に合わせて背景アニメーションを停止します。
- 音声読み上げ（Web Speech API）に対応していないブラウザでは、読み上げボタンを無効化して案内を表示します。

## ビルドとデプロイ

```bash
REACT_APP_API_BASE_URL=<API のベース URL> npm run build
```

`build/` の内容を S3 にアップロードし、CloudFront から配信します。
インフラ構成とデプロイ手順の詳細は [ルートの README](../README.md) を参照してください。
