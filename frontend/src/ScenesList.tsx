import React from "react";
import { useNavigate } from "react-router";
import {
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Box,
  Chip,
  CardActions,
  Button,
  Paper,
  LinearProgress
} from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { 
  PlayArrow as PlayIcon,
  Book as BookIcon,
  Chat as ChatIcon,
  TrendingUp as TrendingUpIcon
} from "@mui/icons-material";
import AnimatedCodeBackground from "./components/AnimatedCodeBackground";
import HomeHero from "./components/HomeHero";
import ContentStats from "./components/ContentStats";
import TechStack from "./components/TechStack";
import { readLocalProgress } from "./lib/storage";
import { useAppAuth } from "./lib/auth";
import { countContent, mergeProgress, useMyProgressQuery, useScenesQuery, type Scene } from "./lib/queries";

// カルーセル用画像（public/images/ 配下に配置してください）
const heroImages = [
  "/images/engineer_01.jpeg",
  "/images/engineer_02.jpeg",
  "/images/engineer_03.jpeg",
];

// シーン一覧の要素 ID（「学習をはじめる」の移動先）
const SCENE_LIST_ID = "scene-list";

// 無限スライドアニメーション
const slide = keyframes`
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
`;

const ScenesList: React.FC = () => {
  const navigate = useNavigate();
  const scenesQuery = useScenesQuery();
  const progressQuery = useMyProgressQuery();
  const { isAuthenticated } = useAppAuth();

  // サーバが落ちていても、ローカル進捗だけは表示する（ログイン中はアカウントの進捗を表示する）
  const scenes: Scene[] = scenesQuery.data ?? [];
  const progress = mergeProgress(progressQuery.data ?? [], isAuthenticated ? [] : readLocalProgress());
  const loading = scenesQuery.isPending || progressQuery.isPending;

  const completedLessonIds = new Set(progress.map(p => p.lesson));

  const getSceneProgress = (scene: Scene) => {
    const total = scene.lessons?.length || 0;
    const done = (scene.lessons || []).filter(l => completedLessonIds.has(l.id)).length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
  };

  const handleStartLearning = (sceneId: number) => {
    navigate(`/scene/${sceneId}`);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress size={60} aria-label="読み込み中" />
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative' }}>
      {/* 背景アニメーション */}
      <AnimatedCodeBackground />

      {/* コンテンツは前面 */}
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        {/* タイトルセクション */}
        <Paper elevation={0} sx={{ p: 3, mb: 4, backgroundColor: "#f5f5f5", opacity: 0.98 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography
                variant="h6"
                component="h1"
                gutterBottom
                sx={{ fontFamily: 'Cormorant Garamond, Playfair Display, serif', fontWeight: 400, letterSpacing: 1.2, lineHeight: 1.1 }}
              >
                コードは世界を跨ぐ
                <Typography
                  component="span"
                  variant="subtitle1"
                  sx={{ ml: 2, fontFamily: 'Cormorant Garamond, Playfair Display, serif', fontStyle: 'italic', fontWeight: 600, color: 'text.secondary' }}
                >
                  ~ Code crosses borders ~
                </Typography>
              </Typography>
            </Box>
            <Button
              variant="outlined"
              onClick={() => navigate("/progress")}
              startIcon={<TrendingUpIcon />}
            >
              学習履歴
            </Button>
          </Box>

          {/* ヒーローカルーセル（装飾画像のため支援技術からは隠す） */}
          <Box aria-hidden="true" sx={{ position: 'relative', height: 220, borderRadius: 0, overflow: 'hidden' }}>
            <Box
              sx={{
                display: 'flex',
                width: '200%',
                animation: `${slide} 45s linear infinite`,
                // 「視差効果を減らす」設定時はスライドを停止
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }}
            >
              {[...heroImages, ...heroImages].map((src, idx) => (
                <Box
                  key={idx}
                  component="img"
                  src={src}
                  alt=""
                  sx={{ width: `${100 / (heroImages.length * 2)}%`, height: '220px', objectFit: 'cover' }}
                />
              ))}
            </Box>
          </Box>
        </Paper>

        {/* アプリの概要と学習開始への導線 */}
        <HomeHero targetId={SCENE_LIST_ID} />

        {/* 収録コンテンツの数（シーン一覧から集計） */}
        {scenes.length > 0 && <ContentStats stats={countContent(scenes)} />}

        {/* Scene一覧 */}
        <Box id={SCENE_LIST_ID} tabIndex={-1} sx={{ outline: 'none', scrollMarginTop: 16 }}>
          {scenes.length === 0 ? (
            <Paper elevation={1} sx={{ p: 4, textAlign: "center" }}>
              <BookIcon sx={{ fontSize: 60, color: "text.secondary", mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                まだシーンが登録されていません
              </Typography>
              <Typography variant="body2" color="text.secondary">
                管理画面からシーンを追加してください
              </Typography>
            </Paper>
          ) : (
            <Box component="section" aria-label="シーン一覧" sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {scenes.map((scene) => {
                const { done, total, percent } = getSceneProgress(scene);
                return (
                  <Box key={scene.id} sx={{ flex: '1 1 300px', maxWidth: '400px' }}>
                    <Card elevation={2} sx={{ height: "100%", transition: "transform 0.2s ease-in-out", "&:hover": { transform: "translateY(-4px)", boxShadow: 4 } }}>
                      <CardContent sx={{ flexGrow: 1 }}>
                        <Typography variant="h6" component="h2" gutterBottom noWrap>
                          {scene.title}
                        </Typography>

                        {/* 進捗バー */}
                        <Box sx={{ mt: 1, mb: 2 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">進捗</Typography>
                            <Typography variant="caption" color="text.secondary">{percent}% ({done}/{total})</Typography>
                          </Box>
                          <LinearProgress
                            variant="determinate"
                            value={percent}
                            aria-label={`${scene.title} の進捗`}
                            sx={{ height: 8, borderRadius: 4 }}
                          />
                        </Box>

                        {/* メタ情報（任意） */}
                        <Box sx={{ mt: 1, mb: 1 }}>
                          <Chip icon={<BookIcon />} label={`${scene.phrases?.length || 0} フレーズ`} size="small" sx={{ mr: 1, mb: 1 }} />
                          <Chip icon={<ChatIcon />} label={`${scene.dialogues?.length || 0} 対話`} size="small" sx={{ mr: 1, mb: 1 }} />
                          <Chip icon={<PlayIcon />} label={`${scene.lessons?.length || 0} レッスン`} size="small" sx={{ mb: 1 }} />
                        </Box>
                      </CardContent>

                      <CardActions>
                        <Button
                          size="small"
                          startIcon={<PlayIcon />}
                          variant="contained"
                          fullWidth
                          onClick={() => handleStartLearning(scene.id)}
                          aria-label={`${scene.title} の学習を開始`}
                          sx={{
                            bgcolor: 'primary.light',
                            color: 'primary.contrastText',
                            '&:hover': { bgcolor: 'primary.main' },
                          }}
                        >
                          学習開始
                        </Button>
                      </CardActions>
                    </Card>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>

        {/* 技術スタック */}
        <TechStack />
      </Box>
    </Box>
  );
};

export default ScenesList; 