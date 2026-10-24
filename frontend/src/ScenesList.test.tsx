import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import ScenesList from './ScenesList';
import { LOCAL_PROGRESS_KEY } from './lib/storage';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const scenes = [
  { id: 1, title: 'Daily Standup', phrases: [{}, {}], dialogues: [{}], lessons: [{ id: 10, title: 'L1' }, { id: 11, title: 'L2' }] },
  { id: 2, title: 'Code Review', phrases: [], dialogues: [], lessons: [] },
];

function renderScenesList() {
  return render(
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
  jest.resetAllMocks();
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
});
