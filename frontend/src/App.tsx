import React from "react";
import { BrowserRouter as Router, Routes, Route, Link as RouterLink, useLocation } from "react-router";
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  Container, 
  CssBaseline, 
  ThemeProvider, 
  createTheme,
  Box,
  Snackbar,
  Alert
} from "@mui/material";
import { School as SchoolIcon } from "@mui/icons-material";
import ScenesList from "./ScenesList";
import SceneDetail from "./SceneDetail";
import LessonDetail from "./LessonDetail";
import ProgressHistory from "./ProgressHistory";
import SiteFooter from "./components/SiteFooter";
import ChatWidget from "./components/ChatWidget";
import ErrorBoundary from "./components/ErrorBoundary";
import NotFound from "./components/NotFound";
import AppAuthProvider from "./components/AppAuthProvider";
import AuthControls from "./components/AuthControls";
import AuthCallback from "./components/AuthCallback";
import AuthSessionEffects, { type AuthNotice } from "./components/AuthSessionEffects";
import { setupHttpInterceptors } from "./lib/http";
import { setupAuthInterceptors } from "./lib/authHttp";
import { getUserManager, isAuthEnabled, notifySessionExpired } from "./lib/auth";
import axios from "axios";

// API は Cookie を使わないため、クロスオリジンでも資格情報は送信しない
axios.defaults.withCredentials = false;
// ログイン中は自サービスの API 宛てのリクエストにのみアクセストークンを付与する
if (isAuthEnabled) {
  setupAuthInterceptors(axios, getUserManager, { onSessionExpired: notifySessionExpired });
}
// 4xx / 5xx を一元的に処理（ログ出力とユーザー向けメッセージの付与）
setupHttpInterceptors(axios);

// ルーティング部分（画面遷移時にエラー表示をリセット）
function AppRoutes() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Routes>
        <Route path="/" element={<ScenesList />} />
        <Route path="/scene/:id" element={<SceneDetail />} />
        <Route path="/lesson/:lessonId" element={<LessonDetail />} />
        <Route path="/progress" element={<ProgressHistory />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        {/* 体裁用のダミーページ（必要に応じて中身を実装） */}
        <Route path="/terms" element={<div>利用規約（準備中）</div>} />
        <Route path="/privacy" element={<div>プライバシーポリシー（準備中）</div>} />
        <Route path="/contact" element={<div>お問い合わせ（準備中）</div>} />
        {/* 該当するページが無い URL */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  );
}

// カスタムテーマの作成
const theme = createTheme({
  palette: {
    primary: {
      main: "#0A1A2F",   // さらに黒寄りの紺
      dark: "#050B14",
      light: "#24385A",
      contrastText: "#ffffff",
    },
    secondary: { main: "#dc004e" },
  },
  typography: {
    fontFamily: [
      'Inter',
      'Noto Sans JP',
      'M PLUS Rounded 1c',
      'system-ui',
      '-apple-system',
      'BlinkMacSystemFont',
      'Segoe UI',
      'Roboto',
      'Helvetica Neue',
      'Arial',
      'sans-serif'
    ].join(','),
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 700 },
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 }
  },
  shape: { borderRadius: 10 }
});

function App() {
  // ログイン関連の通知（進捗の反映結果・有効期限切れなど）
  const [notice, setNotice] = React.useState<AuthNotice | null>(null);
  const handleAuthError = React.useCallback((message: string) => setNotice({ severity: "warning", message }), []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router>
        <AppAuthProvider>
          <AuthSessionEffects onNotice={setNotice} />
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            {/* キーボード利用者向け：本文へスキップ（フォーカス時のみ表示） */}
            <Box
              component="a"
              href="#main-content"
              sx={{
                position: 'absolute',
                left: 8,
                top: -48,
                zIndex: 2000,
                px: 2,
                py: 1,
                bgcolor: 'background.paper',
                color: 'primary.main',
                borderRadius: 1,
                boxShadow: 3,
                '&:focus': { top: 8 },
              }}
            >
              本文へスキップ
            </Box>
            {/* ヘッダー */}
            <AppBar position="static" elevation={2}>
              <Toolbar>
                <SchoolIcon sx={{ mr: 2 }} aria-hidden="true" />
                <Typography
                  variant="h6"
                  component={RouterLink}
                  to="/"
                  aria-label="Engineer English App ホームへ"
                  sx={{ flexGrow: 1, minWidth: 0, mr: 1, color: 'inherit', textDecoration: 'none', fontFamily: `'Cormorant Garamond','Playfair Display',serif`, fontStyle: 'italic', letterSpacing: 0.5 }}
                >
                  Engineer English App
                </Typography>
                <AuthControls onError={handleAuthError} />
              </Toolbar>
            </AppBar>

            {/* メインコンテンツ */}
            <Container component="main" id="main-content" tabIndex={-1} maxWidth="lg" sx={{ mt: 4, mb: 6, flex: 1, outline: 'none' }}>
              <AppRoutes />
            </Container>

            {/* フッター */}
            <SiteFooter />
            {/* 右下AIチャット（ダミー。後でAPI差し替え） */}
            <ErrorBoundary>
              <ChatWidget />
            </ErrorBoundary>
            <Snackbar
              open={!!notice}
              autoHideDuration={6000}
              onClose={(_, reason) => { if (reason !== 'clickaway') setNotice(null); }}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
              <Alert severity={notice?.severity ?? 'info'} variant="filled" onClose={() => setNotice(null)} sx={{ width: '100%' }}>
                {notice?.message}
              </Alert>
            </Snackbar>
          </Box>
        </AppAuthProvider>
      </Router>
    </ThemeProvider>
  );
}

export default App;
