import React from "react";
import { Alert, AlertTitle, Box, Button, Stack } from "@mui/material";

type Props = {
  children: React.ReactNode;
  // この値が変わるとエラー状態をリセットする（例: 画面遷移時のパス）
  resetKey?: unknown;
};

type State = { hasError: boolean };

// 描画中の予期しないエラーを受け止め、画面全体が真っ白にならないようにする
class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.MODE !== "test") {
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <Box sx={{ py: 4 }}>
        <Alert severity="error" role="alert">
          <AlertTitle>問題が発生しました</AlertTitle>
          画面の表示中にエラーが発生しました。もう一度お試しいただくか、ページを再読み込みしてください。
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button variant="outlined" size="small" onClick={this.handleRetry}>
              もう一度試す
            </Button>
            <Button variant="contained" size="small" onClick={this.handleReload}>
              再読み込み
            </Button>
          </Stack>
        </Alert>
      </Box>
    );
  }
}

export default ErrorBoundary;
