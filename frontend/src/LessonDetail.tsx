import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link as RouterLink } from "react-router";
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
  Chip,
  Snackbar,
  IconButton,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Stack
} from "@mui/material";
import { 
  ArrowBack as ArrowBackIcon,
  Check as CheckIcon,
  Book as BookIcon,
  Chat as ChatIcon,
  VolumeUp as VolumeUpIcon,
  StopCircle as StopCircleIcon,
  ArrowForward as ArrowForwardIcon,
  TrendingUp as TrendingUpIcon,
  MenuBook as MenuBookIcon,
  Flag as FlagIcon,
  AutoStories as AutoStoriesIcon,
  Forum as ForumIcon,
  EmojiEvents as EmojiEventsIcon
} from "@mui/icons-material";
import { parseId } from "./lib/params";
import { isNotFoundError, queryView } from "./lib/queryState";
import { usePageTitle } from "./hooks/usePageTitle";
import NotFound from "./components/NotFound";
import { LoadingView, QueryErrorAlert } from "./components/QueryStatus";
import { pushLocalProgress, readSpeechRate, removeLocalProgressEntry, writeLastLesson, writeSpeechRate } from "./lib/storage";
import { visuallyHidden } from "./lib/a11y";
import { useAppAuth } from "./lib/auth";
import { pickEnglishVoice, utteranceLang } from "./lib/tts";
import { findNextTarget } from "./lib/lessonNavigation";
import { DEFAULT_LESSON_DESCRIPTION, lessonDescription, phraseNote, speakerLabel } from "./lib/labels";
import {
  useCompleteLessonMutation,
  useLessonQuery,
  useScenesQuery,
  type Dialogue,
  type Phrase,
} from "./lib/queries";

// 読み上げ速度の選択肢
const SPEECH_RATES = [0.75, 1, 1.25, 1.5];
const DEFAULT_SPEECH_RATE = 1;

// 完了時にサーバへ送るスコア（API との互換性のため、完了は常に 100 として記録する）
const COMPLETED_SCORE = 100;

// 完了の通知を表示する時間
const NOTICE_DURATION_MS = 4000;
const NOTICE_DURATION_WARNING_MS = 6000;

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

// レッスンごとに学習の状態（ステップ・完了・学習時間）を新しくする
// 「次のレッスンへ」で同じ画面のまま別のレッスンへ移動した場合も、最初のステップから始める
const LessonDetail: React.FC = () => {
  const { lessonId } = useParams<{ lessonId: string }>();
  return <LessonContent key={lessonId ?? ""} lessonId={lessonId} />;
};

