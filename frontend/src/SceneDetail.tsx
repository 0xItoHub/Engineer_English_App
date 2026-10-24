import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Alert,
  Box,
  Chip,
  Button,
  Paper,
  Pagination,
  List,
  ListItem,
  ListItemText,
  Container
} from "@mui/material";
import { 
  PlayArrow as PlayIcon,
  ArrowBack as ArrowBackIcon,
  School as SchoolIcon
} from "@mui/icons-material";
import { getErrorMessage, isAbortError } from "./lib/http";
import { readLocalProgress } from "./lib/storage";

// APIのベースURL設定
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';

type Scene = {
  id: number;
  title: string;
  phrases?: Phrase[];
  dialogues?: Dialogue[];
  lessons?: Lesson[];
};

type Phrase = {
  id: number;
  text_en: string;
  text_ja: string;
  note: string;
};

type Dialogue = {
  id: number;
  speaker: string;
  line_en: string;
  line_ja: string;
  order: number;
};

type Lesson = {
  id: number;
  title: string;
  description: string;
};

type ProgressEntry = {
  id?: number; // サーバのみ
  lesson: number;
  score: number; // 0-100
  time_spent: number;
};

const PAGE_SIZE = 5;

const SceneDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [scene, setScene] = useState<Scene | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEntry[]>([]);
  const [page, setPage] = useState<number>(1);

  function mergeProgress(serverList: ProgressEntry[], localList: ProgressEntry[]): ProgressEntry[] {
    const map = new Map<number, ProgressEntry>();
    for (const p of serverList) map.set(p.lesson, { ...p });
    for (const p of localList) {
      const cur = map.get(p.lesson);
      if (!cur) {
        map.set(p.lesson, { ...p });
      } else {
        map.set(p.lesson, { ...cur, score: Math.max(cur.score, p.score), time_spent: p.time_spent });
      }
    }
    return Array.from(map.values());
  }

  useEffect(() => {
    if (!id) return;
    // 画面遷移時はリクエストを中断し、アンマウント後の state 更新を防ぐ
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      axios.get(`${API_BASE_URL}/api/scenes/${id}/`, { signal }),
      axios.get(`${API_BASE_URL}/api/progress/my_progress/`, { signal }).catch(() => ({ data: [] })),
    ])
      .then(([sceneRes, progRes]) => {
        if (signal.aborted) return;
        setScene(sceneRes.data);
        const serverProgress: ProgressEntry[] = Array.isArray(progRes.data) ? progRes.data : [];
        const localProgress = readLocalProgress();
        setProgress(mergeProgress(serverProgress, localProgress));
        setLoading(false);
      })
      .catch((err) => {
        if (signal.aborted || isAbortError(err)) return;
        // サーバからの進捗取得に失敗してもローカルだけで表示
        setScene(null);
        setProgress(readLocalProgress());
        setError("Scene取得エラー: " + getErrorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  // レッスン数が変わった場合、現在ページが範囲外なら1に戻す
  useEffect(() => {
    const len = scene?.lessons?.length || 0;
    const totalPages = Math.max(1, Math.ceil(len / PAGE_SIZE));
    if (page > totalPages) setPage(1);
  }, [scene?.lessons, page]);

  const handleStartLesson = (lessonId: number) => {
    navigate(`/lesson/${lessonId}`);
  };

  const getLessonScore = (lessonId: number) => {
    const hit = progress.find((p) => p.lesson === lessonId);
    if (!hit) return 0;
    const s = typeof hit.score === "number" ? hit.score : 0;
    return Math.max(0, Math.min(100, s));
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress size={60} />
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

  if (!scene) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        Sceneが見つかりません
      </Alert>
    );
  }

  const lessons = scene.lessons || [];
  const totalPages = Math.max(1, Math.ceil(lessons.length / PAGE_SIZE));
  const paginated = lessons.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {/* ヘッダー */}
      <Box sx={{ mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/")} sx={{ mb: 2 }}>
          ホームに戻る
        </Button>
        <Paper elevation={0} sx={{ p: 3, backgroundColor: "#f5f5f5" }}>
          <Typography variant="h4" component="h1" gutterBottom>
            📚 {scene.title}
          </Typography>
        </Paper>
      </Box>

      {/* レッスンのみ表示 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Card elevation={2}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <SchoolIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6" component="h2">
                レッスン ({lessons.length})
              </Typography>
            </Box>
            
            {lessons.length > 0 ? (
              <>
                <List>
                  {paginated.map((lesson) => {
                    const score = getLessonScore(lesson.id);
                    return (
                      <ListItem key={lesson.id} divider secondaryAction={
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<PlayIcon />}
                          onClick={() => handleStartLesson(lesson.id)}
                        >
                          開始
                        </Button>
                      }>
                        <ListItemText
                          primary={lesson.title}
                          secondary={
                            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
                              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                                {/* 背景トラック（薄い円） */}
                                <CircularProgress
                                  variant="determinate"
                                  value={100}
                                  size={42}
                                  thickness={4}
                                  sx={{
                                    color: (theme) => theme.palette.divider,
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                  }}
                                />
                                <CircularProgress variant="determinate" value={score} size={42} thickness={4} />
                                <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <Typography variant="caption" color="text.secondary">{`${score}%`}</Typography>
                                </Box>
                              </Box>
                              {lesson.description && (
                                <Typography variant="caption" color="text.secondary">
                                  {lesson.description}
                                </Typography>
                              )}
                              {score >= 100 && (<Chip size="small" color="success" label="完了" />)}
                            </Box>
                          }
                        />
                      </ListItem>
                    );
                  })}
                </List>
                {totalPages > 1 && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                    <Pagination
                      count={totalPages}
                      page={page}
                      onChange={(_e, value) => setPage(value)}
                      color="primary"
                      size="small"
                    />
                  </Box>
                )}
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                まだレッスンが登録されていません
              </Typography>
            )}
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};

export default SceneDetail; 