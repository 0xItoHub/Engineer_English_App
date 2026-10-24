// テスト用の描画ヘルパー
// テストごとに新しい QueryClient を用意し、キャッシュがテスト間で共有されないようにする
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // 失敗時の挙動をすぐに確認できるよう、テストでは再試行しない
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithClient(ui: ReactElement, client: QueryClient = createTestQueryClient()) {
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}
