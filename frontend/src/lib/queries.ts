// API の取得処理（TanStack Query のクエリキー・クエリ関数・フック）を一元管理する
// - 共通の axios インスタンス（インターセプター付き）を使うため、エラーには userMessage が付与される
// - クエリの signal を axios に渡し、画面遷移時などに不要になったリクエストを中断する
import axios from "axios";
import { QueryClient, useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { useAppAuth } from "./auth";
import { API_BASE_URL } from "./config";
import { isAbortError, type ApiError } from "./http";
import type { LocalProgressEntry } from "./storage";

// ---- API のレスポンス型 ----

export type Phrase = {
  id: number;
  text_en: string;
  text_ja: string;
  note: string;
};

export type Dialogue = {
  id: number;
  speaker: string;
  line_en: string;
  line_ja: string;
  order: number;
};

export type LessonSummary = {
  id: number;
  title: string;
  description: string;
};

export type Scene = {
  id: number;
  title: string;
  phrases?: Phrase[];
  dialogues?: Dialogue[];
  lessons?: LessonSummary[];
};

export type LessonDetail = LessonSummary & {
  scene: number;
  lesson_phrases?: Phrase[];
  lesson_dialogues?: Dialogue[];
};

// サーバに保存された学習進捗（/api/progress/my_progress/）
export type ServerProgress = {
  id?: number;
  lesson: number;
  lesson_title?: string;
  scene_title?: string;
  completed_at?: string;
  score: number;
  time_spent: number;
};

// ---- クエリキー ----

export const queryKeys = {
  scenes: ["scenes"] as const,
  scene: (id: number) => ["scenes", id] as const,
  lesson: (id: number) => ["lessons", id] as const,
  // 学習進捗はユーザーごとにキャッシュを分ける（未ログイン時は "anonymous"）
  myProgressAll: ["progress", "mine"] as const,
  myProgress: (sub: string | null) => ["progress", "mine", sub ?? ANONYMOUS_KEY] as const,
};

const ANONYMOUS_KEY = "anonymous";

// ログイン中のユーザーに紐づくキャッシュ（ログアウト時に削除する）
export function isUserScopedQuery(query: Pick<Query, "queryKey">): boolean {
  const key = query.queryKey;
  return key[0] === "progress" && key[1] === "mine" && key[2] !== ANONYMOUS_KEY;
}

// 教材データ（シーン・レッスン）は更新頻度が低いため、一定時間はキャッシュを再利用する
const CONTENT_STALE_TIME = 5 * 60 * 1000;

// 4xx はリトライしても結果が変わらないため、それ以外のエラーのみ 1 回だけ再試行する
function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = (error as ApiError | null)?.response?.status;
  if (status && status >= 400 && status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: CONTENT_STALE_TIME,
        retry: shouldRetry,
      },
    },
  });
}

// ---- クエリ関数 ----

const url = (path: string) => `${API_BASE_URL}${path}`;

export async function fetchScenes(signal?: AbortSignal): Promise<Scene[]> {
  const res = await axios.get(url("/api/scenes/"), { signal });
  return Array.isArray(res.data) ? res.data : [];
}

export async function fetchScene(id: number, signal?: AbortSignal): Promise<Scene> {
  const res = await axios.get(url(`/api/scenes/${id}/`), { signal });
  return res.data;
}

export async function fetchLesson(id: number, signal?: AbortSignal): Promise<LessonDetail> {
  const res = await axios.get(url(`/api/lessons/${id}/`), { signal });
  return res.data;
}

// 進捗はログインしていない場合なども取得できないため、その場合は空の一覧として扱う
export async function fetchMyProgress(signal?: AbortSignal): Promise<ServerProgress[]> {
  try {
    const res = await axios.get(url("/api/progress/my_progress/"), { signal });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    if (isAbortError(err)) throw err;
    return [];
  }
}

export type CompleteLessonInput = {
  lessonId: string;
  score: number;
  timeSpent: number;
};

export async function postCompleteLesson({ lessonId, score, timeSpent }: CompleteLessonInput): Promise<unknown> {
  const res = await axios.post(url("/api/progress/complete_lesson/"), {
    lesson_id: lessonId,
    score,
    time_spent: timeSpent,
  });
  return res?.data;
}

// ---- フック ----

// シーン一覧（ホーム・学習履歴で共有）
export function useScenesQuery() {
  return useQuery({
    queryKey: queryKeys.scenes,
    queryFn: ({ signal }) => fetchScenes(signal),
  });
}

// シーン詳細（一覧を取得済みであれば、その内容を初期表示に利用する）
export function useSceneQuery(id: number | undefined) {
  const queryClient = useQueryClient();
  const sceneId = id ?? NaN;
  return useQuery({
    queryKey: queryKeys.scene(sceneId),
    queryFn: ({ signal }) => fetchScene(sceneId, signal),
    enabled: Number.isFinite(sceneId),
    initialData: () => queryClient.getQueryData<Scene[]>(queryKeys.scenes)?.find((s) => s.id === sceneId),
    initialDataUpdatedAt: () => queryClient.getQueryState(queryKeys.scenes)?.dataUpdatedAt,
  });
}

export function useLessonQuery(id: number | undefined) {
  const lessonId = id ?? NaN;
  return useQuery({
    queryKey: queryKeys.lesson(lessonId),
    queryFn: ({ signal }) => fetchLesson(lessonId, signal),
    enabled: Number.isFinite(lessonId),
  });
}

// 学習進捗は短い間隔で再取得する（レッスン完了時はキャッシュを更新して即時に反映）
const PROGRESS_STALE_TIME = 30 * 1000;

export function useMyProgressQuery() {
  const auth = useAppAuth();
  const sub = auth.isAuthenticated ? auth.sub : null;
  return useQuery({
    queryKey: queryKeys.myProgress(sub),
    queryFn: ({ signal }) => fetchMyProgress(signal),
    staleTime: PROGRESS_STALE_TIME,
    // ログイン状態の確認が終わるまでは取得しない（取得先のユーザーを確定させる）
    enabled: !auth.isLoading,
  });
}

// レッスン完了の保存（完了後は進捗のキャッシュを更新する）
export function useCompleteLessonMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postCompleteLesson,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.myProgressAll }),
  });
}

// ---- 進捗の集計 ----

// サーバ進捗とローカル進捗をレッスン単位でまとめる（スコアは高い方、時間は最新で上書き）
export function mergeProgress(serverList: ServerProgress[], localList: LocalProgressEntry[]): ServerProgress[] {
  const map = new Map<number, ServerProgress>();
  for (const p of serverList) map.set(p.lesson, { ...p });
  for (const p of localList) {
    const cur = map.get(p.lesson);
    if (!cur) {
      map.set(p.lesson, { ...p });
    } else {
      map.set(p.lesson, { ...cur, score: Math.max(cur.score, p.score), time_spent: p.time_spent });
    }
  }
  return Array.from(map.values());
}

// シーン一覧から教材の総数（シーン・レッスン・フレーズ・対話）を集計する
export type ContentStats = { scenes: number; lessons: number; phrases: number; dialogues: number };

export function countContent(scenes: Scene[]): ContentStats {
  return scenes.reduce<ContentStats>(
    (acc, s) => ({
      scenes: acc.scenes + 1,
      lessons: acc.lessons + (s.lessons?.length ?? 0),
      phrases: acc.phrases + (s.phrases?.length ?? 0),
      dialogues: acc.dialogues + (s.dialogues?.length ?? 0),
    }),
    { scenes: 0, lessons: 0, phrases: 0, dialogues: 0 }
  );
}
