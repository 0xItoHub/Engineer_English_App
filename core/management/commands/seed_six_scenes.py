from django.core.management.base import BaseCommand
from django.db import transaction
from core.models import Scene, Lesson, Phrase, Dialogue

SCENES = [
    "要件定義",
    "基本設計",
    "詳細設計",
    "実装・コーディング",
    "テスト",
    "運用・保守",
]

# 以前のジェネリックseedで使った対話（クリーンアップ用）
OLD_GENERIC_DIALOGUE_EN = {
    "What is the main objective here?",
    "We should define the scope clearly.",
    "Do we have acceptance criteria?",
    "Let's write user stories first.",
    "Great, we can proceed.",
}

SCENE_DATA = {
    "要件定義": {
        "lessons": [
            "目的とスコープ",
            "ステークホルダー整理",
            "ユーザーストーリー",
            "受入基準(AC)",
            "スケジュール",
        ],
        "phrases": [
            (
                "Let's align on the goal and scope.",
                "目的とスコープについて認識を合わせましょう。",
            ),
            (
                "Who are the stakeholders and their expectations?",
                "ステークホルダーとその期待値は何ですか？",
            ),
            (
                "Let's write user stories first.",
                "まずユーザーストーリーを書きましょう。",
            ),
            ("What are the acceptance criteria?", "受入基準は何ですか？"),
            (
                "Do we have any timeline constraints?",
                "スケジュール上の制約はありますか？",
            ),
        ],
        "dialogues": [
            (
                "PM",
                "What's the primary business goal?",
                "主となるビジネスゴールは何ですか？",
                1,
            ),
            (
                "PO",
                "We need to clarify scope boundaries.",
                "スコープの境界を明確にする必要があります。",
                2,
            ),
            (
                "Dev",
                "Let's capture user stories and edge cases.",
                "ユーザーストーリーと例外ケースを整理しましょう。",
                3,
            ),
            (
                "QA",
                "Please define clear acceptance criteria.",
                "明確な受入基準を定義してください。",
                4,
            ),
            (
                "PM",
                "We'll organize a timeline and milestones.",
                "タイムラインとマイルストーンを整理します。",
                5,
            ),
        ],
    },
    "基本設計": {
        "lessons": [
            "アーキテクチャ",
            "データ設計",
            "インターフェース",
            "非機能要件",
            "トレードオフ",
        ],
        "phrases": [
            (
                "Let's choose an architecture that fits our domain.",
                "ドメインに合ったアーキテクチャを選びましょう。",
            ),
            (
                "We need a normalized database schema.",
                "正規化されたデータベーススキーマが必要です。",
            ),
            (
                "Define clear interfaces between modules.",
                "モジュール間の明確なインターフェースを定義しましょう。",
            ),
            (
                "Consider non-functional requirements such as performance.",
                "性能などの非機能要件を考慮しましょう。",
            ),
            (
                "Let's document trade-offs and rationale.",
                "トレードオフとその理由をドキュメント化しましょう。",
            ),
        ],
        "dialogues": [
            (
                "TechLead",
                "Monolith or microservices?",
                "モノリスかマイクロサービスか？",
                1,
            ),
            (
                "Dev",
                "A modular monolith might be enough.",
                "モジュラー・モノリスで十分かもしれません。",
                2,
            ),
            (
                "DBA",
                "How do we model relationships?",
                "リレーションはどうモデリングしますか？",
                3,
            ),
            ("Dev", "We'll define APIs with OpenAPI.", "OpenAPIでAPIを定義します。", 4),
            (
                "TechLead",
                "Let's capture non-functional KPIs.",
                "非機能のKPIを定義しましょう。",
                5,
            ),
        ],
    },
    "詳細設計": {
        "lessons": [
            "API仕様",
            "シーケンス図",
            "エラーハンドリング",
            "バリデーション",
            "境界条件",
        ],
        "phrases": [
            (
                "Let's finalize the API specs and example payloads.",
                "API仕様と例のペイロードを確定しましょう。",
            ),
            (
                "Draw sequence diagrams for critical flows.",
                "重要フローのシーケンス図を作成しましょう。",
            ),
            (
                "Define error codes and messages.",
                "エラーコードとメッセージを定義しましょう。",
            ),
            ("Validate inputs strictly.", "入力値を厳密にバリデーションしましょう。"),
            (
                "List edge cases and fallback behavior.",
                "境界条件とフォールバックの挙動を洗い出しましょう。",
            ),
        ],
        "dialogues": [
            (
                "Dev",
                "What status code should we return?",
                "どのステータスコードを返しますか？",
                1,
            ),
            ("QA", "How do we handle timeouts?", "タイムアウトはどう扱いますか？", 2),
            (
                "Dev",
                "We'll sanitize inputs on the server.",
                "サーバー側で入力をサニタイズします。",
                3,
            ),
            (
                "Dev",
                "Add idempotency keys for retries.",
                "再試行のために冪等性キーを追加しましょう。",
                4,
            ),
            (
                "QA",
                "Let's define error messages for users.",
                "ユーザー向けのエラーメッセージを定義しましょう。",
                5,
            ),
        ],
    },
    "実装・コーディング": {
        "lessons": [
            "ブランチ戦略",
            "レビュー",
            "ユニットテスト",
            "命名と可読性",
            "リファクタリング",
        ],
        "phrases": [
            (
                "Let's follow the trunk-based branching.",
                "トランクベースのブランチ戦略に従いましょう。",
            ),
            (
                "Open a PR with clear description.",
                "分かりやすい説明付きでPRを作成してください。",
            ),
            ("Write unit tests first.", "先にユニットテストを書きましょう。"),
            (
                "Use meaningful names and keep functions small.",
                "意味のある命名と小さな関数を心がけましょう。",
            ),
            ("Refactor code regularly.", "定期的にリファクタリングしましょう。"),
        ],
        "dialogues": [
            ("Dev", "I'll open a PR today.", "今日中にPRを出します。", 1),
            (
                "Reviewer",
                "Please add test cases.",
                "テストケースの追加をお願いします。",
                2,
            ),
            (
                "Dev",
                "Let's pair program on the tricky part.",
                "難所はペアプロしましょう。",
                3,
            ),
            (
                "Reviewer",
                "Can we split this function?",
                "この関数を分割できますか？",
                4,
            ),
            ("Dev", "I'll refactor after merging.", "マージ後にリファクタします。", 5),
        ],
    },
    "テスト": {
        "lessons": ["テスト設計", "テスト実行", "自動化", "不具合管理", "回帰対策"],
        "phrases": [
            (
                "Let's design test cases based on risks.",
                "リスクベースでテストケースを設計しましょう。",
            ),
            (
                "Reproduce the issue with clear steps.",
                "再現手順を明確にして不具合を再現しましょう。",
            ),
            ("Automate repetitive tests.", "繰り返しテストは自動化しましょう。"),
            ("Track defects with priorities.", "優先度付きで不具合を管理しましょう。"),
            (
                "Prevent regressions with smoke tests.",
                "スモークテストで回帰を防ぎましょう。",
            ),
        ],
        "dialogues": [
            ("QA", "What's the expected behavior?", "期待される動作は何ですか？", 1),
            ("Dev", "I'll provide logs and steps.", "ログと手順を共有します。", 2),
            (
                "QA",
                "Can we automate this scenario?",
                "このシナリオは自動化できますか？",
                3,
            ),
            ("Dev", "Let's add regression tests.", "回帰テストを追加しましょう。", 4),
            (
                "PM",
                "Please prioritize critical bugs.",
                "致命的な不具合を優先してください。",
                5,
            ),
        ],
    },
    "運用・保守": {
        "lessons": [
            "監視・通知",
            "インシデント対応",
            "リリース/ロールバック",
            "SLA/SLO",
            "改善サイクル",
        ],
        "phrases": [
            ("Set up monitoring and alerts.", "監視とアラートを設定しましょう。"),
            (
                "Define the incident response process.",
                "インシデント対応プロセスを定義しましょう。",
            ),
            ("Prepare rollback plans.", "ロールバック計画を準備しましょう。"),
            (
                "Track SLA/SLO and error budgets.",
                "SLA/SLOとエラーバジェットを追跡しましょう。",
            ),
            ("Run a postmortem and improve.", "ポストモーテムを実施し改善しましょう。"),
        ],
        "dialogues": [
            ("SRE", "Is the alert actionable?", "そのアラートは対応可能ですか？", 1),
            (
                "Dev",
                "We need better dashboards.",
                "ダッシュボードを改善する必要があります。",
                2,
            ),
            (
                "SRE",
                "What is the rollback procedure?",
                "ロールバック手順は何ですか？",
                3,
            ),
            ("PM", "Are we meeting our SLOs?", "SLOを満たしていますか？", 4),
            ("Dev", "Let's run a postmortem.", "ポストモーテムを実施しましょう。", 5),
        ],
    },
}


