// localStorage への安全なアクセス
// プライベートモードや容量超過、壊れた JSON でも例外を外に出さずにフォールバック値を返す

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---- ローカル学習進捗（未ログイン時の保存先） ----

export const LOCAL_PROGRESS_KEY = "ee_local_progress";

export type LocalProgressEntry = {
  lesson: number;
  score: number;
  time_spent: number;
};

function isLocalProgressEntry(x: unknown): x is LocalProgressEntry {
  const e = x as LocalProgressEntry | null;
  return !!e && typeof e === "object" && typeof e.lesson === "number" && Number.isFinite(e.lesson);
}

// 形式の整った進捗だけを返す
export function readLocalProgress(): LocalProgressEntry[] {
  const list = readJSON<unknown>(LOCAL_PROGRESS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter(isLocalProgressEntry).map((e) => ({
    lesson: e.lesson,
    score: typeof e.score === "number" ? e.score : 0,
    time_spent: typeof e.time_spent === "number" ? e.time_spent : 0,
  }));
}

// 同じレッスンは上書き（スコアは高い方を保持）
export function pushLocalProgress(item: LocalProgressEntry): void {
  const list = readLocalProgress();
  const idx = list.findIndex((x) => x.lesson === item.lesson);
  if (idx >= 0) {
    list[idx] = { ...list[idx], score: Math.max(list[idx].score, item.score), time_spent: item.time_spent };
  } else {
    list.push(item);
  }
  writeJSON(LOCAL_PROGRESS_KEY, list);
}

// サーバへ保存できた進捗をブラウザから削除する
// 保存後により高いスコアが記録されていた場合は、次回の反映に備えて残しておく
export function removeLocalProgressEntry(saved: LocalProgressEntry): void {
  const list = readLocalProgress();
  const next = list.filter((x) => !(x.lesson === saved.lesson && x.score <= saved.score));
  if (next.length !== list.length) writeJSON(LOCAL_PROGRESS_KEY, next);
}
