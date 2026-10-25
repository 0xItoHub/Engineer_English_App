// ブラウザに保存された学習進捗を、ログイン後にアカウントへ反映する
// - 反映するのは、未ログインで記録した進捗と、ログイン中のユーザー本人の保存待ちの進捗のみ（他のユーザーの記録は送信しない）
// - API のレート制限（1 分あたり 30 件）に合わせ、1 回の反映は最大 30 件まで順番に送信する
// - 429 を受け取った時点で中断し、残りは次回の反映まで保持する
import { statusOf } from "./http";
import { readLocalProgress, removeLocalProgressEntry, type LocalProgressEntry } from "./storage";

export const MAX_SYNC_ENTRIES = 30;

export type SyncResult = {
  uploaded: number;
  // まだ反映していない、このユーザーが反映できる進捗の件数
  remaining: number;
  rateLimited: boolean;
  // ログイン切れや通信エラーで中断した場合は true（同じタブでの再実行の対象にする）
  interrupted: boolean;
};

export type PostEntry = (entry: LocalProgressEntry) => Promise<unknown>;

// ユーザー sub がアカウントへ反映してよい進捗
export function syncableEntries(sub: string): LocalProgressEntry[] {
  return readLocalProgress().filter((e) => e.owner === null || e.owner === sub);
}

export async function syncLocalProgress(sub: string, post: PostEntry, max: number = MAX_SYNC_ENTRIES): Promise<SyncResult> {
  const entries = syncableEntries(sub).slice(0, max);
  let uploaded = 0;
  let rateLimited = false;
  let interrupted = false;
  for (const entry of entries) {
    try {
      await post(entry);
      removeLocalProgressEntry(entry);
      uploaded += 1;
    } catch (err) {
      const status = statusOf(err);
      // レート制限・ログイン切れ・通信エラーの場合は中断し、それ以外は次の進捗へ進む（未送信分はブラウザに残る）
      if (status === 429) {
        rateLimited = true;
        break;
      }
      if (status === 401 || status === undefined) {
        interrupted = true;
        break;
      }
    }
  }
  return { uploaded, remaining: syncableEntries(sub).length, rateLimited, interrupted };
}

const SYNCED_KEY_PREFIX = "ee_progress_synced:";
const running = new Set<string>();

// このタブ（セッション）で、ユーザーの反映がすでに完了しているか
export function hasSynced(sub: string): boolean {
  try {
    return !!window.sessionStorage.getItem(`${SYNCED_KEY_PREFIX}${sub}`);
  } catch {
    return false;
  }
}

// 反映を最後まで実行できたことを記録する（ユーザーごとに記録する）
export function markSynced(sub: string): void {
  try {
    window.sessionStorage.setItem(`${SYNCED_KEY_PREFIX}${sub}`, "1");
  } catch {
    // 記録できない環境では、次回の画面表示時に改めて反映する
  }
}

// ログアウト時に記録を消し、次回のログイン時に改めて反映する
export function clearSynced(sub: string): void {
  try {
    window.sessionStorage.removeItem(`${SYNCED_KEY_PREFIX}${sub}`);
  } catch {
    // 記録を消せない環境では何もしない
  }
}

// ログイン後の反映を 1 回だけ実行する
// - 実行中の反映と重ならないようにし、最後まで実行できた場合のみ完了として記録する
// - 反映する進捗が無い、またはすでに完了している場合は null を返す
export async function runInitialSync(sub: string, post: PostEntry): Promise<SyncResult | null> {
  if (running.has(sub) || hasSynced(sub)) return null;
  if (syncableEntries(sub).length === 0) return null;
  running.add(sub);
  try {
    const result = await syncLocalProgress(sub, post);
    if (!result.interrupted) markSynced(sub);
    return result;
  } finally {
    running.delete(sub);
  }
}
