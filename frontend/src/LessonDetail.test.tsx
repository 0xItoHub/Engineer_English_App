import { vi, type Mocked } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import axios from 'axios';
import LessonDetail from './LessonDetail';
import { LAST_LESSON_KEY, LOCAL_PROGRESS_KEY, SPEECH_RATE_KEY } from './lib/storage';
import { renderWithClient } from './test/renderWithClient';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

const lesson = {
  id: 5,
  title: 'Daily report',
  description: '日報で使う表現',
  scene: 1,
  lesson_phrases: [{ id: 1, text_en: 'I fixed the bug.', text_ja: 'バグを修正しました。', note: '' }],
  lesson_dialogues: [{ id: 2, speaker: 'PM', line_en: 'Any blockers?', line_ja: '困っていることは？', order: 1 }],
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
  expect(screen.getByText('日報で使う表現')).toBeInTheDocument();
  // ホームの「続きから」に使うため、開いたレッスンを記憶する
  expect(JSON.parse(window.localStorage.getItem(LAST_LESSON_KEY) || 'null')).toEqual({ lesson: 5, scene: 1 });
  expect(screen.getByText('フレーズ: 1個')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(screen.getByText('I fixed the bug.')).toHaveAttribute('lang', 'en');

  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(screen.getByText('Any blockers?')).toBeInTheDocument();
  expect(screen.getByText('PM（プロダクトマネージャー）')).toBeInTheDocument();
  expect(screen.getByText('1 番目の発言')).toBeInTheDocument();
  expect(screen.queryByText(/順序/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '前へ' }));
  expect(screen.getByText('I fixed the bug.')).toBeInTheDocument();
});

test('タイトルを繰り返すだけの説明の代わりに、レッスンの進め方を案内する', async () => {
  mockedAxios.get.mockImplementation((url: string) =>
    url.endsWith('/api/lessons/5/')
      ? Promise.resolve({ data: { ...lesson, description: 'Daily Standup / Daily report' } })
      : Promise.reject(new Error('unexpected'))
  );
  renderLessonDetail();

  await screen.findByRole('heading', { level: 1, name: /Daily report/ });
  expect(screen.queryByText('Daily Standup / Daily report')).not.toBeInTheDocument();
  expect(screen.getByText('フレーズと対話を、読み上げを聞きながら順番に学びます。')).toBeInTheDocument();
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
    // 既定の速度は 1 倍
    expect(screen.getByRole('button', { name: '1 倍速' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '1.25 倍速' }));
    expect(window.localStorage.getItem(SPEECH_RATE_KEY)).toBe('1.25');
    fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. を英語で読み上げ' }));

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0][0]).toMatchObject({ text: 'I fixed the bug.', rate: 1.25 });
    expect(screen.getByRole('button', { name: 'I fixed the bug. の読み上げを停止' })).toBeInTheDocument();
    // 読み上げ中であることを支援技術に伝える
    expect(screen.getByRole('status')).toHaveTextContent('読み上げ中');
    fireEvent.click(screen.getByRole('button', { name: 'I fixed the bug. の読み上げを停止' }));
    expect(screen.getByRole('status')).toHaveTextContent('');
  } finally {
    const w = window as unknown as Record<string, unknown>;
    delete w.speechSynthesis;
    delete w.SpeechSynthesisUtterance;
  }
});

test('前回選んだ読み上げ速度を次のレッスンでも使う', async () => {
  const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [], addEventListener: vi.fn(), removeEventListener: vi.fn() };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { text: string; constructor(text: string) { this.text = text; } } });
  window.localStorage.setItem(SPEECH_RATE_KEY, '0.75');

  try {
    mockLessonApi();
    renderLessonDetail();

    fireEvent.click(await screen.findByRole('button', { name: '次へ' }));
    expect(screen.getByRole('button', { name: '0.75 倍速' })).toHaveAttribute('aria-pressed', 'true');
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

  const breadcrumbs = await screen.findByRole('navigation', { name: 'パンくずリスト' });
  fireEvent.click(within(breadcrumbs).getByRole('link', { name: 'シーン' }));
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

test('「レッスン完了」は 1 回だけ送信し、完了後は学習履歴へ自動で移動せずに次の行動を案内する', async () => {
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
  expect(screen.queryByRole('button', { name: 'レッスン完了' })).not.toBeInTheDocument();
  const panel = screen.getByRole('region', { name: 'レッスンを完了しました' });
  expect(screen.getByRole('heading', { level: 2, name: 'レッスンを完了しました' })).toHaveFocus();
  expect(within(panel).getByRole('link', { name: 'シーンに戻る' })).toHaveAttribute('href', '/scene/1');
  expect(within(panel).getByRole('link', { name: '学習履歴を見る' })).toHaveAttribute('href', '/progress');
  // シーン一覧を取得できない場合は次の学習先を表示しない
  expect(within(panel).queryByRole('link', { name: /次の/ })).not.toBeInTheDocument();

  await new Promise((r) => setTimeout(r, 1500));
  expect(screen.queryByText('progress page')).not.toBeInTheDocument();
});

const scenesWithLessons = [
  { id: 1, title: 'Daily Standup', lessons: [{ id: 5, title: 'Daily report', description: '' }, { id: 6, title: 'Blockers', description: '' }] },
  { id: 2, title: 'Code Review', lessons: [{ id: 7, title: 'LGTM', description: '' }] },
];

async function completeCurrentLesson() {
  fireEvent.click(await screen.findByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: 'レッスン完了' }));
  return screen.findByRole('region', { name: 'レッスンを完了しました' });
}

