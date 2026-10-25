import { useEffect } from "react";

export const APP_NAME = "Engineer English App";

// ブラウザのタブに表示するタイトル（例: 「要件定義 | Engineer English App」）
export function formatPageTitle(title: string | null): string {
  return title ? `${title} | ${APP_NAME}` : APP_NAME;
}

// 画面ごとに document.title を設定する
// - null はアプリ名のみ（ホーム）
// - undefined は読み込み中などで未確定のため変更しない
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title === undefined) return;
    document.title = formatPageTitle(title);
  }, [title]);
}
