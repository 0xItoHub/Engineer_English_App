import { vi, type Mocked } from 'vitest';
import { screen } from '@testing-library/react';
import axios from 'axios';
import App from './App';
import { renderWithClient } from './test/renderWithClient';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

beforeEach(() => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes('/api/scenes/')) {
      return Promise.resolve({ data: [{ id: 1, title: 'Daily Standup', lessons: [] }] });
    }
    return Promise.reject(new Error('not found'));
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

test('ヘッダー・メイン・フッターを表示し、トップにシーン一覧を表示する', async () => {
  renderWithClient(<App />);

  expect(screen.getByRole('link', { name: /Engineer English App ホームへ/ })).toBeInTheDocument();
  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'フッターナビゲーション' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '本文へスキップ' })).toHaveAttribute('href', '#main-content');

  expect(await screen.findByText('Daily Standup')).toBeInTheDocument();
});

test('API は資格情報（Cookie）なしで呼び出す設定になっている', () => {
  expect(axios.defaults.withCredentials).toBe(false);
});

test('Cognito の環境変数が未設定の場合はログイン機能を表示しない', async () => {
  renderWithClient(<App />);

  expect(await screen.findByText('Daily Standup')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'ログイン' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument();
});
