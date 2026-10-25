import audioManifest from "../data/audioManifest.json";

// 音声読み上げ（Web Speech API）で使う英語の音声を選ぶ
// - 英語（lang が en で始まる）の音声だけを候補にする
// - その中で自然な合成音声（Natural / Neural / Online）を優先し、次に米国英語・英国英語の順に選ぶ

type VoiceLike = Pick<SpeechSynthesisVoice, "name" | "lang">;

const PREFERRED_NAME_KEYWORDS = ["natural", "neural", "online"];
const PREFERRED_LANGS = ["en-us", "en-gb"];

const normalizeLang = (lang: string | undefined) => (lang ?? "").toLowerCase().replace(/_/g, "-");

export function isEnglishVoice(voice: VoiceLike): boolean {
  const lang = normalizeLang(voice.lang);
  return lang === "en" || lang.startsWith("en-");
}

export function pickEnglishVoice<T extends VoiceLike>(voices: readonly T[] | null | undefined): T | undefined {
  const english = (voices ?? []).filter(isEnglishVoice);
  if (english.length === 0) return undefined;
  for (const keyword of PREFERRED_NAME_KEYWORDS) {
    const hit = english.find((v) => (v.name ?? "").toLowerCase().includes(keyword));
    if (hit) return hit;
  }
  for (const pref of PREFERRED_LANGS) {
    const hit = english.find((v) => normalizeLang(v.lang).startsWith(pref));
    if (hit) return hit;
  }
  return english[0];
}

// 読み上げに使う言語（音声が選べない場合も英語として読み上げる）
export function utteranceLang(voice: VoiceLike | undefined): string {
  return voice?.lang || "en-US";
}

// ---- 事前に生成した読み上げ音声（Kokoro-82M） ----
// 英文と音声ファイルの対応表は scripts/generate_audio.py で生成する（DEVELOPMENT.md を参照）
// 対応表に無い英文は、Web Speech API の音声合成で読み上げる

type AudioManifest = { voice: string; engine: string; clips: Record<string, string> };

const manifest: AudioManifest = audioManifest;

// 前後の空白を除き、連続する空白を 1 つにまとめる（生成スクリプトの正規化と同じ）
export function normalizeSpeechText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

// 英文に対応する音声ファイルの URL（無い場合は undefined）
export function getAudioClip(text: string, clips: Record<string, string> = manifest.clips): string | undefined {
  const key = normalizeSpeechText(text);
  return key && Object.hasOwn(clips, key) ? clips[key] : undefined;
}

// 音声ファイルを再生できる環境か
export function isAudioPlaybackSupported(): boolean {
  return typeof window !== "undefined" && typeof window.HTMLAudioElement !== "undefined";
}

type PitchPreservingMedia = { preservesPitch?: boolean; webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };

// 速度を変えても声の高さが変わらないようにする（古いブラウザ向けの接頭辞付きの指定にも対応）
export function preservePitch(media: HTMLMediaElement): void {
  const m: PitchPreservingMedia = media;
  if ("preservesPitch" in m) m.preservesPitch = true;
  else if ("webkitPreservesPitch" in m) m.webkitPreservesPitch = true;
  else if ("mozPreservesPitch" in m) m.mozPreservesPitch = true;
}
