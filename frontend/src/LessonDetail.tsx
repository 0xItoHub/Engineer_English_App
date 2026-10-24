import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
  Tooltip,
  ToggleButton,
  ToggleButtonGroup
} from "@mui/material";
import { 
  ArrowBack as ArrowBackIcon,
  Check as CheckIcon,
  Book as BookIcon,
  Chat as ChatIcon,
  VolumeUp as VolumeUpIcon,
  StopCircle as StopCircleIcon
} from "@mui/icons-material";
import { getErrorMessage } from "./lib/http";
import { pushLocalProgress } from "./lib/storage";
import {
  useCompleteLessonMutation,
  useLessonQuery,
  useSceneQuery,
  type Dialogue,
  type Phrase,
} from "./lib/queries";

// 読み上げ速度の選択肢
const SPEECH_RATES = [0.75, 1, 1.25, 1.5];
const DEFAULT_SPEECH_RATE = 1.5;

// Web Speech API（音声合成）が利用できるか
function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    !!window.speechSynthesis &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

const LessonDetail: React.FC = () => {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const lessonQuery = useLessonQuery(lessonId ? Number(lessonId) : undefined);
  // レッスン取得後に、所属するシーン（戻り先）を取得する
  const sceneQuery = useSceneQuery(lessonQuery.data?.scene);
  const completeLesson = useCompleteLessonMutation();
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [snackOpen, setSnackOpen] = useState(false);

  // TTS（Web Speech API）
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [speakingDialogueId, setSpeakingDialogueId] = useState<number | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // 読み上げ速度（既定はネイティブ並みの 1.5 倍）
  const [speechRate, setSpeechRate] = useState<number>(DEFAULT_SPEECH_RATE);
  const ttsSupported = isSpeechSynthesisSupported();

  useEffect(() => {
    if (!isSpeechSynthesisSupported()) return;
    const synth = window.speechSynthesis;
    const loadVoices = () => setVoices(synth.getVoices());
    loadVoices();
    synth.addEventListener?.("voiceschanged", loadVoices);
    return () => synth.removeEventListener?.("voiceschanged", loadVoices);
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

  const resetSpeaking = () => {
    setSpeakingId(null);
    setSpeakingDialogueId(null);
    utteranceRef.current = null;
  };

  // フレーズ・対話共通の読み上げ処理
  const speakText = (text: string, target: { phraseId?: number; dialogueId?: number }) => {
    if (!isSpeechSynthesisSupported()) return;
    try {
      const synth = window.speechSynthesis;
      if (synth.speaking) {
        synth.cancel();
      }
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickEnglishVoice();
      if (voice) u.voice = voice;
      u.lang = voice?.lang || "en-US";
      u.rate = speechRate; // 上限は環境で異なります
      u.pitch = 1.0;  // 標準ピッチ
      u.onend = resetSpeaking;
      u.onerror = resetSpeaking;
      utteranceRef.current = u;
      setSpeakingId(target.phraseId ?? null);
      setSpeakingDialogueId(target.dialogueId ?? null);
      synth.speak(u);
    } catch (e) {
      console.error("TTS error", e);
      resetSpeaking();
    }
  };

  const speak = (phrase: Phrase) => speakText(phrase.text_en, { phraseId: phrase.id });

  const speakDialogue = (dialogue: Dialogue) => speakText(dialogue.line_en, { dialogueId: dialogue.id });

  const stopSpeaking = () => {
    try {
      const synth = window.speechSynthesis;
      if (synth?.speaking) synth.cancel();
    } catch {
      // 読み上げを停止できない環境では何もしない
    }
    resetSpeaking();
  };

  useEffect(() => {
    return () => {
      // アンマウント時に停止
      try { window.speechSynthesis?.cancel(); } catch { /* 読み上げ非対応の環境では何もしない */ }
    };
  }, []);

  // 読み上げボタン（非対応ブラウザでは無効化して案内を表示）
  const renderSpeakButton = (label: string, speaking: boolean, onSpeak: () => void) => {
    if (!ttsSupported) {
      return (
        <Tooltip title="お使いのブラウザは音声読み上げに対応していません">
          <span>
            <IconButton color="primary" disabled aria-label={`${label}（音声読み上げ非対応）`}>
              <VolumeUpIcon />
            </IconButton>
          </span>
        </Tooltip>
      );
    }
    return speaking ? (
      <Tooltip title="停止">
        <IconButton color="error" onClick={stopSpeaking} aria-label={`${label} の読み上げを停止`}>
          <StopCircleIcon />
        </IconButton>
      </Tooltip>
    ) : (
      <Tooltip title="英語で読み上げ">
        <IconButton color="primary" onClick={onSpeak} aria-label={`${label} を英語で読み上げ`}>
          <VolumeUpIcon />
        </IconButton>
      </Tooltip>
    );
  };

  // 読み上げ速度の切り替え（読み上げ対応時のみ表示）
  const speechRateControl = ttsSupported ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
      <Typography variant="body2" color="text.secondary" id="speech-rate-label">読み上げ速度</Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={speechRate}
        onChange={(_e, v: number | null) => { if (v != null) setSpeechRate(v); }}
        aria-labelledby="speech-rate-label"
      >
        {SPEECH_RATES.map((r) => (
          <ToggleButton key={r} value={r} aria-label={`${r} 倍速`}>{r}x</ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  ) : null;

  // レッスンごとに学習時間の計測を開始する
  useEffect(() => {
    if (!lessonId) return;
    setStartTime(new Date());
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

  const handleComplete = () => {
    setCompletedSteps([...completedSteps, currentStep]);
    const timeSpent = startTime ? Math.floor((new Date().getTime() - startTime.getTime()) / 1000) : 0;
    // スコアを100%を超えないように制限
    const calculatedScore = Math.round((completedSteps.length + 1) / steps.length * 100);
    const score = Math.min(calculatedScore, 100);
    // 学習進捗はブラウザにも保存し、サーバーの保存状況に関わらず履歴に反映する
    pushLocalProgress({ lesson: Number(lessonId), score, time_spent: timeSpent });
    // サーバへの保存結果に関わらず、完了を通知して履歴画面へ進む
    completeLesson.mutate(
      { lessonId: lessonId ?? "", score, timeSpent },
      {
        onSettled: () => {
          setSnackOpen(true);
          navigateTimerRef.current = setTimeout(() => navigate('/progress'), 1200);
        },
      }
    );
  };

  const lesson = lessonQuery.data ?? null;
  const scene = sceneQuery.data ?? null;
  const saving = completeLesson.isPending;
  const loading = lessonQuery.isPending || (!!lesson && sceneQuery.isPending);
  const failed = lessonQuery.isError && !lesson ? lessonQuery.error : sceneQuery.isError && !scene ? sceneQuery.error : null;
  const error = failed ? "レッスン取得エラー: " + getErrorMessage(failed) : null;

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress size={60} aria-label="読み込み中" />
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
            <span aria-hidden="true">📚</span> {lesson.title}
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
        <LinearProgress variant="determinate" value={progress} aria-label="レッスンの進捗" sx={{ height: 8, borderRadius: 4 }} />
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
      <Card elevation={2} component="section" aria-label={steps[currentStep]}>
        <CardContent>
          {currentStep === 0 && (
            <Box>
              <Typography variant="h6" component="h2" gutterBottom>
                <span aria-hidden="true">🎯</span> レッスン概要
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
              <Typography variant="h6" component="h2" gutterBottom><span aria-hidden="true">📖</span> フレーズ学習</Typography>
              {lesson.lesson_phrases && lesson.lesson_phrases.length > 0 && speechRateControl}
              {lesson.lesson_phrases && lesson.lesson_phrases.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {lesson.lesson_phrases.map((p) => (
                    <Card key={p.id} variant="outlined">
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                          <Box>
                            <Typography variant="h6" component="p" lang="en" gutterBottom>{p.text_en}</Typography>
                            <Typography variant="body1" color="text.secondary" gutterBottom>{p.text_ja}</Typography>
                            {p.note && (<Typography variant="caption" color="text.secondary">メモ: {p.note}</Typography>)}
                          </Box>
                          <Box>
                            {renderSpeakButton(p.text_en, speakingId === p.id, () => speak(p))}
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
              <Typography variant="h6" component="h2" gutterBottom><span aria-hidden="true">💬</span> 対話練習</Typography>
              {lesson.lesson_dialogues && lesson.lesson_dialogues.length > 0 && speechRateControl}
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
                          <Typography variant="h6" component="p" lang="en" gutterBottom sx={{ mb: 0 }}>{d.line_en}</Typography>
                          <Box>
                            {renderSpeakButton(d.line_en, speakingDialogueId === d.id, () => speakDialogue(d))}
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
              <Typography variant="h6" component="h2" gutterBottom><span aria-hidden="true">🎉</span> まとめ</Typography>
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