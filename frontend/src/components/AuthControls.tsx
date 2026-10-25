import React from "react";
import { useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Box, Button, Typography } from "@mui/material";
import { Login as LoginIcon, Logout as LogoutIcon } from "@mui/icons-material";
import { useAppAuth } from "../lib/auth";
import { isUserScopedQuery } from "../lib/queries";

// ヘッダーのログイン・ログアウト（ログイン機能が無効な場合は表示しない）
const AuthControls: React.FC<{ onError?: (message: string) => void }> = ({ onError }) => {
  const auth = useAppAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  if (!auth.enabled || auth.isLoading) return null;

  const handleLogin = async () => {
    setBusy(true);
    try {
      await auth.signIn(`${location.pathname}${location.search}${location.hash}`);
    } catch {
      setBusy(false);
      onError?.("ログイン画面を開けませんでした。しばらくしてから再度お試しください。");
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    // ユーザーごとのキャッシュを削除してから、ログアウト画面へ移動する
    queryClient.removeQueries({ predicate: isUserScopedQuery });
    try {
      await auth.signOut();
    } catch {
      setBusy(false);
    }
  };

  if (!auth.isAuthenticated) {
    return (
      <Button
        color="inherit"
        variant="outlined"
        size="small"
        startIcon={<LoginIcon aria-hidden="true" />}
        onClick={handleLogin}
        disabled={busy}
        sx={{ flexShrink: 0, minHeight: 44, whiteSpace: "nowrap", borderColor: "rgba(255,255,255,0.5)", "&:hover": { borderColor: "#fff" } }}
      >
        ログイン
      </Button>
    );
  }

  return (
    <Box
      role="group"
      aria-label={auth.email ? `ログイン中: ${auth.email}` : "ログイン中"}
      sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, flexShrink: 0 }}
    >
      {auth.email && (
        // 狭い画面ではメールアドレスを省略し、ボタンの表示幅を確保する
        <Typography
          variant="body2"
          noWrap
          title={auth.email}
          sx={{ display: { xs: "none", sm: "block" }, maxWidth: { sm: 200, md: 280 }, opacity: 0.9 }}
        >
          {auth.email}
        </Typography>
      )}
      <Button
        color="inherit"
        size="small"
        startIcon={<LogoutIcon aria-hidden="true" />}
        onClick={handleLogout}
        disabled={busy}
        sx={{ flexShrink: 0, minHeight: 44, whiteSpace: "nowrap" }}
      >
        ログアウト
      </Button>
    </Box>
  );
};

export default AuthControls;
