/// <reference types="vite/client" />

// ビルド時に埋め込まれる環境変数（VITE_ で始まるもののみ。秘密情報は設定しない）
interface ImportMetaEnv {
  // API のベース URL（未設定なら同一オリジンへの相対パスで呼び出す）
  readonly VITE_API_BASE_URL?: string;
  // Amazon Cognito（すべてそろった場合のみログイン機能を表示する。いずれも公開して問題のない値）
  // OIDC の発行者 URL（https://cognito-idp.<region>.amazonaws.com/<userPoolId>）
  readonly VITE_COGNITO_AUTHORITY?: string;
  // アプリクライアント ID（クライアントシークレットなしのパブリッククライアント）
  readonly VITE_COGNITO_CLIENT_ID?: string;
  // マネージドログインのドメイン（ログアウトに使用。https://<prefix>.auth.<region>.amazoncognito.com）
  readonly VITE_COGNITO_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
