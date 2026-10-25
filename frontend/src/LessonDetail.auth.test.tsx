import { vi, type Mocked } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthContext, type AuthContextProps } from 'react-oidc-context';
import axios from 'axios';
import LessonDetail from './LessonDetail';
import { readLocalProgress } from './lib/storage';
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

async function completeLesson() {
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
  expect(await screen.findByText('レッスンを完了しました！')).toBeInTheDocument();
}

afterEach(() => {
  vi.resetAllMocks();
});

test('ログイン中はアカウントに保存できたらブラウザの進捗を削除し、履歴画面へ進む', async () => {
  mockLessonApi();
  mockedAxios.post.mockResolvedValue({ data: { id: 1, lesson: 5, score: 100, time_spent: 0 } });

  await completeLesson();

  expect(readLocalProgress()).toEqual([]);
  expect(await screen.findByText('progress page', {}, { timeout: 3000 })).toBeInTheDocument();
});

test('ログイン中でもアカウントに保存できなかった場合はブラウザに残す', async () => {
  mockLessonApi();
  mockedAxios.post.mockRejectedValue({ isAxiosError: true, response: { status: 500 } });

  await completeLesson();

  await waitFor(() => expect(readLocalProgress()).toEqual([expect.objectContaining({ lesson: 5, score: 100 })]));
});
