import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import {
  Card,
  CardContent,
  Typography,
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
import { parseId } from "./lib/params";
import { isNotFoundError, queryView } from "./lib/queryState";
import { usePageTitle } from "./hooks/usePageTitle";
import NotFound from "./components/NotFound";
import { LoadingView, QueryErrorAlert } from "./components/QueryStatus";
import { pushLocalProgress, removeLocalProgressEntry } from "./lib/storage";
import { useAppAuth } from "./lib/auth";
import { pickEnglishVoice, utteranceLang } from "./lib/tts";
import {
  useCompleteLessonMutation,
  useLessonQuery,
  type Dialogue,
  type Phrase,
} from "./lib/queries";

// 読み上げ速度の選択肢
const SPEECH_RATES = [0.75, 1, 1.25, 1.5];
const DEFAULT_SPEECH_RATE = 1.5;

// 完了時にサーバへ送るスコア（API との互換性のため、完了は常に 100 として記録する）
const COMPLETED_SCORE = 100;

// 完了の通知を表示してから学習履歴へ移動するまでの時間
const NAVIGATE_DELAY_MS = 1200;
const NAVIGATE_DELAY_WARNING_MS = 3000;

type CompletionNotice = { severity: "success" | "warning"; message: string };
const SUCCESS_NOTICE: CompletionNotice = { severity: "success", message: "レッスンを完了しました！" };
const PENDING_NOTICE: CompletionNotice = {
  severity: "warning",
  message: "サーバーへの保存に失敗しました。次回ログイン時に再送します。",
};

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
  const { isAuthenticated, sub } = useAppAuth();
  // ID の形式が正しくない場合は取得せず「見つかりません」を表示する
  const lessonNumber = parseId(lessonId);
  const lessonQuery = useLessonQuery(lessonNumber ?? undefined);
  const completeLesson = useCompleteLessonMutation();
  const [currentStep, setCurrentStep] = useState(0);
  // 「レッスン完了」を押した後は true（画面を離れるまで再送信しない）
  const [finished, setFinished] = useState(false);
  const submittedRef = useRef(false);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [notice, setNotice] = useState<CompletionNotice | null>(null);

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
    // 音声の一覧は非同期に読み込まれるため、読み込み完了の通知で更新する
    if (typeof synth.addEventListener === "function") {
      synth.addEventListener("voiceschanged", loadVoices);
      return () => synth.removeEventListener("voiceschanged", loadVoices);
    }
    synth.onvoiceschanged = loadVoices;
    return () => {
      if (synth.onvoiceschanged === loadVoices) synth.onvoiceschanged = null;
    };
  }, []);

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
      // 読み上げ中・待機中の音声をすべて止めてから読み上げる
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickEnglishVoice(voices.length > 0 ? voices : synth.getVoices());
      if (voice) u.voice = voice;
      u.lang = utteranceLang(voice);
      u.rate = speechRate; // 上限は環境で異なります
      u.pitch = 1.0;  // 標準ピッチ
      // 停止・切り替え済みの読み上げの終了通知では、現在の表示を変えない
      const finish = () => {
        if (utteranceRef.current === u) resetSpeaking();
      };
      u.onend = finish;
      u.onerror = finish;
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
      window.speechSynthesis?.cancel();
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

  const lastStep = steps.length - 1;

  const handleNext = () => {
    if (currentStep < lastStep) setCurrentStep(currentStep + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleComplete = () => {
    // 連続して押しても 1 回だけ保存する
    if (submittedRef.current || lessonNumber === null) return;
    submittedRef.current = true;
    setFinished(true);
    const timeSpent = startTime ? Math.floor((new Date().getTime() - startTime.getTime()) / 1000) : 0;
    // 学習進捗はまずブラウザに保存し、サーバーの保存状況に関わらず失われないようにする
    // ログイン中は本人の保存待ちの記録として保存し、アカウントに保存できたら削除する
    const owner = isAuthenticated ? sub : null;
    const entry = {
      lesson: lessonNumber,
      score: COMPLETED_SCORE,
      time_spent: timeSpent,
      owner,
      completed_at: new Date().toISOString(),
    };
    pushLocalProgress(entry);
    const finish = (next: CompletionNotice, delay: number) => {
      setNotice(next);
      navigateTimerRef.current = setTimeout(() => navigate("/progress"), delay);
    };
    completeLesson.mutate(
      { lessonId: String(lessonNumber), score: COMPLETED_SCORE, timeSpent },
      {
        onSuccess: () => {
          if (owner) removeLocalProgressEntry(entry);
          finish(SUCCESS_NOTICE, NAVIGATE_DELAY_MS);
        },
        onError: () => {
          // 未ログイン時はブラウザへの保存で完了とし、ログイン中は次回ログイン時の再送を案内する
          finish(owner ? PENDING_NOTICE : SUCCESS_NOTICE, owner ? NAVIGATE_DELAY_WARNING_MS : NAVIGATE_DELAY_MS);
        },
      }
    );
  };

  const lesson = lessonQuery.data ?? null;
  const saving = completeLesson.isPending;
  const view = queryView(lessonQuery);
  usePageTitle(lesson?.title);

  if (lessonNumber === null || (view === "error" && isNotFoundError(lessonQuery.error))) {
    return <NotFound />;
  }

  if (view === "loading") {
    return <LoadingView />;
  }

  if (view === "error" || view === "offline") {
    return (
      <QueryErrorAlert
        title="レッスンを取得できませんでした"
        error={lessonQuery.error}
        offline={view === "offline"}
        onRetry={() => void lessonQuery.refetch()}
      />
    );
  }

  if (!lesson) {
    return <NotFound />;
  }

  // 進捗は現在のステップの位置から求める（戻る・進むを繰り返しても 100% を超えない）
  const progress = Math.min(100, Math.max(0, (currentStep / lastStep) * 100));
  const backPath = Number.isSafeInteger(lesson.scene) && lesson.scene > 0 ? `/scene/${lesson.scene}` : "/";

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {/* ヘッダー */}
      <Box sx={{ mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backPath)} sx={{ mb: 2 }}>
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
            <Step key={label} completed={index < currentStep || (finished && index === lastStep)}>
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
              <Typography variant="body1" sx={{ mb: 2 }}>お疲れさまでした！このレッスンは完了です。</Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* ナビゲーション */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
        <Button disabled={currentStep === 0 || finished} onClick={handleBack}>前へ</Button>
        <Box>
          {currentStep === lastStep ? (
            <Button variant="contained" onClick={handleComplete} startIcon={<CheckIcon />} disabled={finished}>
              {saving ? '保存中...' : finished ? '完了しました' : 'レッスン完了'}
            </Button>
          ) : (
            <Button variant="contained" onClick={handleNext}>次へ</Button>
          )}
        </Box>
      </Box>

      <Snackbar open={!!notice} autoHideDuration={notice?.severity === 'warning' ? NAVIGATE_DELAY_WARNING_MS : NAVIGATE_DELAY_MS} onClose={() => setNotice(null)}>
        <Alert severity={notice?.severity ?? 'success'} variant="filled" sx={{ width: '100%' }}>
          {notice?.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default LessonDetail; 