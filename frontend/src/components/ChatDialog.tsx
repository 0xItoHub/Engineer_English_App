import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Modal,
  Paper,
  Stack,
  TextField,
  Typography,
  IconButton,
  Divider,
  Tooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import { Login as LoginIcon } from "@mui/icons-material";
import { useQueryClient } from "@tanstack/react-query";
import { ChatClient, ChatMessage, createApiClient, createDummyClient, newMessageId } from "../hooks/useChatClient";
import { useAppAuth } from "../lib/auth";
import { getErrorMessage, statusOf } from "../lib/http";
import { DEFAULT_CHAT_LIMITS, queryKeys, useChatStatusQuery, type ChatLimits, type ChatStatus } from "../lib/queries";

// AI チャットが無効な場合は、入力内容をそのまま返すデモであることを最初のメッセージで伝える
export const DEMO_GREETING = "現在は入力内容をそのまま返すデモです。AI による回答は今後対応予定です。";
export const LIVE_GREETING =
  "仕事で使う英語について質問できます。例:「確認します」を丁寧に言うには？／この英文を自然にしてください。";
export const LOGIN_REQUIRED_MESSAGE = "ログインすると AI チャットを利用できます";
export const DEMO_TITLE = "AI チャット（デモ）";
export const LIVE_TITLE = "AI チャット";

// 画面の状態: 確認中 / デモ（無効）/ ログインが必要 / 利用できる
type Mode = "loading" | "demo" | "login" | "live";

type Props = {
  open: boolean;
  onClose: () => void;
};

function useChatMode(): { mode: Mode; limits: ChatLimits; remainingToday?: number } {
  const auth = useAppAuth();
  const status = useChatStatusQuery();
  if (auth.isLoading || status.isPending) return { mode: "loading", limits: DEFAULT_CHAT_LIMITS };
  // 状態を取得できない場合・無効な場合はデモとして動作する
  if (status.isError || !status.data.enabled) return { mode: "demo", limits: DEFAULT_CHAT_LIMITS };
  if (!auth.isAuthenticated) return { mode: "login", limits: status.data.limits };
  return { mode: "live", limits: status.data.limits, remainingToday: status.data.remaining_today };
}

// チャットの画面（最初に開いたときに読み込み、閉じた後もメッセージを保持する）
const ChatDialog: React.FC<Props> = ({ open, onClose: close }) => {
  const { mode, limits, remainingToday } = useChatMode();
  const title = mode === "demo" ? DEMO_TITLE : LIVE_TITLE;

  return (
    <>
      {/* Modal がフォーカストラップ・Esc で閉じる・閉じた後のフォーカス復帰を担う */}
      <Modal open={open} onClose={close}>
        <Box
          id="chat-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-dialog-title"
          sx={{
            position: "fixed",
            right: { xs: 16, sm: 24 },
            bottom: { xs: 80, sm: 96 },
            width: { xs: 'calc(100vw - 32px)', sm: 420 },
            height: '70vh',
            maxHeight: { xs: 'calc(100vh - 112px)', sm: 'calc(100vh - 128px)' },
            outline: 'none',
          }}
        >
          <Paper elevation={6} sx={{ p: 1.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography id="chat-dialog-title" variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>{title}</Typography>
              <IconButton onClick={close} aria-label="チャットを閉じる"><CloseIcon /></IconButton>
            </Stack>
            <Divider />
            {mode === "loading" && (
              <Box role="status" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                <CircularProgress size={20} aria-hidden="true" />
                <Typography variant="body2">読み込み中…</Typography>
              </Box>
            )}
            {mode === "login" && <LoginPrompt />}
            {(mode === "demo" || mode === "live") && (
              // 状態が変わった場合は会話を新しく始める（デモの応答を AI に送らない）
              <ChatConversation key={mode} mode={mode} limits={limits} remaining={remainingToday} />
            )}
          </Paper>
        </Box>
      </Modal>
    </>
  );
};

// ログインしていない場合の案内
const LoginPrompt: React.FC = () => {
  const auth = useAppAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.signIn(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    } catch {
      setBusy(false);
      setError("ログイン画面を開けませんでした。しばらくしてから再度お試しください。");
    }
  };

  return (
    <Stack spacing={2} sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 2 }}>
      <Typography variant="body1">{LOGIN_REQUIRED_MESSAGE}</Typography>
      {auth.enabled && (
        <Button variant="contained" startIcon={<LoginIcon aria-hidden="true" />} onClick={handleLogin} disabled={busy} autoFocus>
          ログイン
        </Button>
      )}
      {error && <Typography role="alert" variant="body2" color="error">{error}</Typography>}
    </Stack>
  );
};

