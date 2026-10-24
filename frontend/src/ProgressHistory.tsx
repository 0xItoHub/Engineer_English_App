import React, { useMemo } from "react";
import { useNavigate } from "react-router";
import {
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Box,
  Button,
  Paper,
  Container,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress
} from "@mui/material";
import { 
  ArrowBack as ArrowBackIcon,
  School as SchoolIcon,
  TrendingUp as TrendingUpIcon,
  AccessTime as AccessTimeIcon
} from "@mui/icons-material";
import { readLocalProgress } from "./lib/storage";
import { useMyProgressQuery, useScenesQuery, type Scene, type ServerProgress } from "./lib/queries";

type Progress = {
  id?: number; // サーバのみ
  lesson?: number; // ローカルのみで使用
  lesson_title: string;
  scene_title: string;
  completed_at: string;
  score: number;
  time_spent: number;
};

// ローカル保存分（壊れたデータは除外して読み込む）
const readLocal = readLocalProgress;

const buildLessonMap = (scenes: Scene[]): Map<number, { lesson_title: string; scene_title: string }> => {
  const map = new Map<number, { lesson_title: string; scene_title: string }>();
  for (const s of scenes || []) {
    for (const l of s.lessons || []) {
      map.set(l.id, { lesson_title: l.title, scene_title: s.title });
    }
  }
  return map;
};

// サーバの進捗を表示用の形式にそろえる
const toProgress = (p: ServerProgress): Progress => ({
  id: p.id,
  lesson: p.lesson,
  lesson_title: p.lesson_title ?? `Lesson #${p.lesson}`,
  scene_title: p.scene_title ?? "",
  completed_at: p.completed_at ?? new Date().toISOString(),
  score: p.score,
  time_spent: p.time_spent,
});

const ProgressHistory: React.FC = () => {
  const navigate = useNavigate();
  const progressQuery = useMyProgressQuery();
  // シーン一覧はホーム画面と共有し、ローカル進捗のタイトル補完に使う
  const scenesQuery = useScenesQuery();
  const loading = progressQuery.isPending || scenesQuery.isPending;

  const progress = useMemo<Progress[]>(() => {
    const server = (progressQuery.data ?? []).map(toProgress);
    // サーバダウン時はシーン一覧が空となり、タイトルはフォールバック表示になる
    const lessonMap = buildLessonMap(scenesQuery.data ?? []);

    // ローカル分をタイトル補完してProgress形式へ
    const localAsProgress: Progress[] = readLocal().map((x) => {
      const info = lessonMap.get(x.lesson);
      return {
        lesson: x.lesson,
        lesson_title: info?.lesson_title || `Lesson #${x.lesson}`,
        scene_title: info?.scene_title || "(未同期)",
        completed_at: new Date().toISOString(),
        score: x.score,
        time_spent: x.time_spent,
      };
    });

    return [...server, ...localAsProgress];
  }, [progressQuery.data, scenesQuery.data]);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}時間${minutes}分`;
    if (minutes > 0) return `${minutes}分${secs}秒`;
    return `${secs}秒`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ja-JP', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const getTotalScore = () => {
    if (progress.length === 0) return 0;
    const total = progress.reduce((sum, p) => sum + Math.min(p.score, 100), 0);
    return Math.min(Math.round(total / progress.length), 100);
  };

  const getTotalTime = () => progress.reduce((sum, p) => sum + p.time_spent, 0);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress size={60} aria-label="読み込み中" />
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/")} sx={{ mb: 2 }}>
          ホームに戻る
        </Button>
        <Paper elevation={0} sx={{ p: 3, backgroundColor: "#f5f5f5" }}>
          <Typography variant="h4" component="h1" gutterBottom>
            <span aria-hidden="true">📊</span> 学習履歴
          </Typography>
          <Typography variant="body1" color="text.secondary">
            あなたの学習進捗と成果を確認できます
          </Typography>
        </Paper>
      </Box>

      <Box sx={{ mb: 4 }}>
        <Box component="section" aria-label="学習サマリー" sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          <Box sx={{ flex: '1 1 300px', minWidth: '250px' }}>
            <Card elevation={2}>
              <CardContent sx={{ textAlign: 'center' }}>
                <SchoolIcon sx={{ fontSize: 40, color: 'primary.main', mb: 1 }} />
                <Typography variant="h4" color="primary.main">{progress.length}</Typography>
                <Typography variant="body2" color="text.secondary">完了レッスン数</Typography>
              </CardContent>
            </Card>
          </Box>
          <Box sx={{ flex: '1 1 300px', minWidth: '250px' }}>
            <Card elevation={2}>
              <CardContent sx={{ textAlign: 'center' }}>
                <TrendingUpIcon sx={{ fontSize: 40, color: 'success.main', mb: 1 }} />
                <Typography variant="h4" color="success.main">{getTotalScore()}%</Typography>
                <Typography variant="body2" color="text.secondary">平均スコア</Typography>
              </CardContent>
            </Card>
          </Box>
          <Box sx={{ flex: '1 1 300px', minWidth: '250px' }}>
            <Card elevation={2}>
              <CardContent sx={{ textAlign: 'center' }}>
                <AccessTimeIcon sx={{ fontSize: 40, color: 'info.main', mb: 1 }} />
                <Typography variant="h4" color="info.main">{formatTime(getTotalTime())}</Typography>
                <Typography variant="body2" color="text.secondary">総学習時間</Typography>
              </CardContent>
            </Card>
          </Box>
        </Box>
      </Box>

      {progress.length === 0 ? (
        <Paper elevation={1} sx={{ p: 4, textAlign: "center" }}>
          <SchoolIcon sx={{ fontSize: 60, color: "text.secondary", mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            まだ学習履歴がありません
          </Typography>
          <Typography variant="body2" color="text.secondary">
            レッスンを完了すると、ここに履歴が表示されます
          </Typography>
          <Button variant="contained" onClick={() => navigate("/")} sx={{ mt: 2 }}>
            レッスンを始める
          </Button>
        </Paper>
      ) : (
        <Card elevation={2}>
          <CardContent>
            <Typography variant="h6" component="h2" id="progress-table-title" gutterBottom>学習履歴一覧</Typography>
            <TableContainer>
              <Table aria-labelledby="progress-table-title">
                <TableHead>
                  <TableRow>
                    <TableCell>レッスン</TableCell>
                    <TableCell>シーン</TableCell>
                    <TableCell>完了日時</TableCell>
                    <TableCell>スコア</TableCell>
                    <TableCell>学習時間</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {progress.map((item, idx) => (
                    <TableRow key={item.id ?? `local-${idx}`}>
                      <TableCell><Typography variant="body1" sx={{ fontWeight: 'bold' }}>{item.lesson_title}</Typography></TableCell>
                      <TableCell><Chip label={item.scene_title} size="small" color="primary" /></TableCell>
                      <TableCell><Typography variant="body2" color="text.secondary">{formatDate(item.completed_at)}</Typography></TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2">{Math.min(item.score, 100)}%</Typography>
                          <LinearProgress
                            variant="determinate"
                            value={Math.min(item.score, 100)}
                            aria-label={`${item.lesson_title} のスコア`}
                            sx={{ width: 60, height: 6, borderRadius: 3 }}
                          />
                        </Box>
                      </TableCell>
                      <TableCell><Typography variant="body2" color="text.secondary">{formatTime(item.time_spent)}</Typography></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}
    </Container>
  );
};

export default ProgressHistory; 