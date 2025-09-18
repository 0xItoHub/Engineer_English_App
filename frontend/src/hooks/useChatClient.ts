export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

export type SendOptions = {
  // 将来: streaming?: boolean;
};

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

// 将来の実装例（OpenAI/Bedrock/Ollama）
// export function createOpenAIClient({ baseUrl, apiKey, model }: { baseUrl?: string; apiKey: string; model: string }): ChatClient { /* ... */ return {} as any } 