type ConversationProps = {
  mode: "demo" | "live";
  limits: ChatLimits;
  remaining?: number;
};

const ChatConversation: React.FC<ConversationProps> = ({ mode, limits, remaining }) => {
  const isLive = mode === "live";
  const queryClient = useQueryClient();
  const auth = useAppAuth();
  const client: ChatClient = useMemo(
    () => (isLive ? createApiClient(limits.max_history) : createDummyClient()),
    [isLive, limits.max_history]
  );
  const maxChars = limits.max_input_chars;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "sys-hello", role: "assistant", content: isLive ? LIVE_GREETING : DEMO_GREETING, notice: true },
  ]);

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const text = input.trim();
  const tooLong = isLive && input.length > maxChars;
  const outOfQuota = isLive && remaining === 0;
  const canSend = !!text && !busy && !tooLong && !outOfQuota;

  const send = async () => {
    if (!canSend) return;
    const userMsg: ChatMessage = { id: newMessageId(), role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setBusy(true);
    try {
      const result = await client.send([...messages, userMsg]);
      setMessages((m) => [...m, result.message]);
      // 本日の残り回数は状態のキャッシュに反映する（画面を開き直しても同じ値を表示する）
      if (result.remainingToday !== undefined) {
        const remainingToday = result.remainingToday;
        queryClient.setQueryData<ChatStatus>(queryKeys.chatStatus(auth.sub), (old) =>
          old ? { ...old, remaining_today: remainingToday } : old
        );
      }
    } catch (e) {
      // 応答の取得に失敗した場合もチャット内で案内する（API の説明文があれば表示する）
      const content = isLive ? getErrorMessage(e) : "応答を取得できませんでした。しばらくしてから再度お試しください。";
      setMessages((m) => [...m, { id: newMessageId(), role: "assistant", content, notice: true }]);
      // 上限に達した・一時的に利用できない場合は、残り回数と利用可否を取得し直す
      const status = statusOf(e);
      if (isLive && (status === 429 || status === 503)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.chatStatusAll });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Box
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="チャットのメッセージ"
        sx={{ flex: 1, overflowY: 'auto', my: 1, px: 1 }}
      >
        <Stack spacing={1.5}>
          {messages.map((m) => {
            const isUser = m.role === 'user';
            return (
              <Box key={m.id} sx={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                <Paper
                  variant='outlined'
                  elevation={0}
                  sx={{
                    p: 1,
                    // 左（assistant）は白系、右（user）は白に近い淡い青
                    bgcolor: isUser ? '#eaf4ff' : 'background.default',
                    color: 'text.primary',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{m.content}</Typography>
                </Paper>
              </Box>
            );
          })}
          {isLive && busy && (
            <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'flex-start' }}>
              回答を作成しています…
            </Typography>
          )}
        </Stack>
      </Box>
      <Divider />
      {isLive && remaining !== undefined && (
        <Typography variant="caption" color="text.secondary" sx={{ pt: 0.5 }}>
          本日の残り: {remaining} 回
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="メッセージを入力"
          value={input}
          autoFocus
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // 日本語入力の変換確定（IME）中の Enter では送信しない
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          error={tooLong}
          helperText={isLive ? `${input.length} / ${maxChars} 文字` : undefined}
          slotProps={{
            htmlInput: { "aria-label": "メッセージを入力", ...(isLive ? { maxLength: maxChars } : {}) },
          }}
        />
        <Tooltip title="送信">
          <span>
            <IconButton size="large" color="primary" onClick={send} disabled={!canSend} aria-label="送信" sx={{ alignSelf: 'center' }}>
              <SendIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </>
  );
};

export default ChatDialog;
