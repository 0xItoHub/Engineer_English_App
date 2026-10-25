import React from "react";
import { Navigate, useNavigate } from "react-router";
import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import { CALLBACK_PATH, useAppAuth } from "../lib/auth";
import { usePageTitle } from "../hooks/usePageTitle";

// ログイン後に Cognito から戻ってくる画面（/auth/callback）
// 認可コードの処理は AuthProvider が行い、完了後は開始時の画面へ移動する
const AuthCallback: React.FC = () => {
  const auth = useAppAuth();
  const navigate = useNavigate();
  const failed = auth.enabled && !auth.isLoading && !!auth.error;
  usePageTitle("ログイン");

  // ログインに失敗した場合も、認可コードなどのパラメータは URL から取り除く
  React.useEffect(() => {
    if (failed && window.location.search) {
      window.history.replaceState(null, document.title, CALLBACK_PATH);
    }
  }, [failed]);

  if (!auth.enabled) return <Navigate to="/" replace />;

  if (failed) {
    return (
      <Box sx={{ maxWidth: 560, mx: "auto", mt: 6 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          ログインを完了できませんでした。時間をおいて再度お試しください。
        </Alert>
        <Button variant="contained" onClick={() => navigate("/", { replace: true })}>
          ホームに戻る
        </Button>
      </Box>
    );
  }

  if (!auth.isLoading) return <Navigate to="/" replace />;

  return (
    <Box
      role="status"
      sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minHeight: 320 }}
    >
      <CircularProgress size={48} aria-hidden="true" />
      <Typography color="text.secondary">ログイン処理中です…</Typography>
    </Box>
  );
};

export default AuthCallback;
