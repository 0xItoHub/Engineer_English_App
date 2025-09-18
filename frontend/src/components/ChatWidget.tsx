import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  Box,
  Fab,
  Modal,
  Paper,
  Stack,
  TextField,
  Typography,
  IconButton,
  Divider,
  Tooltip,
} from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import { ChatMessage, createDummyClient } from "../hooks/useChatClient";

const ChatWidget: React.FC = () => {
  const client = useMemo(() => createDummyClient(), []);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "sys-hello", role: "assistant", content: "こんにちは！英語学習をお手伝いします。なんでも聞いてください。" },
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Fab color="primary" aria-label="chat" onClick={() => setOpen(true)} sx={{ position: "fixed", right: 24, bottom: 24, zIndex: 1300 }}>
        <ChatIcon />
      </Fab>

      <Modal open={open} onClose={() => setOpen(false)}>
        <Box sx={{ position: "fixed", right: 24, bottom: 96, width: { xs: '90vw', sm: 420 }, height: { xs: '70vh', sm: '70vh' } }}>
          <Paper elevation={6} sx={{ p: 1.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>AI Chat</Typography>
              <IconButton size="small" onClick={() => setOpen(false)}><CloseIcon /></IconButton>
            </Stack>
            <Divider />
            <Box ref={listRef} sx={{ flex: 1, overflowY: 'auto', my: 1, px: 1 }}>
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
                        <Typography variant="body2" whiteSpace="pre-wrap">{m.content}</Typography>
                      </Paper>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
            <Divider />
            <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
              <TextField fullWidth size="small" placeholder="メッセージを入力" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
              <Tooltip title="送信">
                <span>
                  <IconButton color="primary" onClick={send} disabled={busy} sx={{ alignSelf: 'center' }}>
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

export default ChatWidget; 