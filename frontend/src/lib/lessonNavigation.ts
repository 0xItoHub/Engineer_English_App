import type { Scene } from "./queries";

// レッスン完了後に案内する次の学習先
// - 同じシーンに続きのレッスンがあれば、そのレッスン（ID の順）
// - シーンの最後のレッスンであれば、次のシーン（ID の順）
// - どちらも無ければ null
export type NextTarget =
  | { kind: "lesson"; id: number; title: string; path: string }
  | { kind: "scene"; id: number; title: string; path: string };

const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;

export function findNextTarget(scenes: readonly Scene[] | undefined, sceneId: number, lessonId: number): NextTarget | null {
  if (!scenes || scenes.length === 0) return null;
  const sorted = [...scenes].sort(byId);
  const current = sorted.find((s) => s.id === sceneId);
  if (!current) return null;

  const nextLesson = [...(current.lessons ?? [])].sort(byId).find((l) => l.id > lessonId);
  if (nextLesson) {
    return { kind: "lesson", id: nextLesson.id, title: nextLesson.title, path: `/lesson/${nextLesson.id}` };
  }

  const nextScene = sorted.find((s) => s.id > sceneId);
  if (nextScene) {
    return { kind: "scene", id: nextScene.id, title: nextScene.title, path: `/scene/${nextScene.id}` };
  }
  return null;
}
