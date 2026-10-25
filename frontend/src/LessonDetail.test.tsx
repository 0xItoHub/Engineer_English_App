import { vi, type Mocked } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import axios from 'axios';
import LessonDetail from './LessonDetail';
import { LOCAL_PROGRESS_KEY } from './lib/storage';
import { renderWithClient } from './test/renderWithClient';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

const lesson = {
  id: 5,
  title: 'Daily report',
  description: '日報で使う表現',
  scene: 1,
  lesson_phrases: [{ id: 1, text_en: 'I fixed the bug.', text_ja: 'バグを修正しました。', note: '' }],
  lesson_dialogues: [{ id: 2, speaker: 'A', line_en: 'Any blockers?', line_ja: '困っていることは？', order: 1 }],
};

function mockLessonApi() {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/lessons/5/')) return Promise.resolve({ data: lesson });
    if (url.endsWith('/api/scenes/1/')) return Promise.resolve({ data: { id: 1, title: 'Daily Standup' } });
    return Promise.reject(new Error('unexpected'));
  });
}

function renderLessonDetail(path = '/lesson/5') {
  return renderWithClient(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/lesson/:lessonId" element={<LessonDetail />} />
        <Route path="/scene/:id" element={<div>scene page</div>} />
        <Route path="/progress" element={<div>progress page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

test('レッスン概要を表示し、ステップを進めてフレーズ・対話を表示する', async () => {
  mockLessonApi();
  renderLessonDetail();

  expect(await screen.findByRole('heading', { level: 1, name: /Daily report/ })).toBeInTheDocument();
  expect(screen.getByText('フレーズ: 1個')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(screen.getByText('I fixed the bug.')).toHaveAttribute('lang', 'en');

  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(screen.getByText('Any blockers?')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '前へ' }));
  expect(screen.getByText('I fixed the bug.')).toBeInTheDocument();
});

test('音声読み上げ非対応の環境では読み上げボタンを無効化する', async () => {
  mockLessonApi();
  renderLessonDetail();

  fireEvent.click(await screen.findByRole('button', { name: '次へ' }));
  expect(screen.getByRole('button', { name: 'I fixed the bug.（音声読み上げ非対応）' })).toBeDisabled();
  expect(screen.queryByText('読み上げ速度')).not.toBeInTheDocument();
});

test('音声読み上げ対応の環境では速度を選んで読み上げられる', async () => {
  const speakMock = vi.fn();
  const synth = {
    speaking: false,
    speak: speakMock,
    cancel: vi.fn(),
    getVoices: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
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
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance });

  try {
    mockLessonApi();
    renderLessonDetail();

    fireEvent.click(await screen.findByRole('button', { name: '次へ' }));
    fireEvent.click(screen.getByRole('button', { name: '1 倍速' }));
    fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' }));

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0][0]).toMatchObject({ text: 'I fixed the bug.', rate: 1 });
    expect(screen.getByRole('button', { name: 'I fixed the bug. の読み上げを停止' })).toBeInTheDocument();
  } finally {
    const w = window as unknown as Record<string, unknown>;
    delete w.speechSynthesis;
    delete w.SpeechSynthesisUtterance;
  }
});

test('英語の音声を選んで読み上げ、停止・切り替え済みの読み上げの終了通知では表示を変えない', async () => {
  const utterances: FakeUtterance[] = [];
  const englishVoice = { name: 'Microsoft Aria Online (Natural) - English', lang: 'en-US' };
  let voices: { name: string; lang: string }[] = [];
  const listeners: Record<string, () => void> = {};
  const synth = {
    speaking: false,
    speak: vi.fn((u: FakeUtterance) => utterances.push(u)),
    cancel: vi.fn(),
    getVoices: () => voices,
    addEventListener: vi.fn((type: string, fn: () => void) => { listeners[type] = fn; }),
    removeEventListener: vi.fn(),
  };
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
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance });

  try {
    mockLessonApi();
    renderLessonDetail();
    fireEvent.click(await screen.findByRole('button', { name: '次へ' }));

    // 音声の一覧は後から読み込まれる
    voices = [{ name: 'Microsoft Nanami Online (Natural) - Japanese', lang: 'ja-JP' }, englishVoice];
    act(() => listeners.voiceschanged?.());

    fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' }));
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(utterances[0]).toMatchObject({ voice: englishVoice, lang: 'en-US' });

    // 停止してから読み上げ直す
    fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. の読み上げを停止' }));
    fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' }));
    expect(synth.cancel).toHaveBeenCalledTimes(3);

    // 停止した読み上げの終了通知は無視する
    act(() => utterances[0].onend?.());
    act(() => utterances[0].onerror?.());
    expect(screen.getByRole('button', { name: 'I fixed the bug. の読み上げを停止' })).toBeInTheDocument();

    // 現在の読み上げが終わると、読み上げボタンに戻る
    act(() => utterances[1].onend?.());
    expect(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' })).toBeInTheDocument();
  } finally {
    const w = window as unknown as Record<string, unknown>;
    delete w.speechSynthesis;
    delete w.SpeechSynthesisUtterance;
  }
});

