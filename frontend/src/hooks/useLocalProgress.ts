import { useMemo, useSyncExternalStore } from "react";
import {
  getLocalProgressSnapshot,
  subscribeLocalProgress,
  visibleLocalProgress,
  type LocalProgressEntry,
} from "../lib/storage";

const EMPTY: LocalProgressEntry[] = [];
const getServerSnapshot = () => EMPTY;

// ブラウザに保存された学習進捗を購読する（同じタブ・他のタブでの保存に追従する）
// sub には表示中のユーザー（未ログイン時は null）を渡し、表示してよい進捗だけを受け取る
export function useLocalProgress(sub: string | null): LocalProgressEntry[] {
  const all = useSyncExternalStore(subscribeLocalProgress, getLocalProgressSnapshot, getServerSnapshot);
  return useMemo(() => visibleLocalProgress(all, sub), [all, sub]);
}
