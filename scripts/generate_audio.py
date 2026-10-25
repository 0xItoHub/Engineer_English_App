"""seed の英文から読み上げ用の音声（MP3）を事前に生成する開発用スクリプト。

- core/management/commands/seed_six_scenes.py の SCENE_DATA から、フレーズ（text_en）と
  対話（line_en）の英文を読み取る（Django は読み込まず、ast で解析する）
- Kokoro-82M（kokoro-onnx）で音声を合成し、frontend/public/audio/<key>.mp3 に保存する
  key は「エンジン・声・速度・正規化した英文」の SHA-256 の先頭 16 文字
  （内容が変わるとファイル名も変わるため、長期間キャッシュできる）
- 英文と音声ファイルの対応表を frontend/src/data/audioManifest.json に書き出す

使い方は DEVELOPMENT.md の「読み上げ音声の生成」を参照。

    python scripts/generate_audio.py \\
        --model path/to/kokoro-v1.0.onnx --voices path/to/voices-v1.0.bin \\
        --espeak-lib path/to/libespeak-ng.dylib --espeak-data path/to/espeak-ng-data
"""

import argparse
import ast
import hashlib
import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_FILE = REPO_ROOT / "core" / "management" / "commands" / "seed_six_scenes.py"
AUDIO_DIR = REPO_ROOT / "frontend" / "public" / "audio"
MANIFEST_FILE = REPO_ROOT / "frontend" / "src" / "data" / "audioManifest.json"
# ブラウザから参照するときのパス（frontend/public は配信のルートになる）
AUDIO_URL_PREFIX = "/audio/"

ENGINE = "kokoro-82m"
DEFAULT_VOICE = "af_heart"
DEFAULT_LANG = "en-us"
DEFAULT_SPEED = 1.0

# 前後の無音は少しだけ残す（再生直後・終了間際に音が切れて聞こえないようにする）
SILENCE_THRESHOLD = 0.01
KEEP_SILENCE_SEC = 0.08
# 音割れを防ぐため、ピークをこの値に揃える
PEAK_LEVEL = 0.89
# MP3 の圧縮率（0: 高音質〜1: 高圧縮）
# 読み上げ音声として十分な音質で、1 文あたり 10〜20 KB 程度になる
MP3_COMPRESSION_LEVEL = 0.7


def normalize_text(text: str) -> str:
    """前後の空白を除き、連続する空白を 1 つにまとめる（フロントエンドの正規化と同じ）。"""
    return re.sub(r"\s+", " ", text.strip())


def clip_key(text: str, voice: str, speed: float) -> str:
    """音声ファイル名に使うキー（合成の条件と英文が同じなら同じキーになる）。"""
    source = f"{ENGINE}|{voice}|{speed}|{normalize_text(text)}"
    return hashlib.sha256(source.encode("utf-8")).hexdigest()[:16]


def load_seed_texts(seed_file: Path = SEED_FILE) -> list[str]:
    """SCENE_DATA のフレーズ・対話の英文を、重複を除いて読み取る。"""
    tree = ast.parse(seed_file.read_text(encoding="utf-8"), filename=str(seed_file))
    scene_data = None
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "SCENE_DATA" for t in node.targets
        ):
            scene_data = ast.literal_eval(node.value)
            break
    if not isinstance(scene_data, dict):
        raise SystemExit(f"SCENE_DATA が見つかりません: {seed_file}")

    texts: list[str] = []
    for scene in scene_data.values():
        # フレーズは (英文, 日本語訳)、対話は (話者, 英文, 日本語訳, 順番)
        texts.extend(en for en, _ja in scene.get("phrases", []))
        texts.extend(en for _spk, en, _ja, _order in scene.get("dialogues", []))
    unique = {normalize_text(t) for t in texts if normalize_text(t)}
    return sorted(unique)


def postprocess(samples, sample_rate: int):
    """前後の無音を整え、ピークを揃える。"""
    import numpy as np

    samples = np.asarray(samples, dtype=np.float32)
    voiced = np.flatnonzero(np.abs(samples) > SILENCE_THRESHOLD)
    if voiced.size > 0:
        keep = int(sample_rate * KEEP_SILENCE_SEC)
        start = max(0, int(voiced[0]) - keep)
        end = min(samples.size, int(voiced[-1]) + keep + 1)
        samples = samples[start:end]
    peak = float(np.max(np.abs(samples))) if samples.size > 0 else 0.0
    if peak > 0:
        samples = samples * (PEAK_LEVEL / peak)
    return samples.astype(np.float32)


