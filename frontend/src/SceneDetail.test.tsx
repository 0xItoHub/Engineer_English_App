import { vi, type Mocked } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import SceneDetail from './SceneDetail';
import { LOCAL_PROGRESS_KEY } from './lib/storage';
import { createTestQueryClient, renderWithClient } from './test/renderWithClient';
import { queryKeys } from './lib/queries';

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

test('シーンのレッスン一覧とスコアを表示する', async () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/scenes/1/')) return Promise.resolve({ data: scene });
    return Promise.reject(new Error('403'));
  });
  window.localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify([{ lesson: 10, score: 100, time_spent: 5 }]));

  renderSceneDetail();

  expect(await screen.findByRole('heading', { level: 1, name: /Daily Standup/ })).toBeInTheDocument();
  expect(screen.getByText('レッスン (2)')).toBeInTheDocument();
  expect(screen.getByText('Yesterday I worked on...')).toBeInTheDocument();
  expect(screen.getByText('完了')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Yesterday I worked on... のスコア' })).toHaveAttribute('aria-valuenow', '100');
});

test('「開始」でレッスン画面へ遷移する', async () => {
  mockedAxios.get.mockImplementation((url: string) =>
    url.endsWith('/api/scenes/1/') ? Promise.resolve({ data: scene }) : Promise.reject(new Error('403'))
  );

  renderSceneDetail();

  fireEvent.click(await screen.findByRole('button', { name: 'Blockers を開始' }));
  expect(screen.getByText('lesson page')).toBeInTheDocument();
});

test('シーンが見つからない場合は分かりやすいエラーを表示する', async () => {
  mockedAxios.get.mockRejectedValue({ isAxiosError: true, message: 'Request failed', response: { status: 404 } });

  renderSceneDetail('/scene/999');

  expect(await screen.findByText('Scene取得エラー: お探しのデータが見つかりませんでした。')).toBeInTheDocument();
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
