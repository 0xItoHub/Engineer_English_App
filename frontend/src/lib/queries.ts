// API の取得処理（TanStack Query のクエリキー・クエリ関数・フック）を一元管理する
// - 共通の axios インスタンス（インターセプター付き）を使うため、エラーには userMessage が付与される
// - クエリの signal を axios に渡し、画面遷移時などに不要になったリクエストを中断する
import axios from "axios";
import { QueryClient, useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { useAppAuth } from "./auth";
import { API_BASE_URL } from "./config";
import { type ApiError } from "./http";
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
  completed_at?: string | null;
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

// ログインしていない場合、API は空の一覧を返す（取得の失敗はエラーとして画面に伝える）
export async function fetchMyProgress(signal?: AbortSignal): Promise<ServerProgress[]> {
  const res = await axios.get(url("/api/progress/my_progress/"), { signal });
  return Array.isArray(res.data) ? res.data : [];
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

// シーン一覧（ホーム・学習履歴・レッスン完了後の案内で共有）
export function useScenesQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.scenes,
    queryFn: ({ signal }) => fetchScenes(signal),
    enabled: options.enabled ?? true,
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

// 画面に表示する学習進捗（1 レッスンにつき 1 件）
export type ProgressItem = {
  id?: number;
  lesson: number;
  lesson_title?: string;
  scene_title?: string;
  // 完了日時（記録が無い場合は null）
  completed_at: string | null;
  time_spent: number;
  // アカウントへの保存待ち・未ログインでブラウザにのみ保存している記録
  local: boolean;
};

// サーバ進捗とローカル進捗をレッスン単位でまとめる
// サーバに記録があるレッスンはサーバの内容を表示し、ローカルの記録はサーバに無いレッスンのみ追加する
export function mergeProgress(serverList: ServerProgress[], localList: LocalProgressEntry[]): ProgressItem[] {
  const map = new Map<number, ProgressItem>();
  for (const p of serverList) {
    if (map.has(p.lesson)) continue;
    map.set(p.lesson, {
      id: p.id,
      lesson: p.lesson,
      lesson_title: p.lesson_title,
      scene_title: p.scene_title,
      completed_at: p.completed_at ?? null,
      time_spent: p.time_spent,
      local: false,
    });
  }
  for (const p of localList) {
    if (map.has(p.lesson)) continue;
    map.set(p.lesson, { lesson: p.lesson, completed_at: p.completed_at, time_spent: p.time_spent, local: true });
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
