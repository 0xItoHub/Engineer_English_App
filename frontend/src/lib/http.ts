import axios, { AxiosError, AxiosInstance } from "axios";

// API エラーに付与するユーザー向けメッセージ
export type ApiError = AxiosError & { userMessage?: string };

// HTTP ステータスからユーザー向けの分かりやすいメッセージを組み立てる
export function messageForStatus(status?: number): string {
  if (!status) return "サーバーに接続できませんでした。通信環境を確認して、しばらくしてから再度お試しください。";
  if (status === 401 || status === 403) return "この操作を行う権限がありません。";
  if (status === 404) return "お探しのデータが見つかりませんでした。";
  if (status === 408 || status === 429) return "アクセスが集中しています。しばらくしてから再度お試しください。";
  if (status >= 500) return "サーバーでエラーが発生しました。しばらくしてから再度お試しください。";
  if (status >= 400) return "リクエストを処理できませんでした。";
  return "予期しないエラーが発生しました。";
}

// リクエストの中断（画面遷移時の AbortController など）かどうか
export function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; code?: string } | null;
  return !!e && (e.name === "CanceledError" || e.name === "AbortError" || e.code === "ERR_CANCELED");
}

// 画面表示用のエラーメッセージを取り出す
export function getErrorMessage(err: unknown): string {
  const e = err as ApiError | null;
  if (e?.userMessage) return e.userMessage;
  if (e && typeof e === "object" && ("response" in e || "request" in e || e.isAxiosError)) {
    return messageForStatus(e.response?.status);
  }
  return "予期しないエラーが発生しました。";
}

const installed = new WeakSet<object>();

// レスポンスエラーを一元的に処理するインターセプター
// - ログ出力（テスト実行時は省略）
// - error.userMessage にユーザー向けメッセージを付与
// 呼び出し側の catch 処理はそのまま利用できるよう、エラーは reject し直す
export function setupHttpInterceptors(instance: AxiosInstance = axios): void {
  if (!instance?.interceptors?.response || installed.has(instance)) return;
  installed.add(instance);
  instance.interceptors.response.use(
    (response) => response,
    (error: ApiError) => {
      if (isAbortError(error)) return Promise.reject(error);
      const status = error?.response?.status;
      if (error && typeof error === "object") {
        error.userMessage = messageForStatus(status);
      }
      if (process.env.NODE_ENV !== "test") {
        const method = error?.config?.method?.toUpperCase() ?? "";
        const url = error?.config?.url ?? "";
        const log = status && status < 500 ? console.warn : console.error;
        log(`[API] ${method} ${url} -> ${status ?? "network error"}`);
      }
      return Promise.reject(error);
    }
  );
}
