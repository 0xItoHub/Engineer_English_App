import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Alert,
  Box,
  Chip,
  CardActions,
  Button,
  Paper,
  LinearProgress
} from "@mui/material";
import { keyframes } from "@mui/system";
import { 
  PlayArrow as PlayIcon,
  Book as BookIcon,
  Chat as ChatIcon,
  TrendingUp as TrendingUpIcon
} from "@mui/icons-material";
import AnimatedCodeBackground from "./components/AnimatedCodeBackground";
import { isAbortError } from "./lib/http";
import { readLocalProgress } from "./lib/storage";
import { API_BASE_URL } from "./lib/config";

// カルーセル用画像（public/images/ 配下に配置してください）
const heroImages = [
  "/images/engineer_01.jpeg",
  "/images/engineer_02.jpeg",
  "/images/engineer_03.jpeg",
];

// 無限スライドアニメーション
const slide = keyframes`
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
`;

type LessonLite = { id: number; title: string };

type Scene = {
  id: number;
  title: string;
  phrases?: unknown[];
  dialogues?: unknown[];
  lessons?: LessonLite[];
};

type ProgressEntry = {
  id?: number; // サーバ進捗のみ
  lesson: number;
  score: number;
  time_spent: number;
};

const ScenesList: React.FC = () => {
  const navigate = useNavigate();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [progress, setProgress] = useState<ProgressEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function mergeProgress(serverList: ProgressEntry[], localList: ProgressEntry[]): ProgressEntry[] {
    const map = new Map<number, ProgressEntry>();
    for (const p of serverList) map.set(p.lesson, { ...p });
    for (const p of localList) {
      const cur = map.get(p.lesson);
      if (!cur) {
        map.set(p.lesson, { ...p });
      } else {
        // スコアは高い方、時間は最新で上書き
        map.set(p.lesson, { ...cur, score: Math.max(cur.score, p.score), time_spent: p.time_spent });
      }
    }
    return Array.from(map.values());
  }

  useEffect(() => {
    // 画面を離れたらリクエストを中断し、アンマウント後の state 更新を防ぐ
    const controller = new AbortController();
    const { signal } = controller;
    const fetchAll = async () => {
      try {
        const [scenesRes, progressRes] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/scenes/`, { signal }),
          axios.get(`${API_BASE_URL}/api/progress/my_progress/`, { signal }).catch(() => ({ data: [] }))
        ]);
        if (signal.aborted) return;
        setScenes(Array.isArray(scenesRes.data) ? scenesRes.data : []);
        const serverProgress: ProgressEntry[] = Array.isArray(progressRes.data) ? progressRes.data : [];
        const localProgress = readLocalProgress();
        setProgress(mergeProgress(serverProgress, localProgress));
        setLoading(false);
      } catch (err: unknown) {
        if (signal.aborted || isAbortError(err)) return;
        // サーバが落ちていても、ローカル進捗だけは表示
        setScenes([]);
        setProgress(readLocalProgress());
        setError(null);
        setLoading(false);
      }
    };
    fetchAll();
    return () => controller.abort();
  }, []);

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
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress size={60} aria-label="読み込み中" />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {error}
      </Alert>
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
                sx={{ fontFamily: 'AB-tsurumaru, Cormorant Garamond, Playfair Display, serif', fontWeight: 400, letterSpacing: 1.2, lineHeight: 1.1 }}
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

        {/* Scene一覧 */}
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
    </Box>
  );
};

export default ScenesList; 