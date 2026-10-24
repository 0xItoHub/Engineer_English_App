/// <reference types="vite/client" />

// ビルド時に埋め込まれる環境変数（VITE_ で始まるもののみ。秘密情報は設定しない）
interface ImportMetaEnv {
  // API のベース URL（未設定なら同一オリジンへの相対パスで呼び出す）
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
