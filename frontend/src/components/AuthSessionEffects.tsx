import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthContext } from "react-oidc-context";
import { onSessionExpired, useAppAuth } from "../lib/auth";
import { clearSynced, runInitialSync } from "../lib/progressSync";
import { isUserScopedQuery, postCompleteLesson, queryKeys } from "../lib/queries";

export type AuthNotice = { severity: "success" | "info" | "warning"; message: string };

const SESSION_EXPIRED_MESSAGE = "ログインの有効期限が切れました。お手数ですが、もう一度ログインしてください。";

// ログイン状態の変化に合わせた処理（画面には何も描画しない）
// - ログイン直後（タブごとに 1 回）に、ブラウザに保存された進捗（未ログイン時の記録と本人の保存待ちの記録）をアカウントへ反映する
// - ユーザーが切り替わった・ログアウトした場合は、前のユーザーのキャッシュを削除し、次回のログイン時に改めて反映する
// - ログインの有効期限が切れた場合は、利用者へ通知する
const AuthSessionEffects: React.FC<{ onNotice: (notice: AuthNotice) => void }> = ({ onNotice }) => {
  const auth = useAppAuth();
  const authContext = React.useContext(AuthContext);
  const queryClient = useQueryClient();
  const sub = auth.isAuthenticated ? auth.sub : null;
  const previousSub = React.useRef<string | null>(null);
  const noticeRef = React.useRef(onNotice);
  noticeRef.current = onNotice;

  React.useEffect(() => {
    if (previousSub.current && previousSub.current !== sub) {
      queryClient.removeQueries({ predicate: isUserScopedQuery });
      clearSynced(previousSub.current);
    }
    previousSub.current = sub;
  }, [sub, queryClient]);

  React.useEffect(() => {
    if (!sub) return;
    void runInitialSync(sub, (entry) =>
      postCompleteLesson({ lessonId: String(entry.lesson), score: entry.score, timeSpent: entry.time_spent })
    ).then((result) => {
      if (!result) return;
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

  // 有効期限切れの通知は、ログインごとに 1 回だけ表示する
  const expiredNoticeShown = React.useRef(false);
  React.useEffect(() => {
    if (sub) expiredNoticeShown.current = false;
  }, [sub]);
  const notifyExpired = React.useCallback(() => {
    if (expiredNoticeShown.current) return;
    expiredNoticeShown.current = true;
    noticeRef.current({ severity: "warning", message: SESSION_EXPIRED_MESSAGE });
  }, []);

  // API が 401 を返し、トークンを更新できなかった場合
  React.useEffect(() => onSessionExpired(notifyExpired), [notifyExpired]);

  // アクセストークンの期限切れ・自動更新の失敗（画面を開いたままの場合も通知する）
  const events = authContext?.events;
  React.useEffect(() => {
    if (!events || typeof events.addAccessTokenExpired !== "function") return;
    const removeExpired = events.addAccessTokenExpired(notifyExpired);
    const removeRenewError = typeof events.addSilentRenewError === "function" ? events.addSilentRenewError(notifyExpired) : undefined;
    return () => {
      removeExpired?.();
      removeRenewError?.();
    };
  }, [events, notifyExpired]);

  return null;
};

export default AuthSessionEffects;
