import React, { Suspense, lazy, useState } from "react";
import { Fab } from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";

// チャットの画面は最初に開いたときに読み込む（初回表示で読み込むコードを減らす）
const ChatDialog = lazy(() => import("./ChatDialog"));

// 右下のチャットボタン
const ChatWidget: React.FC = () => {
  const [open, setOpen] = useState(false);
  // 一度開いた後は、閉じてもメッセージを保持するため画面を残しておく
  const [mounted, setMounted] = useState(false);

  const handleOpen = () => {
    setMounted(true);
    setOpen(true);
  };

  return (
    <>
      <Fab
        color="primary"
        aria-label="AI チャットを開く"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "chat-dialog" : undefined}
        onClick={handleOpen}
        // スマートフォンでは小さめにして画面の端に寄せ、本文に重なりにくくする
        sx={{
          position: "fixed",
          right: { xs: 16, sm: 24 },
          bottom: { xs: 16, sm: 24 },
          width: { xs: 48, sm: 56 },
          height: { xs: 48, sm: 56 },
          minHeight: 0,
          zIndex: 1300,
        }}
      >
        <ChatIcon />
      </Fab>
      {mounted && (
        <Suspense fallback={null}>
          <ChatDialog open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
};

export default ChatWidget;
