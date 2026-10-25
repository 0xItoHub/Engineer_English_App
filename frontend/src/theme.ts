import { createTheme } from "@mui/material";

// 本文のフォント（index.html で読み込む Web フォントと、読み込み前・非対応時のシステムフォント）
// index.css の body にも同じ指定をして、テーマの適用前後で表示がそろうようにする
export const FONT_FAMILY = '"Inter", "Noto Sans JP", system-ui, -apple-system, "Segoe UI", "Hiragino Sans", sans-serif';
// ロゴ・キャッチコピー用のフォント
export const DISPLAY_FONT_FAMILY = '"Cormorant Garamond", serif';

// カスタムテーマの作成
export const theme = createTheme({
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
    fontFamily: FONT_FAMILY,
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
