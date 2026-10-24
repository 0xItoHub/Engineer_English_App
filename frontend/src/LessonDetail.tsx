import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
  Stepper,
  Step,
  StepLabel,
  LinearProgress,
  Container,
  Chip,
  Snackbar,
  IconButton,
  Tooltip
} from "@mui/material";
import { 
  ArrowBack as ArrowBackIcon,
  Check as CheckIcon,
  Book as BookIcon,
  Chat as ChatIcon,
  VolumeUp as VolumeUpIcon,
  StopCircle as StopCircleIcon
} from "@mui/icons-material";
import { getErrorMessage, isAbortError } from "./lib/http";
import { pushLocalProgress } from "./lib/storage";

// APIのベースURL設定
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';

type Lesson = {
  id: number;
  title: string;
  description: string;
  scene: number;
  lesson_phrases?: Phrase[];
  lesson_dialogues?: Dialogue[];
};

type Scene = {
  id: number;
  title: string;
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

const LessonDetail: React.FC = () => {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [snackOpen, setSnackOpen] = useState(false);

  // TTS（Web Speech API）
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [speakingDialogueId, setSpeakingDialogueId] = useState<number | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const synth = window.speechSynthesis;
    const loadVoices = () => setVoices(synth.getVoices());
    loadVoices();
    synth.addEventListener("voiceschanged", loadVoices);
    return () => synth.removeEventListener("voiceschanged", loadVoices);
  }, []);

  const pickEnglishVoice = () => {
    if (!voices || voices.length === 0) return undefined;
    const byName = (kw: string) => voices.find(v => v.name?.toLowerCase().includes(kw));
    const byLang = (pref: string) => voices.find(v => v.lang?.toLowerCase().startsWith(pref));

    // 自然合成系（Natural/Neural/Onlineなど）を最優先
    return (
      byName('natural') ||
      byName('neural') ||
      byName('online') ||
      byLang('en-us') ||
      byLang('en-gb') ||
      byLang('en')
    );
  };

  const speak = (phrase: Phrase) => {
    try {
      const synth = window.speechSynthesis;
      if (synth.speaking) {
        synth.cancel();
      }
      const u = new SpeechSynthesisUtterance(phrase.text_en);
      const voice = pickEnglishVoice();
      if (voice) u.voice = voice;
      u.lang = voice?.lang || "en-US";
      // ネイティブ並みのスピード感
      u.rate = 1.5;   // かなり速め（上限は環境で異なります）
      u.pitch = 1.0;  // 標準ピッチに戻す
      u.onend = () => {
        setSpeakingId(null);
        setSpeakingDialogueId(null);
        utteranceRef.current = null;
      };
      utteranceRef.current = u;
      setSpeakingId(phrase.id);
      setSpeakingDialogueId(null);
      synth.speak(u);
    } catch (e) {
      console.error("TTS error", e);
    }
  };

  const speakDialogue = (dialogue: Dialogue) => {
    try {
      const synth = window.speechSynthesis;
      if (synth.speaking) {
        synth.cancel();
      }
      const u = new SpeechSynthesisUtterance(dialogue.line_en);
      const voice = pickEnglishVoice();
      if (voice) u.voice = voice;
      u.lang = voice?.lang || "en-US";
      u.rate = 1.5;
      u.pitch = 1.0;
      u.onend = () => {
        setSpeakingId(null);
        setSpeakingDialogueId(null);
        utteranceRef.current = null;
      };
      utteranceRef.current = u;
      setSpeakingDialogueId(dialogue.id);
      setSpeakingId(null);
      synth.speak(u);
    } catch (e) {
      console.error("TTS error", e);
    }
  };

  const stopSpeaking = () => {
    const synth = window.speechSynthesis;
    if (synth.speaking) synth.cancel();
    setSpeakingId(null);
    setSpeakingDialogueId(null);
    utteranceRef.current = null;
  };

  useEffect(() => {
    return () => {
      // アンマウント時に停止
      try { window.speechSynthesis.cancel(); } catch {}
    };
  }, []);

  useEffect(() => {
    if (!lessonId) return;
    // 画面遷移時はリクエストを中断し、アンマウント後の state 更新を防ぐ
    const controller = new AbortController();
    const { signal } = controller;
    setStartTime(new Date());
    axios
      .get(`${API_BASE_URL}/api/lessons/${lessonId}/`, { signal })
      .then((res) => {
        if (signal.aborted) return null;
        setLesson(res.data);
        return axios.get(`${API_BASE_URL}/api/scenes/${res.data.scene}/`, { signal });
      })
      .then((res) => {
        if (!res || signal.aborted) return;
        setScene(res.data);
        setLoading(false);
      })
      .catch((err) => {
        if (signal.aborted || isAbortError(err)) return;
        setError("レッスン取得エラー: " + getErrorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [lessonId]);

  // 完了後の画面遷移タイマー（アンマウント時に解除）
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current);
    };
  }, []);

  const steps = [
    "レッスン概要",
    "フレーズ学習",
    "対話練習",
    "まとめ"
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCompletedSteps([...completedSteps, currentStep]);
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    setCompletedSteps([...completedSteps, currentStep]);
    const timeSpent = startTime ? Math.floor((new Date().getTime() - startTime.getTime()) / 1000) : 0;
    // スコアを100%を超えないように制限
    const calculatedScore = Math.round((completedSteps.length + 1) / steps.length * 100);
    const score = Math.min(calculatedScore, 100);
    try {
      setSaving(true);
      const res = await axios.post(`${API_BASE_URL}/api/progress/complete_lesson/`, {
        lesson_id: lessonId, score, time_spent: timeSpent
      }).catch((e) => e.response);
      if (!res || (res.status && res.status >= 400)) {
        // 未ログインなどで保存されなかった場合はlocalStorageへ
        pushLocalProgress({ lesson: Number(lessonId), score, time_spent: timeSpent });
      }
      setSnackOpen(true);
      navigateTimerRef.current = setTimeout(() => navigate('/progress'), 1200);
    } catch (err) {
      // 念のためローカル保存
      pushLocalProgress({ lesson: Number(lessonId), score, time_spent: timeSpent });
      setSnackOpen(true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress size={60} />
      </Box>
    );
  }

  if (error || !lesson || !scene) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {error || 'データ取得に失敗しました'}
      </Alert>
    );
  }

  const progress = ((completedSteps.length + (currentStep === steps.length - 1 ? 1 : 0)) / steps.length) * 100;

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {/* ヘッダー */}
      <Box sx={{ mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(`/scene/${scene.id}`)} sx={{ mb: 2 }}>
          シーンに戻る
        </Button>
        <Paper elevation={0} sx={{ p: 3, backgroundColor: "#f5f5f5" }}>
          <Typography variant="h4" component="h1" gutterBottom>
            📚 {lesson.title}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {lesson.description}
          </Typography>
        </Paper>
      </Box>

      {/* 進捗バー */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            進捗: {Math.round(progress)}%
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {currentStep + 1} / {steps.length}
          </Typography>
        </Box>
        <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 4 }} />
      </Box>

      {/* ステッパー */}
      <Box sx={{ mb: 4 }}>
        <Stepper activeStep={currentStep} alternativeLabel>
          {steps.map((label, index) => (
            <Step key={label} completed={completedSteps.includes(index)}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      {/* 学習コンテンツ */}
      <Card elevation={2}>
        <CardContent>
          {currentStep === 0 && (
            <Box>
              <Typography variant="h6" gutterBottom>
                🎯 レッスン概要
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <BookIcon color="primary" />
                  <Typography>フレーズ: {lesson.lesson_phrases?.length || 0}個</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ChatIcon color="primary" />
                  <Typography>対話: {lesson.lesson_dialogues?.length || 0}個</Typography>
                </Box>
              </Box>
            </Box>
          )}

          {currentStep === 1 && (
            <Box>
              <Typography variant="h6" gutterBottom>📖 フレーズ学習</Typography>
              {lesson.lesson_phrases && lesson.lesson_phrases.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {lesson.lesson_phrases.map((p) => (
                    <Card key={p.id} variant="outlined">
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                          <Box>
                            <Typography variant="h6" gutterBottom>{p.text_en}</Typography>
                            <Typography variant="body1" color="text.secondary" gutterBottom>{p.text_ja}</Typography>
                            {p.note && (<Typography variant="caption" color="text.secondary">メモ: {p.note}</Typography>)}
                          </Box>
                          <Box>
                            {speakingId === p.id ? (
                              <Tooltip title="停止">
                                <IconButton color="error" onClick={stopSpeaking}>
                                  <StopCircleIcon />
                                </IconButton>
                              </Tooltip>
                            ) : (
                              <Tooltip title="英語で読み上げ">
                                <IconButton color="primary" onClick={() => speak(p)}>
                                  <VolumeUpIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              ) : (
                <Typography variant="body1" color="text.secondary">このレッスンにはフレーズがありません。</Typography>
              )}
            </Box>
          )}

          {currentStep === 2 && (
            <Box>
              <Typography variant="h6" gutterBottom>💬 対話練習</Typography>
              {lesson.lesson_dialogues && lesson.lesson_dialogues.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {lesson.lesson_dialogues.map((d) => (
                    <Card key={d.id} variant="outlined">
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <Chip label={d.speaker} size="small" color="primary" />
                          <Typography variant="body2" color="text.secondary">順序: {d.order}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                          <Typography variant="h6" gutterBottom sx={{ mb: 0 }}>{d.line_en}</Typography>
                          <Box>
                            {speakingDialogueId === d.id ? (
                              <Tooltip title="停止">
                                <IconButton color="error" onClick={stopSpeaking}>
                                  <StopCircleIcon />
                                </IconButton>
                              </Tooltip>
                            ) : (
                              <Tooltip title="英語で読み上げ">
                                <IconButton color="primary" onClick={() => speakDialogue(d)}>
                                  <VolumeUpIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                          </Box>
                        </Box>
                        <Typography variant="body1" color="text.secondary">{d.line_ja}</Typography>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              ) : (
                <Typography variant="body1" color="text.secondary">このレッスンには対話がありません。</Typography>
              )}
            </Box>
          )}

          {currentStep === 3 && (
            <Box>
              <Typography variant="h6" gutterBottom>🎉 まとめ</Typography>
              <Typography variant="body1" paragraph>お疲れさまでした！このレッスンは完了です。</Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* ナビゲーション */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
        <Button disabled={currentStep === 0} onClick={handleBack}>前へ</Button>
        <Box>
          {currentStep === steps.length - 1 ? (
            <Button variant="contained" onClick={handleComplete} startIcon={<CheckIcon />} disabled={saving}>
              {saving ? '保存中...' : 'レッスン完了'}
            </Button>
          ) : (
            <Button variant="contained" onClick={handleNext}>次へ</Button>
          )}
        </Box>
      </Box>

      <Snackbar open={snackOpen} autoHideDuration={1200} onClose={() => setSnackOpen(false)}>
        <Alert severity="success" variant="filled" sx={{ width: '100%' }}>
          レッスンを完了しました！
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default LessonDetail; 