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

// ---- ローカル学習進捗（未ログイン時・アカウントへの保存待ちの保存先） ----

export const LOCAL_PROGRESS_KEY = "ee_local_progress";
// 同じタブ内での書き込みを購読者へ知らせるイベント（他のタブの変更は storage イベントで受け取る）
export const LOCAL_PROGRESS_EVENT = "ee-local-progress-change";

export type LocalProgressEntry = {
  lesson: number;
  score: number;
  time_spent: number;
  // 記録したユーザー（Cognito の sub。未ログイン時の記録は null）
  owner: string | null;
  // 完了日時（ISO 8601。日時を記録していないデータは null）
  completed_at: string | null;
};

// 保存時に owner・completed_at を省略した場合は、未ログインの記録・現在時刻として扱う
export type LocalProgressInput = Omit<LocalProgressEntry, "owner" | "completed_at"> &
  Partial<Pick<LocalProgressEntry, "owner" | "completed_at">>;

function isLocalProgressEntry(x: unknown): x is LocalProgressEntry {
  const e = x as LocalProgressEntry | null;
  return !!e && typeof e === "object" && typeof e.lesson === "number" && Number.isFinite(e.lesson);
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

// 保存形式をそろえる（owner・completed_at が無いデータは未ログインの記録・日時不明として読み込む）
function normalize(e: LocalProgressEntry): LocalProgressEntry {
  return {
    lesson: e.lesson,
    score: typeof e.score === "number" ? e.score : 0,
    time_spent: typeof e.time_spent === "number" ? e.time_spent : 0,
    owner: typeof e.owner === "string" && e.owner ? e.owner : null,
    completed_at: isValidDate(e.completed_at) ? e.completed_at : null,
  };
}

function parseLocalProgress(raw: string | null): LocalProgressEntry[] {
  if (raw == null) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(isLocalProgressEntry).map(normalize) : [];
  } catch {
    return [];
  }
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(LOCAL_PROGRESS_KEY);
  } catch {
    return null;
  }
}

// 形式の整った進捗だけを返す
export function readLocalProgress(): LocalProgressEntry[] {
  return parseLocalProgress(readRaw());
}

function writeLocalProgress(list: LocalProgressEntry[]): void {
  if (!writeJSON(LOCAL_PROGRESS_KEY, list)) return;
  try {
    window.dispatchEvent(new Event(LOCAL_PROGRESS_EVENT));
  } catch {
    // イベントを送れない環境では何もしない
  }
}

type EntryKey = Pick<LocalProgressEntry, "lesson" | "owner">;
const sameEntry = (a: EntryKey, b: EntryKey) => a.lesson === b.lesson && a.owner === b.owner;

// 同じユーザー・同じレッスンは上書き（スコアは高い方、時間と完了日時は最新を保持）
export function pushLocalProgress(input: LocalProgressInput): void {
  const item: LocalProgressEntry = {
    lesson: input.lesson,
    score: input.score,
    time_spent: input.time_spent,
    owner: input.owner ?? null,
    completed_at: input.completed_at ?? new Date().toISOString(),
  };
  const list = readLocalProgress();
  const idx = list.findIndex((x) => sameEntry(x, item));
  if (idx >= 0) {
    const cur = list[idx];
    list[idx] = { ...cur, score: Math.max(cur.score, item.score), time_spent: item.time_spent, completed_at: item.completed_at };
  } else {
    list.push(item);
  }
  writeLocalProgress(list);
}

// サーバへ保存できた進捗をブラウザから削除する
// 保存後により高いスコアが記録されていた場合は、次回の反映に備えて残しておく
export function removeLocalProgressEntry(saved: LocalProgressInput): void {
  const key: EntryKey = { lesson: saved.lesson, owner: saved.owner ?? null };
  const list = readLocalProgress();
  const next = list.filter((x) => !(sameEntry(x, key) && x.score <= saved.score));
  if (next.length !== list.length) writeLocalProgress(next);
}

// 画面に表示する進捗だけを返す
// - 未ログイン時（sub が null）は未ログインで記録した進捗
// - ログイン中は、そのユーザーのアカウントへの保存待ちの進捗（他のユーザーの記録は表示しない）
export function visibleLocalProgress(list: LocalProgressEntry[], sub: string | null): LocalProgressEntry[] {
  return list.filter((e) => e.owner === sub);
}

// ---- 画面からの購読（useSyncExternalStore 用） ----

let cachedRaw: string | null = null;
let cachedList: LocalProgressEntry[] = [];

// 保存内容が変わったときだけ解析し直し、同じ内容であれば同じ配列を返す
export function getLocalProgressSnapshot(): LocalProgressEntry[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parseLocalProgress(raw);
  }
  return cachedList;
}

export function subscribeLocalProgress(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === LOCAL_PROGRESS_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(LOCAL_PROGRESS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LOCAL_PROGRESS_EVENT, onChange);
  };
}

// ---- 読み上げ速度（ブラウザごとに前回選んだ速度を使う） ----

export const SPEECH_RATE_KEY = "ee_speech_rate";

// 選択肢に含まれる速度だけを読み込む（保存されていない・形式が正しくない場合は既定値）
export function readSpeechRate(allowed: readonly number[], fallback: number): number {
  const value = readJSON<unknown>(SPEECH_RATE_KEY, null);
  return typeof value === "number" && allowed.includes(value) ? value : fallback;
}

export function writeSpeechRate(rate: number): boolean {
  return writeJSON(SPEECH_RATE_KEY, rate);
}
