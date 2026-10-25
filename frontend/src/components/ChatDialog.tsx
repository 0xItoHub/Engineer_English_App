import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  Box,
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
import { ChatMessage, createDummyClient } from "../hooks/useChatClient";

// 現在は入力内容をそのまま返すデモであることを、最初のメッセージで伝える
export const DEMO_GREETING = "現在は入力内容をそのまま返すデモです。AI による回答は今後対応予定です。";

type Props = {
  open: boolean;
  onClose: () => void;
};

// チャットの画面（最初に開いたときに読み込み、閉じた後もメッセージを保持する）
const ChatDialog: React.FC<Props> = ({ open, onClose: close }) => {
  const client = useMemo(() => createDummyClient(), []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "sys-hello", role: "assistant", content: DEMO_GREETING },
  ]);

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const userMsg: ChatMessage = { id: Math.random().toString(36).slice(2), role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setBusy(true);
    try {
      const assistant = await client.send([...messages, userMsg]);
      setMessages((m) => [...m, assistant]);
    } catch (e) {
      // 応答の取得に失敗した場合もチャット内で案内する
      console.error("Chat error", e);
      setMessages((m) => [
        ...m,
        { id: Math.random().toString(36).slice(2), role: "assistant", content: "応答を取得できませんでした。しばらくしてから再度お試しください。" },
      ]);
    } finally {
      setBusy(false);
    }
  };

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
              <Typography id="chat-dialog-title" variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>AI チャット（デモ）</Typography>
              <IconButton onClick={close} aria-label="チャットを閉じる"><CloseIcon /></IconButton>
            </Stack>
            <Divider />
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
              </Stack>
            </Box>
            <Divider />
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
                slotProps={{ htmlInput: { "aria-label": "メッセージを入力" } }}
              />
              <Tooltip title="送信">
                <span>
                  <IconButton size="large" color="primary" onClick={send} disabled={busy} aria-label="送信" sx={{ alignSelf: 'center' }}>
                    <SendIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Paper>
        </Box>
      </Modal>
    </>
  );
};

export default ChatDialog; 