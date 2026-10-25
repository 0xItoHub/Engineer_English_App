import { vi, type Mocked } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import axios from 'axios';
import SceneDetail from './SceneDetail';
import { LOCAL_PROGRESS_KEY } from './lib/storage';
import { createTestQueryClient, renderWithClient } from './test/renderWithClient';
import { queryKeys } from './lib/queries';
import { onlineManager } from '@tanstack/react-query';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

const scene = {
  id: 1,
  title: 'Daily Standup',
  lessons: [
    { id: 10, title: 'Yesterday I worked on...', description: '昨日やったこと' },
    { id: 11, title: 'Blockers', description: '' },
  ],
};

function renderSceneDetail(path = '/scene/1') {
  return renderWithClient(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/scene/:id" element={<SceneDetail />} />
        <Route path="/lesson/:lessonId" element={<div>lesson page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

test('シーンのレッスン一覧と、レッスンごとの完了状況を表示する', async () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/scenes/1/')) return Promise.resolve({ data: scene });
    return Promise.reject(new Error('403'));
  });
  window.localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify([{ lesson: 10, score: 100, time_spent: 5 }]));

  renderSceneDetail();

  expect(await screen.findByRole('heading', { level: 1, name: /Daily Standup/ })).toBeInTheDocument();
  expect(screen.getByText('レッスン (2)')).toBeInTheDocument();
  expect(screen.getByText('Yesterday I worked on...')).toBeInTheDocument();
  expect(document.title).toBe('Daily Standup | Engineer English App');
  // パンくずリスト（ホーム › シーン）
  const breadcrumbs = screen.getByRole('navigation', { name: 'パンくずリスト' });
  expect(within(breadcrumbs).getByRole('link', { name: 'ホーム' })).toHaveAttribute('href', '/');
  expect(within(breadcrumbs).getByText('Daily Standup')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByLabelText('Yesterday I worked on...: 完了')).toHaveTextContent('完了');
  expect(screen.getByLabelText('Blockers: 未学習')).toHaveTextContent('未学習');
  // 完了したレッスンは「復習する」、未学習のレッスンは「開始」で案内する
  expect(screen.getByRole('button', { name: 'Yesterday I worked on... を復習する' })).toHaveTextContent('復習する');
  expect(screen.getByRole('button', { name: 'Blockers を開始' })).toHaveTextContent('開始');
  // スコア（％）は表示しない
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('「開始」でレッスン画面へ遷移する', async () => {
  mockedAxios.get.mockImplementation((url: string) =>
    url.endsWith('/api/scenes/1/') ? Promise.resolve({ data: scene }) : Promise.reject(new Error('403'))
  );

  renderSceneDetail();

  fireEvent.click(await screen.findByRole('button', { name: 'Blockers を開始' }));
  expect(screen.getByText('lesson page')).toBeInTheDocument();
});

test('シーンが見つからない（404）場合は「ページが見つかりませんでした」を表示する', async () => {
  mockedAxios.get.mockRejectedValue({ isAxiosError: true, message: 'Request failed', response: { status: 404 } });

  renderSceneDetail('/scene/999');

  expect(await screen.findByRole('heading', { level: 1, name: 'ページが見つかりませんでした' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'ホームへ' })).toHaveAttribute('href', '/');
});

test.each(['/scene/abc', '/scene/0', '/scene/1.5', '/scene/-1', '/scene/1e3'])(
  '形式の正しくない ID（%s）は取得せずに「ページが見つかりませんでした」を表示する',
  async (path) => {
    mockedAxios.get.mockResolvedValue({ data: [] });

    renderSceneDetail(path);

    expect(await screen.findByRole('heading', { level: 1, name: 'ページが見つかりませんでした' })).toBeInTheDocument();
    expect(screen.queryByLabelText('読み込み中')).not.toBeInTheDocument();
    expect(mockedAxios.get).not.toHaveBeenCalledWith(expect.stringMatching(/\/api\/scenes\//), expect.anything());
  }
);

test('取得に失敗した場合はエラーを表示し、「再試行」で取得し直す', async () => {
  let fail = true;
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/progress/my_progress/')) return Promise.resolve({ data: [] });
    if (fail) return Promise.reject({ isAxiosError: true, response: { status: 503 } });
    return Promise.resolve({ data: scene });
  });

  renderSceneDetail();

  expect(await screen.findByText('一時的に利用できません。しばらくしてから再度お試しください。')).toBeInTheDocument();
  expect(screen.getByText('シーンを取得できませんでした')).toBeInTheDocument();

  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(await screen.findByRole('heading', { level: 1, name: /Daily Standup/ })).toBeInTheDocument();
});

test('学習進捗を取得できない場合も、レッスン一覧と再試行の案内を表示する', async () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/scenes/1/')) return Promise.resolve({ data: scene });
    return Promise.reject({ isAxiosError: true, response: { status: 500 } });
  });

  renderSceneDetail();

  expect(await screen.findByText('学習進捗を取得できませんでした')).toBeInTheDocument();
  expect(screen.getByText('レッスン (2)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
});

test('オフラインの場合は接続を確認する案内を表示する', async () => {
  mockedAxios.get.mockResolvedValue({ data: scene });
  onlineManager.setOnline(false);
  try {
    renderSceneDetail();
    expect(await screen.findByText('オフラインです。接続を確認してください。')).toBeInTheDocument();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  } finally {
    onlineManager.setOnline(true);
  }
});

test('取得済みのシーン一覧があれば、その内容をすぐに表示する', async () => {
  mockedAxios.get.mockImplementation((url: string) =>
    url.endsWith('/api/progress/my_progress/') ? Promise.resolve({ data: [] }) : new Promise(() => {})
  );
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.scenes, [scene]);

  renderWithClient(
    <MemoryRouter initialEntries={['/scene/1']}>
      <Routes>
        <Route path="/scene/:id" element={<SceneDetail />} />
      </Routes>
    </MemoryRouter>,
    client
  );

  // シーン詳細の応答を待たずに、一覧のキャッシュから表示できる
  expect(await screen.findByRole('heading', { level: 1, name: /Daily Standup/ })).toBeInTheDocument();
  expect(screen.getByText('レッスン (2)')).toBeInTheDocument();
});
