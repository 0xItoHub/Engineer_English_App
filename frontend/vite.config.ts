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
    rolldownOptions: {
      output: {
        // ライブラリは更新頻度が低いため、アプリのコードと分けてブラウザのキャッシュを長く使えるようにする
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 30 },
            { name: 'vendor-mui', test: /[\\/]node_modules[\\/](@mui[\\/](?!icons-material)[^\\/]+|@emotion|@popperjs|react-transition-group|stylis|@babel[\\/]runtime)[\\/]/, priority: 20 },
            { name: 'vendor-oidc', test: /[\\/]node_modules[\\/](oidc-client-ts|react-oidc-context|jwt-decode)[\\/]/, priority: 10 },
          ],
        },
      },
    },
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
