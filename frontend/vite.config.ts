/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // SPA は CloudFront のルートで配信し、/scene/1 などの深いパスでもアセットを解決できるよう絶対パスにする
  base: '/',
  build: {
    // デプロイ手順（S3 への同期）に合わせて build/ に出力する
    outDir: 'build',
    // MUI を含む単一バンドル構成に合わせた上限値（ルート単位のコード分割は今後の改善で検討）
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 3000,
    // ローカル開発では API を Django の開発サーバーへ中継する
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    css: false,
  },
});
