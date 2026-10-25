import { isEnglishVoice, pickEnglishVoice, utteranceLang } from './tts';

const v = (name: string, lang: string) => ({ name, lang });

test('英語の音声の中から自然な合成音声を優先して選ぶ（英語以外の自然な音声は選ばない）', () => {
  const voices = [
    v('Microsoft Nanami Online (Natural) - Japanese', 'ja-JP'),
    v('Samantha', 'en-US'),
    v('Microsoft Aria Online (Natural) - English (United States)', 'en-US'),
  ];
  expect(pickEnglishVoice(voices)?.name).toBe('Microsoft Aria Online (Natural) - English (United States)');
});

test('自然な合成音声が無い場合は米国英語、英国英語、その他の英語の順に選ぶ', () => {
  expect(pickEnglishVoice([v('Kyoko', 'ja-JP'), v('Daniel', 'en-GB'), v('Alex', 'en-US')])?.name).toBe('Alex');
  expect(pickEnglishVoice([v('Karen', 'en-AU'), v('Daniel', 'en_GB')])?.name).toBe('Daniel');
  expect(pickEnglishVoice([v('Karen', 'en-AU')])?.name).toBe('Karen');
});

test('英語の音声が無い場合は選ばず、読み上げの言語は en-US にする', () => {
  expect(pickEnglishVoice([v('Kyoko', 'ja-JP'), v('Google Natural', 'ja-JP')])).toBeUndefined();
  expect(pickEnglishVoice([])).toBeUndefined();
  expect(pickEnglishVoice(undefined)).toBeUndefined();
  expect(utteranceLang(undefined)).toBe('en-US');
  expect(utteranceLang(v('Daniel', 'en-GB'))).toBe('en-GB');
});

test('lang が en で始まる音声のみ英語として扱う', () => {
  expect(isEnglishVoice(v('a', 'en'))).toBe(true);
  expect(isEnglishVoice(v('a', 'EN-us'))).toBe(true);
  expect(isEnglishVoice(v('a', 'eng'))).toBe(false);
  expect(isEnglishVoice(v('a', ''))).toBe(false);
});
