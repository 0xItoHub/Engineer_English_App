import React from "react";
import { Alert, AlertTitle, Box, Button, CircularProgress, type SxProps, type Theme } from "@mui/material";
import { getErrorMessage } from "../lib/http";
import { OFFLINE_MESSAGE } from "../lib/queryState";

export const LoadingView: React.FC = () => (
  <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "400px" }}>
    <CircularProgress size={60} aria-label="読み込み中" />
  </Box>
);

type ErrorAlertProps = {
  error?: unknown;
  offline?: boolean;
  onRetry: () => void;
  title?: string;
  severity?: "error" | "warning";
  sx?: SxProps<Theme>;
};

// 取得に失敗した・オフラインの場合の案内と再試行ボタン
export const QueryErrorAlert: React.FC<ErrorAlertProps> = ({ error, offline = false, onRetry, title, severity = "error", sx }) => (
  <Alert
    severity={offline ? "warning" : severity}
    sx={{ mt: 2, ...sx }}
    action={
      <Button color="inherit" size="small" onClick={onRetry}>
        再試行
      </Button>
    }
  >
    {title && <AlertTitle>{title}</AlertTitle>}
    {offline ? OFFLINE_MESSAGE : getErrorMessage(error)}
  </Alert>
);

type ProgressAlertProps = {
  query: { data: unknown; isError: boolean; error: unknown; fetchStatus: string; refetch: () => unknown };
  sx?: SxProps<Theme>;
};

// 学習進捗を取得できない場合の案内（教材の表示は続けたまま、再試行できるようにする）
export const ProgressErrorAlert: React.FC<ProgressAlertProps> = ({ query, sx }) => {
  const offline = query.fetchStatus === "paused";
  if (query.data !== undefined || (!query.isError && !offline)) return null;
  return (
    <QueryErrorAlert
      title="学習進捗を取得できませんでした"
      severity="warning"
      error={query.error}
      offline={offline}
      onRetry={() => void query.refetch()}
      sx={sx}
    />
  );
};
