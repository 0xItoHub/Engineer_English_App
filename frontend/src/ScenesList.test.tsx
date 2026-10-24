import { vi, type Mocked } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import axios from 'axios';
import ScenesList from './ScenesList';
import { LOCAL_PROGRESS_KEY } from './lib/storage';
import { renderWithClient } from './test/renderWithClient';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

const scenes = [
  { id: 1, title: 'Daily Standup', phrases: [{}, {}], dialogues: [{}], lessons: [{ id: 10, title: 'L1' }, { id: 11, title: 'L2' }] },
  { id: 2, title: 'Code Review', phrases: [], dialogues: [], lessons: [] },
];

function renderScenesList() {
  return renderWithClient(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<ScenesList />} />
        <Route path="/scene/:id" element={<div>scene page</div>} />
        <Route path="/progress" element={<div>progress page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

test('シーン一覧と進捗（サーバ＋ローカル）を表示する', async () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/scenes/')) return Promise.resolve({ data: scenes });
    if (url.endsWith('/api/progress/my_progress/')) return Promise.resolve({ data: [{ lesson: 10, score: 100, time_spent: 30 }] });
    return Promise.reject(new Error('unexpected'));
  });
  window.localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify([{ lesson: 11, score: 50, time_spent: 10 }]));

  renderScenesList();

  expect(await screen.findByText('Daily Standup')).toBeInTheDocument();
  expect(screen.getByText('Code Review')).toBeInTheDocument();
  expect(screen.getByText('100% (2/2)')).toBeInTheDocument();
  expect(screen.getByText('2 フレーズ')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Daily Standup の進捗' })).toHaveAttribute('aria-valuenow', '100');
});

test('シーン一覧から集計した教材の数（シーン・レッスン・フレーズ・対話）を表示する', async () => {
  mockedAxios.get.mockImplementation((url: string) =>
    url.endsWith('/api/scenes/') ? Promise.resolve({ data: scenes }) : Promise.reject(new Error('403'))
  );

  renderScenesList();

  const section = await screen.findByRole('region', { name: '収録コンテンツ' });
  expect(within(section).getAllByRole('listitem')).toHaveLength(4);
  expect(within(screen.getByTestId('stat-scenes')).getByText('2')).toBeInTheDocument();
  expect(within(screen.getByTestId('stat-scenes')).getByText('シーン')).toBeInTheDocument();
  expect(within(screen.getByTestId('stat-lessons')).getByText('2')).toBeInTheDocument();
  expect(within(screen.getByTestId('stat-phrases')).getByText('2')).toBeInTheDocument();
  expect(within(screen.getByTestId('stat-dialogues')).getByText('1')).toBeInTheDocument();
});

test('概要・技術スタックを表示し、「学習をはじめる」でシーン一覧へ移動する', async () => {
  mockedAxios.get.mockImplementation((url: string) =>
    url.endsWith('/api/scenes/') ? Promise.resolve({ data: scenes }) : Promise.reject(new Error('403'))
  );
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;

  renderScenesList();

  expect(await screen.findByRole('heading', { level: 2, name: 'エンジニアのための、実務に効く英語学習' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: '技術スタック' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('link', { name: '学習をはじめる' }));
  expect(scrollIntoView).toHaveBeenCalled();
  expect(document.getElementById('scene-list')).toHaveFocus();
});

test('「学習開始」でシーン詳細へ遷移する', async () => {
  mockedAxios.get.mockImplementation((url: string) =>
    url.endsWith('/api/scenes/') ? Promise.resolve({ data: scenes }) : Promise.reject(new Error('403'))
  );

  renderScenesList();

  fireEvent.click(await screen.findByRole('button', { name: 'Daily Standup の学習を開始' }));
  expect(screen.getByText('scene page')).toBeInTheDocument();
});

test('API に接続できない場合も空の状態を表示する（ローカル進捗が壊れていても落ちない）', async () => {
  mockedAxios.get.mockRejectedValue(new Error('Network Error'));
  window.localStorage.setItem(LOCAL_PROGRESS_KEY, '{not json');

  renderScenesList();

  expect(await screen.findByText('まだシーンが登録されていません')).toBeInTheDocument();
  // 集計できるデータが無いときは教材の数を表示しない
  expect(screen.queryByRole('region', { name: '収録コンテンツ' })).not.toBeInTheDocument();
});
