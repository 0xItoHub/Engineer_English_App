import React from "react";
import { useNavigate } from "react-router";
import { AuthProvider } from "react-oidc-context";
import type { User } from "oidc-client-ts";
import { CALLBACK_PATH, getUserManager, returnPathFromUser } from "../lib/auth";

// Cognito のログイン状態をアプリ全体へ提供する（ログイン機能が無効な場合は何もしない）
// ルーター内に配置し、ログイン完了後は開始時の画面へ戻る
const AppAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const userManager = getUserManager();

  const onSigninCallback = React.useCallback(
    (user: User | undefined) => {
      // URL から認可コードなどを取り除き、保存しておいた戻り先（同一オリジン内のパスのみ）へ移動する
      const path = returnPathFromUser(user);
      window.history.replaceState(null, document.title, path);
      navigate(path, { replace: true });
    },
    [navigate]
  );

  if (!userManager) return <>{children}</>;

  return (
    <AuthProvider
      userManager={userManager}
      onSigninCallback={onSigninCallback}
      // 認可コードの処理はコールバック用のパスでのみ行う
      skipSigninCallback={window.location.pathname !== CALLBACK_PATH}
    >
      {children}
    </AuthProvider>
  );
};

export default AppAuthProvider;
