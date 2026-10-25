import { vi, type Mocked } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import axios from 'axios';
import LessonDetail from './LessonDetail';
import { SPEECH_RATE_KEY } from './lib/storage';
import { renderWithClient } from './test/renderWithClient';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

// 事前に生成した音声の対応表（フレーズだけに音声があり、対話は音声合成で読み上げる）
vi.mock('./data/audioManifest.json', () => ({
  default: {
    voice: 'af_heart',
    engine: 'kokoro-82m',
    clips: { 'I fixed the bug.': '/audio/0123456789abcdef.mp3' },
  },
}));

const lesson = {
  id: 5,
  title: 'Daily report',
  description: '日報で使う表現',
  scene: 1,
  lesson_phrases: [{ id: 1, text_en: 'I fixed the bug.', text_ja: 'バグを修正しました。', note: '' }],
  lesson_dialogues: [{ id: 2, speaker: 'PM', line_en: 'Any blockers?', line_ja: '困っていることは？', order: 1 }],
};

function renderLessonDetail() {
  mockedAxios.get.mockImplementation((url: string) =>
    url.endsWith('/api/lessons/5/') ? Promise.resolve({ data: lesson }) : Promise.reject(new Error('unexpected'))
  );
  return renderWithClient(
    <MemoryRouter initialEntries={['/lesson/5']}>
      <Routes>
        <Route path="/lesson/:lessonId" element={<LessonDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

// 再生された audio 要素を記録する（jsdom は音声を再生しないため play / pause を置き換える）
let played: HTMLMediaElement[] = [];
let playResult: () => Promise<void> = () => Promise.resolve();
let pauseMock: ReturnType<typeof vi.fn<() => void>>;

class FakeUtterance {
  text: string;
  rate = 1;
  lang = '';
  pitch = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function installSpeechSynthesis() {
  const synth = {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance });
  return synth;
}

beforeEach(() => {
  played = [];
  playResult = () => Promise.resolve();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    played.push(this);
    return playResult();
  });
  pauseMock = vi.fn<() => void>();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseMock);
});

afterEach(() => {
  // 画面を片付けて（再生の停止を含む）から、置き換えた play / pause を元に戻す
  cleanup();
  vi.restoreAllMocks();
  const w = window as unknown as Record<string, unknown>;
  delete w.speechSynthesis;
  delete w.SpeechSynthesisUtterance;
});

async function openPhrases() {
  fireEvent.click(await screen.findByRole('button', { name: '次へ' }));
}

test('音声ファイルがある英文は、選んだ速度で音声ファイルを再生する', async () => {
  const synth = installSpeechSynthesis();
  window.localStorage.setItem(SPEECH_RATE_KEY, '1.25');
  renderLessonDetail();
  await openPhrases();

  fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' }));

  expect(played).toHaveLength(1);
  const audio = played[0];
  expect(audio.getAttribute('src')).toBe('/audio/0123456789abcdef.mp3');
  expect(audio.playbackRate).toBe(1.25);
  expect(synth.speak).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('読み上げ中');

  // 再生中に速度を切り替えると、再生中の音声にも反映する
  fireEvent.click(screen.getByRole('button', { name: '0.75 倍速' }));
  expect(audio.playbackRate).toBe(0.75);

  // 再生が終わると読み上げボタンに戻る
  act(() => { audio.dispatchEvent(new Event('ended')); });
  expect(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('');
});

test('音声ファイルが無い英文は音声合成で読み上げる', async () => {
  const synth = installSpeechSynthesis();
  renderLessonDetail();
  await openPhrases();
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));

  fireEvent.click(screen.getByRole('button', { name: 'Any blockers? を英語で読み上げ' }));

  expect(played).toHaveLength(0);
  expect(synth.speak).toHaveBeenCalledTimes(1);
  expect(synth.speak.mock.calls[0][0]).toMatchObject({ text: 'Any blockers?' });
});

test('音声ファイルを再生できない場合は音声合成で読み上げる', async () => {
  const synth = installSpeechSynthesis();
  playResult = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  renderLessonDetail();
  await openPhrases();

  fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' }));
  await act(async () => {});

  expect(synth.speak).toHaveBeenCalledTimes(1);
  expect(synth.speak.mock.calls[0][0]).toMatchObject({ text: 'I fixed the bug.' });
  expect(screen.getByRole('button', { name: 'I fixed the bug. の読み上げを停止' })).toBeInTheDocument();
});

test('音声ファイルの読み込みに失敗した場合は音声合成で読み上げる', async () => {
  const synth = installSpeechSynthesis();
  renderLessonDetail();
  await openPhrases();

  fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' }));
  act(() => { played[0].dispatchEvent(new Event('error')); });

  expect(synth.speak).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('読み上げ中');
});

test('停止・切り替え済みの再生の通知では表示を変えず、音声合成にも切り替えない', async () => {
  const synth = installSpeechSynthesis();
  const rejects: ((e: unknown) => void)[] = [];
  playResult = () => new Promise((_resolve, reject) => { rejects.push(reject); });
  renderLessonDetail();
  await openPhrases();

  // 再生を始めてすぐに停止する
  fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' }));
  fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. の読み上げを停止' }));
  expect(pauseMock).toHaveBeenCalled();

  // 停止で中断された再生の通知（AbortError）では音声合成に切り替えない
  await act(async () => { rejects[0](new DOMException('aborted', 'AbortError')); });
  expect(synth.speak).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' })).toBeInTheDocument();

  // 読み上げ直した後に、前の再生の失敗が届いても現在の再生を続ける
  fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' }));
  fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. の読み上げを停止' }));
  fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' }));
  await act(async () => { rejects[1](new DOMException('aborted', 'AbortError')); });
  expect(synth.speak).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'I fixed the bug. の読み上げを停止' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('読み上げ中');

  // 現在の再生の失敗では音声合成で読み上げる
  await act(async () => { rejects[2](new DOMException('blocked', 'NotAllowedError')); });
  expect(synth.speak).toHaveBeenCalledTimes(1);
});

test('音声合成に対応していない環境でも、音声ファイルがある英文は読み上げられる', async () => {
  renderLessonDetail();
  await openPhrases();

  const button = screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' });
  expect(button).toBeEnabled();
  expect(screen.getByText('読み上げ速度')).toBeInTheDocument();
  fireEvent.click(button);
  expect(played).toHaveLength(1);

  // 音声ファイルが無い英文は読み上げられないため、ボタンを無効化する
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(screen.getByRole('button', { name: 'Any blockers?（音声読み上げ非対応）' })).toBeDisabled();
  expect(screen.queryByText('読み上げ速度')).not.toBeInTheDocument();
});

test('画面を離れると再生を止める', async () => {
  installSpeechSynthesis();
  const { unmount } = renderLessonDetail();
  await openPhrases();

  fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' }));
  const audio = played[0];
  pauseMock.mockClear();
  unmount();
  expect(pauseMock).toHaveBeenCalled();
  expect(audio.hasAttribute('src')).toBe(false);
});
