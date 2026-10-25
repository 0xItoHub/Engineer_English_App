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
