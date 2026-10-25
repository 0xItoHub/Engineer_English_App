import { postChat, type ChatApiMessage } from '../lib/queries';

export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  // 画面内の案内（あいさつ・エラーの説明など）。AI への会話の履歴には含めない
  notice?: boolean;
};

export type ChatResult = {
  message: ChatMessage;
  // 本日の残り回数（AI チャットを利用している場合のみ）
  remainingToday?: number;
};

export interface ChatClient {
  send(messages: ChatMessage[]): Promise<ChatResult>;
}

export const newMessageId = () => Math.random().toString(36).slice(2);

type HistoryMessage = ChatMessage & { role: 'user' | 'assistant' };

const isHistoryMessage = (m: ChatMessage): m is HistoryMessage =>
  !m.notice && (m.role === 'user' || m.role === 'assistant');

// AI に送る会話の履歴（案内を除いた直近 maxHistory 件。最初は質問から始める）
export function toApiMessages(messages: ChatMessage[], maxHistory: number): ChatApiMessage[] {
  const history = messages
    .filter(isHistoryMessage)
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-Math.max(1, maxHistory));
  while (history.length > 1 && history[0].role !== 'user') history.shift();
  return history;
}

// デモ用のクライアント（入力内容をそのまま返す。AI チャットが無効な場合に使う）
export function createDummyClient(): ChatClient {
  return {
    async send(messages) {
      const last = messages[messages.length - 1];
      const reply = last?.content || '';
      const content = `You said: "${reply}"\n\n（デモ: 入力内容をそのまま返しています）`;
      await new Promise((r) => setTimeout(r, 500));
      return { message: { id: newMessageId(), role: 'assistant', content } };
    },
  };
}

// AI チャットのクライアント（自サービスの /api/chat/ のみと通信する。LLM の呼び出しはサーバー側で行う）
export function createApiClient(maxHistory: number): ChatClient {
  return {
    async send(messages) {
      const res = await postChat(toApiMessages(messages, maxHistory));
      return {
        message: { id: newMessageId(), role: 'assistant', content: res.reply },
        remainingToday: typeof res.remaining_today === 'number' ? res.remaining_today : undefined,
      };
    },
  };
}
