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
  LinearProgress,
  Grid
} from "@mui/material";
import { 
  ArrowBack as ArrowBackIcon,
  School as SchoolIcon,
  TrendingUp as TrendingUpIcon,
  AccessTime as AccessTimeIcon
} from "@mui/icons-material";

// APIのベースURL設定
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';

type Progress = {
  id?: number; // サーバのみ
  lesson?: number; // ローカルのみで使用
  lesson_title: string;
  scene_title: string;
  completed_at: string;
  score: number;
  time_spent: number;
};

const LOCAL_PROGRESS_KEY = "ee_local_progress";

type SceneLite = { id: number; title: string; lessons?: { id: number; title: string }[] };

const ProgressHistory: React.FC = () => {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<Progress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProgress();
  }, []);

  const readLocal = (): { lesson: number; score: number; time_spent: number }[] => {
    try {
      const raw = localStorage.getItem(LOCAL_PROGRESS_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  };

  const buildLessonMap = (scenes: SceneLite[]): Map<number, { lesson_title: string; scene_title: string }> => {
    const map = new Map<number, { lesson_title: string; scene_title: string }>();
    for (const s of scenes || []) {
      for (const l of s.lessons || []) {
        map.set(l.id, { lesson_title: l.title, scene_title: s.title });
      }
    }
    return map;
  };

  const fetchProgress = async () => {
    try {
      const [progressRes, scenesRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/progress/my_progress/`).catch(() => ({ data: [] })),
        axios.get(`${API_BASE_URL}/api/scenes/`).catch(() => ({ data: [] })),
      ]);
      const server: Progress[] = progressRes.data || [];
      const scenes: SceneLite[] = scenesRes.data || [];
      const lessonMap = buildLessonMap(scenes);

      // ローカル分をタイトル補完してProgress形式へ
      const local = readLocal();
      const localAsProgress: Progress[] = local.map((x) => {
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

      const merged = [...server, ...localAsProgress];
      setProgress(merged);
      setLoading(false);
    } catch (err) {
      // サーバダウン時はローカルのみ表示（タイトルはフォールバック）
      const local = readLocal();
      const localAsProgress: Progress[] = local.map((x) => ({
        lesson: x.lesson,
        lesson_title: `Lesson #${x.lesson}`,
        scene_title: "(未同期)",
        completed_at: new Date().toISOString(),
        score: x.score,
        time_spent: x.time_spent,
      }));
      setProgress(localAsProgress);
      setError(null);
      setLoading(false);
    }
  };

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

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/")} sx={{ mb: 2 }}>
          ホームに戻る
        </Button>
        <Paper elevation={0} sx={{ p: 3, backgroundColor: "#f5f5f5" }}>
          <Typography variant="h4" component="h1" gutterBottom>
            📊 学習履歴
          </Typography>
          <Typography variant="body1" color="text.secondary">
            あなたの学習進捗と成果を確認できます
          </Typography>
        </Paper>
      </Box>

      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
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
            <Typography variant="h6" gutterBottom>学習履歴一覧</Typography>
            <TableContainer>
              <Table>
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
                      <TableCell><Typography variant="body1" fontWeight="bold">{item.lesson_title}</Typography></TableCell>
                      <TableCell><Chip label={item.scene_title} size="small" color="primary" /></TableCell>
                      <TableCell><Typography variant="body2" color="text.secondary">{formatDate(item.completed_at)}</Typography></TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2">{Math.min(item.score, 100)}%</Typography>
                          <LinearProgress variant="determinate" value={Math.min(item.score, 100)} sx={{ width: 60, height: 6, borderRadius: 3 }} />
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