test('「次のレッスンへ」で同じシーンの次のレッスンを最初のステップから始める', async () => {
  const nextLesson = { ...lesson, id: 6, title: 'Blockers' };
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/lessons/5/')) return Promise.resolve({ data: lesson });
    if (url.endsWith('/api/lessons/6/')) return Promise.resolve({ data: nextLesson });
    if (url.endsWith('/api/scenes/')) return Promise.resolve({ data: scenesWithLessons });
    return Promise.reject(new Error('unexpected'));
  });
  mockedAxios.post.mockResolvedValue({ status: 200, data: { ok: true } });
  renderLessonDetail();

  const panel = await completeCurrentLesson();
  const next = await within(panel).findByRole('link', { name: '次のレッスンへ: Blockers' });
  // パンくずリスト（ホーム › シーン › レッスン）
  const breadcrumbs = screen.getByRole('navigation', { name: 'パンくずリスト' });
  expect(within(breadcrumbs).getByRole('link', { name: 'Daily Standup' })).toHaveAttribute('href', '/scene/1');
  expect(within(breadcrumbs).getByText('Daily report')).toHaveAttribute('aria-current', 'page');
  expect(next).toHaveAttribute('href', '/lesson/6');
  fireEvent.click(next);

  expect(await screen.findByRole('heading', { level: 1, name: /Blockers/ })).toBeInTheDocument();
  expect(progressText()).toBe('進捗: 0%');
  expect(screen.getByRole('button', { name: '次へ' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'レッスンを完了しました' })).not.toBeInTheDocument();
});

test('シーンの最後のレッスンでは「次のシーンへ」を表示し、最後のシーンでは表示しない', async () => {
  const lastInScene = { ...lesson, id: 6, title: 'Blockers' };
  const lastLesson = { ...lesson, id: 7, title: 'LGTM', scene: 2 };
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/lessons/6/')) return Promise.resolve({ data: lastInScene });
    if (url.endsWith('/api/lessons/7/')) return Promise.resolve({ data: lastLesson });
    if (url.endsWith('/api/scenes/')) return Promise.resolve({ data: scenesWithLessons });
    return Promise.reject(new Error('unexpected'));
  });
  mockedAxios.post.mockResolvedValue({ status: 200, data: { ok: true } });

  const { unmount } = renderLessonDetail('/lesson/6');
  let panel = await completeCurrentLesson();
  expect(await within(panel).findByRole('link', { name: '次のシーンへ: Code Review' })).toHaveAttribute('href', '/scene/2');
  unmount();

  renderLessonDetail('/lesson/7');
  panel = await completeCurrentLesson();
  expect(within(panel).getByRole('link', { name: 'シーンに戻る' })).toHaveAttribute('href', '/scene/2');
  expect(within(panel).queryByRole('link', { name: /次の/ })).not.toBeInTheDocument();
});

test('まとめでは完了前に学んだフレーズと対話を振り返り、完了の案内は「レッスン完了」の後に表示する', async () => {
  mockLessonApi();
  renderLessonDetail();

  fireEvent.click(await screen.findByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));

  expect(screen.queryByText(/完了です/)).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'レッスンを完了しました' })).not.toBeInTheDocument();
  const phrases = screen.getByRole('region', { name: 'フレーズ' });
  expect(within(phrases).getByText('I fixed the bug.')).toBeInTheDocument();
  expect(within(phrases).getByRole('button', { name: 'I fixed the bug.（音声読み上げ非対応）' })).toBeInTheDocument();
  const dialogues = screen.getByRole('region', { name: '対話' });
  expect(within(dialogues).getByText('Any blockers?')).toBeInTheDocument();
});

test('ステップを切り替えると、そのステップの見出しへフォーカスを移して進み具合を伝える', async () => {
  mockLessonApi();
  renderLessonDetail();

  await screen.findByRole('heading', { level: 1, name: /Daily report/ });
  // 最初の表示ではフォーカスを移さない
  expect(screen.getByRole('heading', { level: 2, name: /レッスン概要/ })).not.toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(screen.getByRole('heading', { level: 2, name: /フレーズ学習/ })).toHaveFocus();
  expect(screen.getByText('ステップ 2 / 4: フレーズ学習')).toHaveAttribute('aria-live', 'polite');
  fireEvent.click(screen.getByRole('button', { name: '前へ' }));
  expect(screen.getByRole('heading', { level: 2, name: /レッスン概要/ })).toHaveFocus();
});
