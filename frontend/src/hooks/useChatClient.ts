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

// ダミークライアント（UI確認用）
export function createDummyClient(): ChatClient {
  return {
    async send(messages) {
      const last = messages[messages.length - 1];
      const reply = last?.content || '';
      // それっぽいレスポンスを返す
      const content = `You said: "${reply}"\n\n(この返信はダミーです。後でAPIに置き換え予定)`;
      await new Promise((r) => setTimeout(r, 500));
      return {
        id: Math.random().toString(36).slice(2),
        role: 'assistant',
        content,
      };
    },
  };
}
