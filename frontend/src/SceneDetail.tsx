import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
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
import { getErrorMessage } from "./lib/http";
import { readLocalProgress } from "./lib/storage";
import { mergeProgress, useMyProgressQuery, useSceneQuery } from "./lib/queries";

const PAGE_SIZE = 5;

const SceneDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sceneQuery = useSceneQuery(id ? Number(id) : undefined);
  const progressQuery = useMyProgressQuery();
  const [page, setPage] = useState<number>(1);

  const scene = sceneQuery.data ?? null;
  // サーバからの進捗取得に失敗してもローカルだけで表示
  const progress = mergeProgress(progressQuery.data ?? [], readLocalProgress());
  const loading = sceneQuery.isPending || progressQuery.isPending;
  // 表示できるデータが無いときだけエラーを表示する（キャッシュがあれば再取得の失敗時もそのまま表示）
  const error = sceneQuery.isError && !scene ? "Scene取得エラー: " + getErrorMessage(sceneQuery.error) : null;

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
            <span aria-hidden="true">📚</span> {scene.title}
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
                <List aria-label="レッスン一覧">
                  {paginated.map((lesson) => {
                    const score = getLessonScore(lesson.id);
                    return (
                      <ListItem key={lesson.id} divider secondaryAction={
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<PlayIcon />}
                          onClick={() => handleStartLesson(lesson.id)}
                          aria-label={`${lesson.title} を開始`}
                        >
                          開始
                        </Button>
                      }>
                        <ListItemText
                          primary={lesson.title}
                          // secondary にブロック要素を含むため div として描画する
                          slotProps={{ secondary: { component: 'div' } }}
                          secondary={
                            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
                              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                                {/* 背景トラック（薄い円） */}
                                <CircularProgress
                                  variant="determinate"
                                  value={100}
                                  size={42}
                                  thickness={4}
                                  aria-hidden="true"
                                  sx={{
                                    color: (theme) => theme.palette.divider,
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                  }}
                                />
                                <CircularProgress
                                  variant="determinate"
                                  value={score}
                                  size={42}
                                  thickness={4}
                                  aria-label={`${lesson.title} のスコア`}
                                />
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