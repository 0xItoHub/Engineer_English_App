// クエリの取得状況から、画面に出す状態（読み込み中・オフライン・エラーなど）を決める
import type { FetchStatus } from "@tanstack/react-query";
import { statusOf } from "./http";

export const OFFLINE_MESSAGE = "オフラインです。接続を確認してください。";

// 取得状況の判定に使うクエリの情報
type QueryLike = {
  data: unknown;
  isError: boolean;
  isLoading: boolean;
  fetchStatus: FetchStatus;
};

export type QueryView = "ready" | "loading" | "offline" | "error" | "idle";

// 表示するデータの有無と取得状況から、画面に出す状態を決める
// - データがあれば表示を優先する（再取得の失敗時もそのまま表示）
// - 通信できず取得が保留されている間はオフラインの案内を表示する
export function queryView(query: QueryLike): QueryView {
  if (query.data !== undefined) return "ready";
  if (query.fetchStatus === "paused") return "offline";
  if (query.isError) return "error";
  if (query.isLoading) return "loading";
  return "idle";
}

// API が 404 を返したか（データが存在しない）
export function isNotFoundError(err: unknown): boolean {
  return statusOf(err) === 404;
}
