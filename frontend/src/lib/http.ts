import axios, { AxiosError, AxiosInstance } from "axios";

// API エラーに付与するユーザー向けメッセージ
export type ApiError = AxiosError & { userMessage?: string };

// HTTP ステータスからユーザー向けの分かりやすいメッセージを組み立てる
export function messageForStatus(status?: number): string {
  if (!status) return "サーバーに接続できませんでした。通信環境を確認して、しばらくしてから再度お試しください。";
  if (status === 401) return "ログインの有効期限が切れました。もう一度ログインしてください。";
  if (status === 403) return "この操作を行う権限がありません。";
  if (status === 404) return "お探しのデータが見つかりませんでした。";
  if (status === 408) return "通信がタイムアウトしました。しばらくしてから再度お試しください。";
  if (status === 429) return "アクセスが集中しています。しばらく待ってから再度お試しください。";
  if (status === 503) return "一時的に利用できません。しばらくしてから再度お試しください。";
  if (status >= 500) return "サーバーでエラーが発生しました。しばらくしてから再度お試しください。";
  if (status >= 400) return "リクエストを処理できませんでした。";
  return "予期しないエラーが発生しました。";
}

const MAX_DETAIL_LENGTH = 200;

// API が返す説明文（{"detail": "..."}）のうち、そのまま表示できるプレーンテキストだけを取り出す
export function safeDetail(data: unknown): string | null {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail !== "string") return null;
  const text = detail.trim();
  if (!text || text.length > MAX_DETAIL_LENGTH) return null;
  // HTML のような文字列や制御文字を含むものは表示しない
  // eslint-disable-next-line no-control-regex
  if (/[<>\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

// レスポンスからユーザー向けメッセージを決める
// - API の説明文があれば優先して表示する
// - 401 はログインし直す案内を表示する
export function messageForResponse(status?: number, data?: unknown): string {
  if (status && status !== 401) {
    const detail = safeDetail(data);
    if (detail) return detail;
  }
  return messageForStatus(status);
}

// HTTP ステータスを取り出す（取得できない場合は undefined）
export function statusOf(err: unknown): number | undefined {
  return (err as ApiError | null)?.response?.status;
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
    return messageForResponse(e.response?.status, e.response?.data);
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
        error.userMessage = messageForResponse(status, error?.response?.data);
      }
      if (import.meta.env.MODE !== "test") {
        const method = error?.config?.method?.toUpperCase() ?? "";
        const url = error?.config?.url ?? "";
        const log = status && status < 500 ? console.warn : console.error;
        log(`[API] ${method} ${url} -> ${status ?? "network error"}`);
      }
      return Promise.reject(error);
    }
  );
}
