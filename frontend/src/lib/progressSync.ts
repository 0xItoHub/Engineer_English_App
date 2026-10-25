// ブラウザに保存された学習進捗を、ログイン後にアカウントへ反映する
// - API のレート制限（1 分あたり 30 件）に合わせ、1 回の反映は最大 30 件まで順番に送信する
// - 429 を受け取った時点で中断し、残りは次回の反映まで保持する
import type { ApiError } from "./http";
import { readLocalProgress, removeLocalProgressEntry, type LocalProgressEntry } from "./storage";

export const MAX_SYNC_ENTRIES = 30;

export type SyncResult = {
  uploaded: number;
  remaining: number;
  rateLimited: boolean;
};

export type PostEntry = (entry: LocalProgressEntry) => Promise<unknown>;

export async function syncLocalProgress(post: PostEntry, max: number = MAX_SYNC_ENTRIES): Promise<SyncResult> {
  const entries = readLocalProgress().slice(0, max);
  let uploaded = 0;
  let rateLimited = false;
  for (const entry of entries) {
    try {
      await post(entry);
      removeLocalProgressEntry(entry);
      uploaded += 1;
    } catch (err) {
      const status = (err as ApiError | null)?.response?.status;
      // レート制限やログイン切れの場合は中断し、それ以外は次の進捗へ進む（未送信分はブラウザに残る）
      if (status === 429) {
        rateLimited = true;
        break;
      }
      if (status === 401) break;
    }
  }
  return { uploaded, remaining: readLocalProgress().length, rateLimited };
}

const SYNCED_KEY_PREFIX = "ee_progress_synced:";

// このタブ（セッション）で初めての反映であれば記録して true を返す（ユーザーごとに記録する）
export function markSyncStarted(sub: string): boolean {
  const key = `${SYNCED_KEY_PREFIX}${sub}`;
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}
