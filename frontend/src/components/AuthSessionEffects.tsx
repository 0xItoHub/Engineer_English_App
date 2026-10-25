import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onSessionExpired, useAppAuth } from "../lib/auth";
import { markSyncStarted, syncLocalProgress } from "../lib/progressSync";
import { isUserScopedQuery, postCompleteLesson, queryKeys } from "../lib/queries";
import { readLocalProgress } from "../lib/storage";

export type AuthNotice = { severity: "success" | "info" | "warning"; message: string };

// ログイン状態の変化に合わせた処理（画面には何も描画しない）
// - ログイン直後（タブごとに 1 回）に、ブラウザに保存された進捗をアカウントへ反映する
// - ユーザーが切り替わった・ログアウトした場合は、前のユーザーのキャッシュを削除する
// - ログインの有効期限が切れた場合は、利用者へ通知する
const AuthSessionEffects: React.FC<{ onNotice: (notice: AuthNotice) => void }> = ({ onNotice }) => {
  const auth = useAppAuth();
  const queryClient = useQueryClient();
  const sub = auth.isAuthenticated ? auth.sub : null;
  const previousSub = React.useRef<string | null>(null);
  const noticeRef = React.useRef(onNotice);
  noticeRef.current = onNotice;

  React.useEffect(() => {
    if (previousSub.current && previousSub.current !== sub) {
      queryClient.removeQueries({ predicate: isUserScopedQuery });
    }
    previousSub.current = sub;
  }, [sub, queryClient]);

  React.useEffect(() => {
    if (!sub || readLocalProgress().length === 0 || !markSyncStarted(sub)) return;
    void syncLocalProgress((entry) =>
      postCompleteLesson({ lessonId: String(entry.lesson), score: entry.score, timeSpent: entry.time_spent })
    ).then((result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myProgressAll });
      if (result.uploaded > 0) {
        const rest = result.remaining > 0 ? "残りは次回のログイン時に反映します。" : "";
        noticeRef.current({
          severity: "success",
          message: `ブラウザに保存された進捗をアカウントに反映しました（${result.uploaded}件）。${rest}`,
        });
      } else if (result.rateLimited) {
        noticeRef.current({ severity: "info", message: "ブラウザに保存された進捗は、次回のログイン時に反映します。" });
      }
    });
  }, [sub, queryClient]);

  React.useEffect(
    () =>
      onSessionExpired(() =>
        noticeRef.current({ severity: "warning", message: "ログインの有効期限が切れました。お手数ですが、もう一度ログインしてください。" })
      ),
    []
  );

  return null;
};

export default AuthSessionEffects;
