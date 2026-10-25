"""AI チャットのリクエストの検証。"""

from rest_framework import serializers

# 回答（assistant）として受け付ける本文の上限（画面が保持している過去の回答）
MAX_ASSISTANT_CHARS = 2000
# 1 回のリクエストで受け付ける本文の合計の上限
MAX_TOTAL_CHARS = 6000


class ChatMessageSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=["user", "assistant"])
    content = serializers.CharField(trim_whitespace=True, allow_blank=False)


class ChatRequestSerializer(serializers.Serializer):
    """POST /api/chat/ の本文（{"messages": [{"role": ..., "content": ...}, ...]}）。

    context["config"] に ChatConfig を渡す（上限の値を参照する）。
    """

    messages = ChatMessageSerializer(many=True, allow_empty=False)

    def validate_messages(self, messages):
        config = self.context["config"]
        if len(messages) > config.max_history:
            raise serializers.ValidationError(
                f"会話の履歴は直近 {config.max_history} 件までにしてください。"
            )
        if messages[-1]["role"] != "user":
            raise serializers.ValidationError("最後のメッセージは質問（user）にしてください。")
        total = 0
        for message in messages:
            length = len(message["content"])
            if message["role"] == "user" and length > config.max_input_chars:
                raise serializers.ValidationError(
                    f"メッセージは {config.max_input_chars} 文字以内で入力してください。"
                )
            if message["role"] == "assistant" and length > MAX_ASSISTANT_CHARS:
                raise serializers.ValidationError("会話が長すぎます。新しい会話を始めてください。")
            total += length
        if total > MAX_TOTAL_CHARS:
            raise serializers.ValidationError("会話が長すぎます。新しい会話を始めてください。")
        return normalize_messages(messages)


def normalize_messages(messages):
    """接続先に送る形にそろえる。

    - 先頭は user から始める（先頭の assistant は除く）
    - 同じ役割が続く場合は 1 つにまとめる（Bedrock の Converse API は交互の並びが必要）
    """
    result = []
    for message in messages:
        role, content = message["role"], message["content"]
        if not result and role != "user":
            continue
        if result and result[-1]["role"] == role:
            result[-1]["content"] = f"{result[-1]['content']}\n{content}"
            continue
        result.append({"role": role, "content": content})
    return result
