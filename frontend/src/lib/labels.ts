// 画面に表示するラベルの整形

// 対話の話者（役割の略称）に日本語の説明を添える（対応表に無い話者はそのまま表示する）
const SPEAKER_LABELS: Record<string, string> = {
  PM: "PM（プロダクトマネージャー）",
  Dev: "Dev（開発者）",
  QA: "QA（品質保証）",
  SRE: "SRE（サイト信頼性エンジニア）",
  TL: "TL（テックリード）",
  Designer: "Designer（デザイナー）",
  Client: "Client（顧客）",
};

export function speakerLabel(speaker: string): string {
  const key = speaker.trim();
  return SPEAKER_LABELS[key] ?? key;
}

// レッスンの説明（タイトルを繰り返すだけの説明は表示しない）
// - 「シーン名 / レッスン名」の形式やタイトルと同じ内容の場合は null を返す
export function lessonDescription(description: string | null | undefined, title: string): string | null {
  const text = (description ?? "").trim();
  if (!text) return null;
  const name = title.trim();
  if (text === name) return null;
  const parts = text.split(" / ");
  if (parts.length === 2 && parts[1].trim() === name) return null;
  return text;
}

// 説明が無いレッスンで表示する案内
export const DEFAULT_LESSON_DESCRIPTION = "フレーズと対話を、読み上げを聞きながら順番に学びます。";

// 管理用の印（seed で投入したデータ）はメモとして表示しない
export function phraseNote(note: string | null | undefined): string | null {
  const text = (note ?? "").trim();
  return text && text !== "seed" ? text : null;
}