class Command(BaseCommand):
    help = "Ensure each of the six scenes has scene-specific 5 lessons, 5 phrases, 5 dialogues (phrases/dialogues attached to lessons)."

    @transaction.atomic
    def handle(self, *args, **options):
        created_counts = {"lesson": 0, "phrase": 0, "dialogue": 0}
        updated_counts = {"phrase": 0, "dialogue": 0}

        for scene_title in SCENES:
            data = SCENE_DATA[scene_title]
            scene, _ = Scene.objects.get_or_create(title=scene_title)

            # 既存seed由来データのクリーンアップ（安全に）
            Phrase.objects.filter(scene=scene, note="seed").delete()
            Dialogue.objects.filter(
                scene=scene, line_en__in=OLD_GENERIC_DIALOGUE_EN
            ).delete()

            # レッスン5件（タイトルはシーン固有）
            lessons = []
            for lt in data["lessons"]:
                lesson, created = Lesson.objects.get_or_create(
                    scene=scene,
                    title=lt,
                    defaults={"description": f"{scene_title} / {lt}"},
                )
                if created:
                    created_counts["lesson"] += 1
                lessons.append(lesson)

            # フレーズ5件（各レッスンに均等割り当て、note='seed'）
            for idx, (en, ja) in enumerate(data["phrases"]):
                lesson = lessons[idx % len(lessons)]
                obj, created = Phrase.objects.get_or_create(
                    scene=scene,
                    text_en=en,
                    defaults={"text_ja": ja, "note": "seed", "lesson": lesson},
                )
                if created:
                    created_counts["phrase"] += 1
                else:
                    changed = False
                    if obj.text_ja != ja:
                        obj.text_ja = ja
                        changed = True
                    if obj.lesson_id != lesson.id:
                        obj.lesson = lesson
                        changed = True
                    if obj.note != "seed":
                        obj.note = "seed"
                        changed = True
                    if changed:
                        obj.save()
                        updated_counts["phrase"] += 1

            # 対話5件（各レッスンに均等割り当て）
            for idx, (spk, en, ja, order) in enumerate(data["dialogues"]):
                lesson = lessons[idx % len(lessons)]
                obj, created = Dialogue.objects.get_or_create(
                    scene=scene,
                    order=order,
                    defaults={
                        "speaker": spk,
                        "line_en": en,
                        "line_ja": ja,
                        "lesson": lesson,
                    },
                )
                if created:
                    created_counts["dialogue"] += 1
                else:
                    changed = False
                    if obj.speaker != spk:
                        obj.speaker = spk
                        changed = True
                    if obj.line_en != en:
                        obj.line_en = en
                        changed = True
                    if obj.line_ja != ja:
                        obj.line_ja = ja
                        changed = True
                    if obj.lesson_id != lesson.id:
                        obj.lesson = lesson
                        changed = True
                    if changed:
                        obj.save()
                        updated_counts["dialogue"] += 1

        self.stdout.write(
            self.style.SUCCESS(
                "Scene-specific seed done: +{l} lessons, +{p} phrases, +{d} dialogues (updated {up_p} phrases, {up_d} dialogues).".format(
                    l=created_counts["lesson"],
                    p=created_counts["phrase"],
                    d=created_counts["dialogue"],
                    up_p=updated_counts["phrase"],
                    up_d=updated_counts["dialogue"],
                )
            )
        )
