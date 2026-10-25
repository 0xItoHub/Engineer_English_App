import { useMemo } from "react";
import { useAppAuth } from "../lib/auth";
import { mergeProgress, useMyProgressQuery, type ProgressItem } from "../lib/queries";
import { useLocalProgress } from "./useLocalProgress";

// 画面に表示する学習進捗（アカウントの進捗 + ブラウザに保存した本人の進捗）
// - 未ログイン時は、未ログインで記録した進捗を表示する
// - ログイン中は、アカウントの進捗に、保存待ちの本人の進捗を合わせて表示する（他のユーザーの記録は表示しない）
export function useLearningProgress() {
  const auth = useAppAuth();
  const sub = auth.isAuthenticated ? auth.sub : null;
  const query = useMyProgressQuery();
  const local = useLocalProgress(sub);
  const items = useMemo<ProgressItem[]>(() => mergeProgress(query.data ?? [], local), [query.data, local]);
  return { query, items, authLoading: auth.isLoading };
}