def write_manifest(clips: dict[str, str], voice: str) -> None:
    MANIFEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "voice": voice,
        "engine": ENGINE,
        "clips": dict(sorted(clips.items())),
    }
    MANIFEST_FILE.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "seed の英文から読み上げ用の MP3 を生成し、frontend/public/audio/ と "
            "frontend/src/data/audioManifest.json を更新します（既存のファイルは再利用）。"
        ),
        epilog=(
            "モデルファイルは kokoro-onnx のリリース（model-files-v1.0）から取得してください。"
            "各パスは環境変数でも指定できます。"
        ),
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("KOKORO_MODEL"),
        help="kokoro-v1.0.onnx のパス（環境変数 KOKORO_MODEL）",
    )
    parser.add_argument(
        "--voices",
        default=os.environ.get("KOKORO_VOICES"),
        help="voices-v1.0.bin のパス（環境変数 KOKORO_VOICES）",
    )
    parser.add_argument(
        "--espeak-lib",
        default=os.environ.get("ESPEAK_LIB"),
        help="espeak-ng の共有ライブラリのパス（環境変数 ESPEAK_LIB。省略時は既定の場所）",
    )
    parser.add_argument(
        "--espeak-data",
        default=os.environ.get("ESPEAK_DATA"),
        help="espeak-ng-data のパス（環境変数 ESPEAK_DATA。省略時は既定の場所）",
    )
    parser.add_argument("--voice", default=DEFAULT_VOICE, help=f"声（既定: {DEFAULT_VOICE}）")
    parser.add_argument("--lang", default=DEFAULT_LANG, help=f"言語（既定: {DEFAULT_LANG}）")
    parser.add_argument(
        "--speed", type=float, default=DEFAULT_SPEED, help=f"話す速さ（既定: {DEFAULT_SPEED}）"
    )
    parser.add_argument("--force", action="store_true", help="既存の音声ファイルも生成し直す")
    parser.add_argument(
        "--prune",
        action="store_true",
        help="対応表に含まれなくなった音声ファイルを frontend/public/audio/ から削除する",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="音声を生成せず、対象の英文とファイル名だけを表示する",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    texts = load_seed_texts()
    keys = {text: clip_key(text, args.voice, args.speed) for text in texts}

    if args.list:
        for text, key in keys.items():
            print(f"{key}.mp3  {text}")
        print(f"{len(keys)} texts")
        return 0

    missing = [t for t, k in keys.items() if args.force or not (AUDIO_DIR / f"{k}.mp3").exists()]
    if missing:
        if not args.model or not args.voices:
            print(
                "音声を生成するには --model と --voices（または KOKORO_MODEL / KOKORO_VOICES）"
                "を指定してください。",
                file=sys.stderr,
            )
            return 2
        import soundfile as sf
        from kokoro_onnx import EspeakConfig, Kokoro

        espeak_config = None
        if args.espeak_lib or args.espeak_data:
            espeak_config = EspeakConfig(lib_path=args.espeak_lib, data_path=args.espeak_data)
        kokoro = Kokoro(args.model, args.voices, espeak_config=espeak_config)

        AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        for i, text in enumerate(missing, start=1):
            samples, sample_rate = kokoro.create(
                text, voice=args.voice, speed=args.speed, lang=args.lang
            )
            path = AUDIO_DIR / f"{keys[text]}.mp3"
            sf.write(
                path,
                postprocess(samples, sample_rate),
                sample_rate,
                format="MP3",
                subtype="MPEG_LAYER_III",
                compression_level=MP3_COMPRESSION_LEVEL,
                bitrate_mode="VARIABLE",
            )
            print(f"[{i}/{len(missing)}] {path.name}  {text}")

    clips = {text: f"{AUDIO_URL_PREFIX}{key}.mp3" for text, key in keys.items()}
    write_manifest(clips, args.voice)

    if args.prune and AUDIO_DIR.exists():
        referenced = {f"{key}.mp3" for key in keys.values()}
        for path in sorted(AUDIO_DIR.glob("*.mp3")):
            if path.name not in referenced:
                path.unlink()
                print(f"removed {path.name}")

    total = sum((AUDIO_DIR / f"{k}.mp3").stat().st_size for k in keys.values())
    print(
        f"{len(clips)} clips ({len(missing)} generated), total {total / 1024:.1f} KB "
        f"-> {MANIFEST_FILE.relative_to(REPO_ROOT)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