test('サーバに保存できない場合は進捗をローカルに保存する', async () => {
  mockLessonApi();
  mockedAxios.post.mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
  renderLessonDetail();

  fireEvent.click(await screen.findByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: 'レッスン完了' }));

  expect(await screen.findByText('レッスンを完了しました！')).toBeInTheDocument();
  await waitFor(() => {
    const saved = JSON.parse(window.localStorage.getItem(LOCAL_PROGRESS_KEY) || '[]');
    expect(saved).toEqual([expect.objectContaining({ lesson: 5, score: 100, owner: null, completed_at: expect.any(String) })]);
  });
  expect(mockedAxios.post).toHaveBeenCalledWith(
    expect.stringContaining('/api/progress/complete_lesson/'),
    expect.objectContaining({ lesson_id: '5', score: 100 })
  );
});

test('サーバに保存できた場合も進捗をローカルに保存する', async () => {
  mockLessonApi();
  mockedAxios.post.mockResolvedValue({ status: 200, data: { ok: true } });
  renderLessonDetail();

  fireEvent.click(await screen.findByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: 'レッスン完了' }));

  expect(await screen.findByText('レッスンを完了しました！')).toBeInTheDocument();
  const saved = JSON.parse(window.localStorage.getItem(LOCAL_PROGRESS_KEY) || '[]');
  expect(saved).toEqual([expect.objectContaining({ lesson: 5, score: 100 })]);
});

test('レッスン取得に失敗した場合は分かりやすいエラーを表示し、「再試行」で取得し直す', async () => {
  mockedAxios.get.mockRejectedValueOnce({ isAxiosError: true, message: 'Request failed', response: { status: 500 } });
  renderLessonDetail();

  expect(await screen.findByText('サーバーでエラーが発生しました。しばらくしてから再度お試しください。')).toBeInTheDocument();
  expect(screen.getByText('レッスンを取得できませんでした')).toBeInTheDocument();

  mockLessonApi();
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(await screen.findByRole('heading', { level: 1, name: /Daily report/ })).toBeInTheDocument();
});

test('レッスンが見つからない（404）場合は「ページが見つかりませんでした」を表示する', async () => {
  mockedAxios.get.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
  renderLessonDetail();

  expect(await screen.findByRole('heading', { level: 1, name: 'ページが見つかりませんでした' })).toBeInTheDocument();
});

test('形式の正しくない ID は取得せずに「ページが見つかりませんでした」を表示する', async () => {
  renderLessonDetail('/lesson/5abc');

  expect(await screen.findByRole('heading', { level: 1, name: 'ページが見つかりませんでした' })).toBeInTheDocument();
  expect(screen.queryByLabelText('読み込み中')).not.toBeInTheDocument();
  expect(mockedAxios.get).not.toHaveBeenCalled();
});

test('シーンの取得に失敗してもレッスンを表示し、レッスンの所属シーンへ戻れる', async () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/lessons/5/')) return Promise.resolve({ data: lesson });
    return Promise.reject({ isAxiosError: true, response: { status: 500 } });
  });
  renderLessonDetail();

  fireEvent.click(await screen.findByRole('button', { name: 'シーンに戻る' }));
  expect(screen.getByText('scene page')).toBeInTheDocument();
});

function progressText() {
  return screen.getByText(/^進捗: \d+%$/).textContent;
}

test('レッスン内の進捗は現在のステップの位置で表示し、戻る・進むを繰り返しても 100% を超えない', async () => {
  mockLessonApi();
  renderLessonDetail();

  await screen.findByRole('heading', { level: 1, name: /Daily report/ });
  expect(progressText()).toBe('進捗: 0%');
  const next = () => fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  const back = () => fireEvent.click(screen.getByRole('button', { name: '前へ' }));

  next();
  next();
  back();
  next();
  back();
  next();
  expect(progressText()).toBe('進捗: 67%');
  next();
  expect(progressText()).toBe('進捗: 100%');
  back();
  next();
  expect(progressText()).toBe('進捗: 100%');
  expect(screen.getByRole('progressbar', { name: 'レッスンの進捗' })).toHaveAttribute('aria-valuenow', '100');
});

test('「レッスン完了」は 1 回だけ送信し、完了後はボタンを無効にする', async () => {
  mockLessonApi();
  mockedAxios.post.mockResolvedValue({ status: 200, data: { ok: true } });
  renderLessonDetail();

  fireEvent.click(await screen.findByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  const button = screen.getByRole('button', { name: 'レッスン完了' });
  fireEvent.click(button);
  fireEvent.click(button);

  expect(await screen.findByText('レッスンを完了しました！')).toBeInTheDocument();
  expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '完了しました' })).toBeDisabled();
  expect(await screen.findByText('progress page', {}, { timeout: 3000 })).toBeInTheDocument();
});
