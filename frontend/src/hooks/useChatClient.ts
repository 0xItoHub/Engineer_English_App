export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

// 送信オプション（将来: streaming?: boolean などを追加する）
export type SendOptions = Record<string, never>;

export interface ChatClient {
  send(messages: ChatMessage[], options?: SendOptions): Promise<ChatMessage>;
}

// デモ用のクライアント（入力内容をそのまま返す。AI による回答は今後対応予定）
export function createDummyClient(): ChatClient {
  return {
    async send(messages) {
      const last = messages[messages.length - 1];
      const reply = last?.content || '';
      const content = `You said: "${reply}"\n\n（デモ: 入力内容をそのまま返しています）`;
      await new Promise((r) => setTimeout(r, 500));
      return {
        id: Math.random().toString(36).slice(2),
        role: 'assistant',
        content,
      };
    },
  };
}
