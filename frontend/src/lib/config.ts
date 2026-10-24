// API の接続先（ビルド時に VITE_API_BASE_URL で指定）
// 未設定の場合は空文字となり、同一オリジンへの相対パス（開発時は Vite の proxy 経由）で呼び出す
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '';
