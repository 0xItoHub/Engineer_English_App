import { vi, type Mocked } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthContext, type AuthContextProps } from 'react-oidc-context';
import axios from 'axios';
import LessonDetail from './LessonDetail';
import ProgressHistory from './ProgressHistory';
import { pushLocalProgress, readLocalProgress } from './lib/storage';
import { renderWithClient } from './test/renderWithClient';

// ログイン機能を有効にした状態でテストする（ダミーの値）
vi.hoisted(() => {
  vi.stubEnv('VITE_COGNITO_AUTHORITY', 'https://issuer.example.test/pool');
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'test-client');
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://login.example.test');
});

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

const signedIn = {
  user: { access_token: 'token', expired: false, profile: { sub: 'user-a', email: 'a@example.test' } },
  isLoading: false,
  isAuthenticated: true,
} as unknown as AuthContextProps;

function mockLessonApi() {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/lessons/5/')) return Promise.resolve({ data: { id: 5, title: 'Daily report', description: '', scene: 1 } });
    if (url.endsWith('/api/scenes/1/')) return Promise.resolve({ data: { id: 1, title: 'Daily Standup' } });
    if (url.endsWith('/api/progress/my_progress/')) return Promise.resolve({ data: [] });
    return Promise.reject(new Error('unexpected'));
  });
}

async function completeLesson(expectedMessage = 'レッスンを完了しました！') {
  renderWithClient(
    <AuthContext.Provider value={signedIn}>
      <MemoryRouter initialEntries={['/lesson/5']}>
        <Routes>
          <Route path="/lesson/:lessonId" element={<LessonDetail />} />
          <Route path="/progress" element={<div>progress page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
  fireEvent.click(await screen.findByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  fireEvent.click(screen.getByRole('button', { name: 'レッスン完了' }));
  expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
}

afterEach(() => {
  vi.resetAllMocks();
});

test('ログイン中はアカウントに保存できたらブラウザの進捗を削除し、完了後の案内から学習履歴へ進める', async () => {
  mockLessonApi();
  mockedAxios.post.mockResolvedValue({ data: { id: 1, lesson: 5, score: 100, time_spent: 0 } });

  await completeLesson();

  expect(readLocalProgress()).toEqual([]);
  fireEvent.click(screen.getByRole('link', { name: '学習履歴を見る' }));
  expect(screen.getByText('progress page')).toBeInTheDocument();
});

test('ログイン中でもアカウントに保存できなかった場合は本人の記録としてブラウザに残し、再送を案内する', async () => {
  mockLessonApi();
  mockedAxios.post.mockRejectedValue({ isAxiosError: true, response: { status: 500 } });

  await completeLesson('サーバーへの保存に失敗しました。次回ログイン時に再送します。');

  expect(screen.queryByText('レッスンを完了しました！')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(readLocalProgress()).toEqual([
      expect.objectContaining({ lesson: 5, score: 100, owner: 'user-a', completed_at: expect.any(String) }),
    ])
  );
});

test('ログイン中は、アカウントの進捗に本人の保存待ちの進捗を合わせて表示し、他のユーザーと未ログインの記録は表示しない', async () => {
  const lessons = [
    { id: 5, title: 'Daily report' },
    { id: 6, title: 'Blockers' },
    { id: 7, title: 'Retro' },
    { id: 8, title: 'Demo' },
  ];
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/scenes/')) return Promise.resolve({ data: [{ id: 1, title: 'Daily Standup', lessons }] });
    if (url.endsWith('/api/progress/my_progress/')) {
      return Promise.resolve({
        data: [{ id: 1, lesson: 5, lesson_title: 'Daily report', scene_title: 'Daily Standup', completed_at: '2026-01-01T00:00:00Z', score: 100, time_spent: 10 }],
      });
    }
    return Promise.reject(new Error('unexpected'));
  });
  pushLocalProgress({ lesson: 6, score: 100, time_spent: 5, owner: 'user-a' });
  pushLocalProgress({ lesson: 7, score: 100, time_spent: 5, owner: 'user-b' });
  pushLocalProgress({ lesson: 8, score: 100, time_spent: 5 });

  renderWithClient(
    <AuthContext.Provider value={signedIn}>
      <MemoryRouter initialEntries={['/progress']}>
        <Routes>
          <Route path="/progress" element={<ProgressHistory />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

  const table = await screen.findByRole('table', { name: '学習履歴一覧' });
  expect(within(table).getByText('Daily report')).toBeInTheDocument();
  expect(within(table).getByText('Blockers')).toBeInTheDocument();
  expect(within(table).queryByText('Retro')).not.toBeInTheDocument();
  expect(within(table).queryByText('Demo')).not.toBeInTheDocument();
});