const LessonContent: React.FC<{ lessonId: string | undefined }> = ({ lessonId }) => {
  const navigate = useNavigate();
  const { isAuthenticated, sub } = useAppAuth();
  // ID の形式が正しくない場合は取得せず「見つかりません」を表示する
  const lessonNumber = parseId(lessonId);
  const lessonQuery = useLessonQuery(lessonNumber ?? undefined);
  const completeLesson = useCompleteLessonMutation();
  // 次のレッスン・シーンの案内に使う（ホームと同じキャッシュを共有する）
  const scenesQuery = useScenesQuery({ enabled: lessonNumber !== null });
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
  // 読み上げ速度（既定は標準の 1 倍。前回選んだ速度をブラウザに記憶する）
  const [speechRate, setSpeechRate] = useState<number>(() => readSpeechRate(SPEECH_RATES, DEFAULT_SPEECH_RATE));
  const changeSpeechRate = (rate: number) => {
    setSpeechRate(rate);
    writeSpeechRate(rate);
  };
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
            <IconButton size="large" color="primary" disabled aria-label={`${label}（音声読み上げ非対応）`}>
              <VolumeUpIcon />
            </IconButton>
          </span>
        </Tooltip>
      );
    }
    return speaking ? (
      <Tooltip title="停止">
        <IconButton size="large" color="error" onClick={stopSpeaking} aria-label={`${label} の読み上げを停止`}>
          <StopCircleIcon />
        </IconButton>
      </Tooltip>
    ) : (
      <Tooltip title="英語で読み上げ">
        <IconButton size="large" color="primary" onClick={onSpeak} aria-label={`${label} を英語で読み上げ`}>
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
        onChange={(_e, v: number | null) => { if (v != null) changeSpeechRate(v); }}
        aria-labelledby="speech-rate-label"
        sx={{ '& .MuiToggleButton-root': { minHeight: 44, minWidth: 44 } }}
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

  const steps = [
    "レッスン概要",
    "フレーズ学習",
    "対話練習",
    "まとめ"
  ];

  const lastStep = steps.length - 1;

  // ステップを切り替えたら、そのステップの見出しへフォーカスを移す（最初の表示では移さない）
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const completionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const stepChangedRef = useRef(false);
  useEffect(() => {
    if (!stepChangedRef.current) return;
    stepHeadingRef.current?.focus({ preventScroll: false });
  }, [currentStep]);
  useEffect(() => {
    if (finished) completionHeadingRef.current?.focus();
  }, [finished]);

  const goToStep = (step: number) => {
    stepChangedRef.current = true;
    setCurrentStep(step);
  };

  const handleNext = () => {
    if (currentStep < lastStep) goToStep(currentStep + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) goToStep(currentStep - 1);
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
    completeLesson.mutate(
      { lessonId: String(lessonNumber), score: COMPLETED_SCORE, timeSpent },
      {
        onSuccess: () => {
          if (owner) removeLocalProgressEntry(entry);
          setNotice(SUCCESS_NOTICE);
        },
        onError: () => {
          // 未ログイン時はブラウザへの保存で完了とし、ログイン中は次回ログイン時の再送を案内する
          setNotice(owner ? PENDING_NOTICE : SUCCESS_NOTICE);
        },
      }
    );
  };

  const lesson = lessonQuery.data ?? null;
  const saving = completeLesson.isPending;
  const view = queryView(lessonQuery);
  usePageTitle(lesson?.title);

  // ホームの「続きから」に表示するため、開いたレッスンをブラウザに記憶する
  const lessonIdForResume = lesson?.id;
  const sceneIdForResume = lesson?.scene;
  useEffect(() => {
    if (lessonIdForResume === undefined || sceneIdForResume === undefined) return;
    writeLastLesson({ lesson: lessonIdForResume, scene: sceneIdForResume });
  }, [lessonIdForResume, sceneIdForResume]);

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
  const nextTarget = findNextTarget(scenesQuery.data, lesson.scene, lesson.id);
  const phrases = lesson.lesson_phrases ?? [];
  const dialogues = lesson.lesson_dialogues ?? [];
  // ステップの見出し（切り替え時にフォーカスを移す）
  const stepHeadingProps = {
    ref: stepHeadingRef,
    tabIndex: -1,
    variant: "h6",
    component: "h2",
    gutterBottom: true,
    sx: { outline: "none", display: "flex", alignItems: "center", gap: 1 },
  } as const;

  return (
    // 幅と余白はメイン領域（App の Container）に合わせる
    <Box>
      {/* ヘッダー */}
      <Box sx={{ mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backPath)} sx={{ mb: 2 }}>
          シーンに戻る
        </Button>
        <Paper elevation={0} sx={{ p: 3, backgroundColor: "#f5f5f5" }}>
          <Typography variant="h4" component="h1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MenuBookIcon color="primary" fontSize="large" aria-hidden="true" />
            {lesson.title}
          </Typography>
          {/* タイトルを繰り返すだけの説明の代わりに、レッスンの進め方を案内する */}
          <Typography variant="body1" color="text.secondary">
            {lessonDescription(lesson.description, lesson.title) ?? DEFAULT_LESSON_DESCRIPTION}
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
        {/* ステップの切り替えを支援技術に伝える */}
        <Box aria-live="polite" sx={visuallyHidden}>
          {`ステップ ${currentStep + 1} / ${steps.length}: ${steps[currentStep]}`}
        </Box>
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
              <Typography {...stepHeadingProps}>
                <FlagIcon color="primary" aria-hidden="true" />
                レッスン概要
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
              <Typography {...stepHeadingProps}><AutoStoriesIcon color="primary" aria-hidden="true" />フレーズ学習</Typography>
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
                            {phraseNote(p.note) && (<Typography variant="body2" color="text.secondary">メモ: {phraseNote(p.note)}</Typography>)}
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
              <Typography {...stepHeadingProps}><ForumIcon color="primary" aria-hidden="true" />対話練習</Typography>
              {lesson.lesson_dialogues && lesson.lesson_dialogues.length > 0 && speechRateControl}
              {lesson.lesson_dialogues && lesson.lesson_dialogues.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {lesson.lesson_dialogues.map((d) => (
                    <Card key={d.id} variant="outlined">
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          {/* 発言の順番（番号のバッジ） */}
                          <Box
                            component="span"
                            aria-hidden="true"
                            sx={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              minWidth: 24,
                              height: 24,
                              px: 0.5,
                              borderRadius: 12,
                              bgcolor: 'grey.200',
                              color: 'text.secondary',
                              fontSize: 13,
                              fontWeight: 600,
                            }}
                          >
                            {d.order}
                          </Box>
                          <Box component="span" sx={visuallyHidden}>{d.order} 番目の発言</Box>
                          <Chip label={speakerLabel(d.speaker)} size="small" color="primary" />
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
              <Typography {...stepHeadingProps}><EmojiEventsIcon color="primary" aria-hidden="true" />まとめ</Typography>
              <Typography variant="body1" sx={{ mb: 2 }}>
                {finished
                  ? "このレッスンで学んだ表現です。読み上げを聞いて、いつでも振り返れます。"
                  : "このレッスンで学んだ表現を振り返りましょう。「レッスン完了」を押すと学習履歴に記録されます。"}
              </Typography>
              {(phrases.length > 0 || dialogues.length > 0) && speechRateControl}
              {phrases.length > 0 && (
                <Box component="section" aria-labelledby="recap-phrases-title" sx={{ mb: 2 }}>
                  <Typography id="recap-phrases-title" variant="subtitle1" component="h3" sx={{ fontWeight: 600, mb: 1 }}>
                    フレーズ
                  </Typography>
                  <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                    {phrases.map((p) => (
                      <Box component="li" key={p.id} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body1" lang="en" sx={{ fontWeight: 600 }}>{p.text_en}</Typography>
                          <Typography variant="body2" color="text.secondary">{p.text_ja}</Typography>
                        </Box>
                        {renderSpeakButton(p.text_en, speakingId === p.id, () => speak(p))}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
              {dialogues.length > 0 && (
                <Box component="section" aria-labelledby="recap-dialogues-title">
                  <Typography id="recap-dialogues-title" variant="subtitle1" component="h3" sx={{ fontWeight: 600, mb: 1 }}>
                    対話
                  </Typography>
                  <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                    {dialogues.map((d) => (
                      <Box component="li" key={d.id} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body1" sx={{ fontWeight: 600 }}>
                            <Box component="span" sx={{ color: "text.secondary", mr: 1 }}>{d.speaker}:</Box>
                            <span lang="en">{d.line_en}</span>
                          </Typography>
                          <Typography variant="body2" color="text.secondary">{d.line_ja}</Typography>
                        </Box>
                        {renderSpeakButton(d.line_en, speakingDialogueId === d.id, () => speakDialogue(d))}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {finished ? (
        // 完了後の案内（次の学習先・シーン・学習履歴へ）
        <Paper component="section" aria-labelledby="lesson-complete-title" elevation={0} sx={{ mt: 3, p: { xs: 2.5, sm: 3 }, bgcolor: "primary.main", color: "primary.contrastText" }}>
          <Typography id="lesson-complete-title" ref={completionHeadingRef} tabIndex={-1} variant="h6" component="h2" sx={{ outline: "none", display: "flex", alignItems: "center", gap: 1 }}>
            <CheckIcon aria-hidden="true" />
            レッスンを完了しました
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: "#dbeafe" }}>
            {saving ? "学習履歴に保存しています..." : "お疲れさまでした。続けて学習を進めましょう。"}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
            {nextTarget && (
              <Button
                component={RouterLink}
                to={nextTarget.path}
                variant="contained"
                endIcon={<ArrowForwardIcon />}
                aria-label={`${nextTarget.kind === "lesson" ? "次のレッスンへ" : "次のシーンへ"}: ${nextTarget.title}`}
                sx={{ minHeight: 44, bgcolor: "common.white", color: "primary.main", "&:hover": { bgcolor: "#e5edf7" } }}
              >
                {nextTarget.kind === "lesson" ? "次のレッスンへ" : "次のシーンへ"}
              </Button>
            )}
            <Button component={RouterLink} to={backPath} variant="outlined" color="inherit" startIcon={<ArrowBackIcon />} sx={{ minHeight: 44, borderColor: "rgba(255,255,255,0.5)" }}>
              シーンに戻る
            </Button>
            <Button component={RouterLink} to="/progress" variant="outlined" color="inherit" startIcon={<TrendingUpIcon />} sx={{ minHeight: 44, borderColor: "rgba(255,255,255,0.5)" }}>
              学習履歴を見る
            </Button>
          </Stack>
        </Paper>
      ) : (
        // ナビゲーション
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
          <Button disabled={currentStep === 0} onClick={handleBack} sx={{ minHeight: 44 }}>前へ</Button>
          <Box>
            {currentStep === lastStep ? (
              <Button variant="contained" onClick={handleComplete} startIcon={<CheckIcon />} sx={{ minHeight: 44 }}>
                レッスン完了
              </Button>
            ) : (
              <Button variant="contained" onClick={handleNext} sx={{ minHeight: 44 }}>次へ</Button>
            )}
          </Box>
        </Box>
      )}

      {/* 読み上げの状態を支援技術に伝える */}
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {speakingId !== null || speakingDialogueId !== null ? "読み上げ中" : ""}
      </Box>

      <Snackbar open={!!notice} autoHideDuration={notice?.severity === 'warning' ? NOTICE_DURATION_WARNING_MS : NOTICE_DURATION_MS} onClose={() => setNotice(null)}>
        <Alert severity={notice?.severity ?? 'success'} variant="filled" sx={{ width: '100%' }}>
          {notice?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default LessonDetail; 