import React from "react";
import { BrowserRouter as Router, Routes, Route, Link as RouterLink } from "react-router-dom";
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  Container, 
  CssBaseline, 
  ThemeProvider, 
  createTheme,
  Box,
  Button
} from "@mui/material";
import { School as SchoolIcon } from "@mui/icons-material";
import ScenesList from "./ScenesList";
import SceneDetail from "./SceneDetail";
import LessonDetail from "./LessonDetail";
import ProgressHistory from "./ProgressHistory";
import SiteFooter from "./components/SiteFooter";
import ChatWidget from "./components/ChatWidget";
import axios from "axios";

axios.defaults.withCredentials = false;
axios.defaults.xsrfCookieName = "csrftoken";
axios.defaults.xsrfHeaderName = "X-CSRFToken";
axios.defaults.baseURL = (process.env.REACT_APP_API_BASE as string) || "/";

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
  const [auth, setAuth] = React.useState<{ authenticated: boolean; username?: string }>({ authenticated: false });

  const fetchWhoAmI = React.useCallback(async () => { setAuth({ authenticated: false }); }, []);

  React.useEffect(() => { fetchWhoAmI(); }, [fetchWhoAmI]);

  const demoLogin = async () => { /* no-op */ };

  const doLogout = async () => { /* no-op */ };

  async function syncLocalProgressToServer() {
    const key = "ee_local_progress";
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const list: { lesson: number; score: number; time_spent: number }[] = JSON.parse(raw);
      for (const item of list) {
        await axios.post("/api/progress/complete_lesson/", {
          lesson_id: item.lesson, score: item.score, time_spent: item.time_spent
        });
      }
      localStorage.removeItem(key);
    } catch {}
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router>
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          {/* ヘッダー */}
          <AppBar position="static" elevation={2}>
            <Toolbar>
              <SchoolIcon sx={{ mr: 2 }} />
              <Typography
                variant="h6"
                component={RouterLink}
                to="/"
                sx={{ flexGrow: 1, color: 'inherit', textDecoration: 'none', fontFamily: `'Cormorant Garamond','Playfair Display',serif`, fontStyle: 'italic', letterSpacing: 0.5 }}
              >
                Engineer English App
              </Typography>
              {auth.authenticated ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2">{auth.username}</Typography>
                  <Button color="inherit" size="small" onClick={doLogout}>ログアウト</Button>
                </Box>
              ) : (
                <></>
              )}
            </Toolbar>
          </AppBar>

          {/* メインコンテンツ */}
          <Container maxWidth="lg" sx={{ mt: 4, mb: 6, flex: 1 }}>
            <Routes>
              <Route path="/" element={<ScenesList />} />
              <Route path="/scene/:id" element={<SceneDetail />} />
              <Route path="/lesson/:lessonId" element={<LessonDetail />} />
              <Route path="/progress" element={<ProgressHistory />} />
              {/* 体裁用のダミーページ（必要に応じて中身を実装） */}
              <Route path="/terms" element={<div>利用規約（準備中）</div>} />
              <Route path="/privacy" element={<div>プライバシーポリシー（準備中）</div>} />
              <Route path="/contact" element={<div>お問い合わせ（準備中）</div>} />
            </Routes>
          </Container>

          {/* フッター */}
          <SiteFooter />
          {/* 右下AIチャット（ダミー。後でAPI差し替え） */}
          <ChatWidget />
        </Box>
      </Router>
    </ThemeProvider>
  );
}

export default App;
