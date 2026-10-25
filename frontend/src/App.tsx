import React from "react";
import { BrowserRouter as Router, Routes, Route, Link as RouterLink, useLocation } from "react-router";
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  Container, 
  CssBaseline, 
  ThemeProvider, 
  Box,
  Snackbar,
  Alert,
  Button
} from "@mui/material";
import { School as SchoolIcon, TrendingUp as TrendingUpIcon } from "@mui/icons-material";
import ScenesList from "./ScenesList";
import SiteFooter from "./components/SiteFooter";
import ChatWidget from "./components/ChatWidget";
import ErrorBoundary from "./components/ErrorBoundary";
import RouteChangeEffects from "./components/RouteChangeEffects";
import { LoadingView } from "./components/QueryStatus";
import { DISPLAY_FONT_FAMILY, theme } from "./theme";
import AppAuthProvider from "./components/AppAuthProvider";
import AuthControls from "./components/AuthControls";
import AuthSessionEffects, { type AuthNotice } from "./components/AuthSessionEffects";
import { setupHttpInterceptors } from "./lib/http";
import { setupAuthInterceptors } from "./lib/authHttp";
import { getUserManager, isAuthEnabled, notifySessionExpired } from "./lib/auth";
import axios from "axios";

// ホーム以外の画面は、表示するときに読み込む（初回表示で読み込むコードを減らす）
const SceneDetail = React.lazy(() => import("./SceneDetail"));
const LessonDetail = React.lazy(() => import("./LessonDetail"));
const ProgressHistory = React.lazy(() => import("./ProgressHistory"));
const AuthCallback = React.lazy(() => import("./components/AuthCallback"));
const NotFound = React.lazy(() => import("./components/NotFound"));
const PrivacyPolicy = React.lazy(() => import("./pages/LegalPages").then((m) => ({ default: m.PrivacyPolicy })));
const Terms = React.lazy(() => import("./pages/LegalPages").then((m) => ({ default: m.Terms })));
const Contact = React.lazy(() => import("./pages/LegalPages").then((m) => ({ default: m.Contact })));

// API は Cookie を使わないため、クロスオリジンでも資格情報は送信しない
axios.defaults.withCredentials = false;
// ログイン中は自サービスの API 宛てのリクエストにのみアクセストークンを付与する
if (isAuthEnabled) {
  setupAuthInterceptors(axios, getUserManager, { onSessionExpired: notifySessionExpired });
}
// 4xx / 5xx を一元的に処理（ログ出力とユーザー向けメッセージの付与）
setupHttpInterceptors(axios);

// ルーティング部分（画面遷移時にエラー表示をリセットし、先頭へのスクロールと見出しへのフォーカスを行う）
function AppRoutes() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <RouteChangeEffects />
      {/* 画面の読み込み中は、データの読み込み中と同じ表示にする */}
      <React.Suspense fallback={<LoadingView />}>
      <Routes>
        <Route path="/" element={<ScenesList />} />
        <Route path="/scene/:id" element={<SceneDetail />} />
        <Route path="/lesson/:lessonId" element={<LessonDetail />} />
        <Route path="/progress" element={<ProgressHistory />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        {/* 規約・ポリシー・お問い合わせ */}
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/contact" element={<Contact />} />
        {/* 該当するページが無い URL */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      </React.Suspense>
    </ErrorBoundary>
  );
}


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
                <SchoolIcon sx={{ mr: { xs: 1, sm: 2 } }} aria-hidden="true" />
                <Typography
                  variant="h6"
                  component={RouterLink}
                  to="/"
                  aria-label="Engineer English App ホームへ"
                  sx={{ flexGrow: 1, minWidth: 0, mr: 1, color: 'inherit', textDecoration: 'none', fontFamily: DISPLAY_FONT_FAMILY, fontStyle: 'italic', fontWeight: 600, letterSpacing: 0.5 }}
                >
                  Engineer English App
                </Typography>
                {/* 学習履歴への導線（狭い画面ではアイコンのみ表示する） */}
                <Button
                  component={RouterLink}
                  to="/progress"
                  color="inherit"
                  aria-label="学習履歴"
                  startIcon={<TrendingUpIcon aria-hidden="true" />}
                  sx={{
                    flexShrink: 0,
                    mr: 1,
                    minHeight: 44,
                    minWidth: 44,
                    whiteSpace: 'nowrap',
                    '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 }, ml: { xs: 0, sm: -0.5 } },
                  }}
                >
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>学習履歴</Box>
                </Button>
                <AuthControls onError={handleAuthError} />
              </Toolbar>
            </AppBar>

            {/* メインコンテンツ */}
            <Container component="main" id="main-content" tabIndex={-1} maxWidth="lg" sx={{ mt: 4, mb: 6, flex: 1, outline: 'none' }}>
              <AppRoutes />
            </Container>

            {/* フッター */}
            <SiteFooter />
            {/* 右下の AI チャット（設定で有効化。画面は最初に開いたときに読み込む） */}
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
