import { vi, type Mocked } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import LessonDetail from './LessonDetail';
import { LOCAL_PROGRESS_KEY } from './lib/storage';

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

function renderLessonDetail() {
  return render(
    <MemoryRouter initialEntries={['/lesson/5']}>
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
    expect(saved).toEqual([expect.objectContaining({ lesson: 5, score: 100 })]);
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

test('レッスン取得に失敗した場合は分かりやすいエラーを表示する', async () => {
  mockedAxios.get.mockRejectedValue({ isAxiosError: true, message: 'Request failed', response: { status: 500 } });
  renderLessonDetail();

  expect(
    await screen.findByText('レッスン取得エラー: サーバーでエラーが発生しました。しばらくしてから再度お試しください。')
  ).toBeInTheDocument();
});
