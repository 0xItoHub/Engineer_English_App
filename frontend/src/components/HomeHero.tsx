import React from "react";
import { Box, Button, Paper, Typography } from "@mui/material";
import { PlayArrow as PlayIcon } from "@mui/icons-material";

type Props = {
  // 「学習をはじめる」の移動先（シーン一覧の要素 ID）
  targetId: string;
};

// ホーム画面の導入（アプリの概要と学習開始への導線）
const HomeHero: React.FC<Props> = ({ targetId }) => {
  const handleStart = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(targetId);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ block: "start" });
    // キーボード操作でも続けてシーンを選べるよう、移動先にフォーカスする
    target.focus({ preventScroll: true });
  };

  return (
    <Paper
      component="section"
      aria-labelledby="home-hero-title"
      elevation={0}
      sx={{ p: { xs: 3, sm: 4 }, mb: 4, bgcolor: "primary.main", color: "primary.contrastText" }}
    >
      <Typography id="home-hero-title" variant="h5" component="h2" sx={{ mb: 1 }}>
        エンジニアのための、実務に効く英語学習
      </Typography>
      <Typography variant="body1" sx={{ color: "#dbeafe", lineHeight: 1.8, maxWidth: 760 }}>
        {"要件定義から運用・保守まで、開発プロセスに沿ったシーンとレッスンで英語を習得。"}
        {"実務で使える表現を音声読み上げと対話練習で身につけ、学習の進捗は自動で記録されます。"}
      </Typography>
      <Box sx={{ mt: 2.5 }}>
        <Button
          variant="contained"
          href={`#${targetId}`}
          onClick={handleStart}
          startIcon={<PlayIcon />}
          sx={{ bgcolor: "common.white", color: "primary.main", "&:hover": { bgcolor: "#e5edf7" } }}
        >
          学習をはじめる
        </Button>
      </Box>
    </Paper>
  );
};

export default HomeHero;
