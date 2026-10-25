import type { ReactNode } from 'react';
import { vi, type Mocked } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { AuthContext, type AuthContextProps } from 'react-oidc-context';
import type { User } from 'oidc-client-ts';
import axios from 'axios';
import { QueryClientProvider } from '@tanstack/react-query';
import AuthControls from './AuthControls';
import AppAuthProvider from './AppAuthProvider';
import AuthSessionEffects from './AuthSessionEffects';
import { pageNavigation } from '../lib/auth';
import { queryKeys, useMyProgressQuery } from '../lib/queries';
import { pushLocalProgress, readLocalProgress } from '../lib/storage';
import { createTestQueryClient, renderWithClient } from '../test/renderWithClient';

// ログイン機能を有効にした状態でテストする（ダミーの値）
vi.hoisted(() => {
  vi.stubEnv('VITE_COGNITO_AUTHORITY', 'https://issuer.example.test/pool');
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'test-client');
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://login.example.test');
});

// AuthProvider は受け取った設定を記録するだけのモックに差し替える
const captured = vi.hoisted(() => ({ props: null as null | { onSigninCallback?: (user: User | undefined) => void } }));
vi.mock('react-oidc-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-oidc-context')>();
  return {
    ...actual,
    AuthProvider: (props: { children?: ReactNode; onSigninCallback?: (user: User | undefined) => void }) => {
      captured.props = props;
      return <>{props.children}</>;
    },
  };
});

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

const makeUser = (sub: string, email: string) =>
  ({ access_token: `token-${sub}`, expired: false, profile: { sub, email }, state: undefined }) as unknown as User;

function authValue(overrides: Partial<AuthContextProps> = {}): AuthContextProps {
  return {
    user: null,
    isLoading: false,
    isAuthenticated: false,
    activeNavigator: undefined,
    error: undefined,
    settings: {} as AuthContextProps['settings'],
    events: {} as AuthContextProps['events'],
    clearStaleState: vi.fn(),
    removeUser: vi.fn(async () => undefined),
    signinPopup: vi.fn(),
    signinSilent: vi.fn(),
    signinRedirect: vi.fn(async () => undefined),
    signinResourceOwnerCredentials: vi.fn(),
    signoutRedirect: vi.fn(),
    signoutPopup: vi.fn(),
    signoutSilent: vi.fn(),
    querySessionStatus: vi.fn(),
    revokeTokens: vi.fn(),
    startSilentRenew: vi.fn(),
    stopSilentRenew: vi.fn(),
    ...overrides,
  } as AuthContextProps;
}

const signedIn = (sub: string, email: string, overrides: Partial<AuthContextProps> = {}) =>
  authValue({ user: makeUser(sub, email), isAuthenticated: true, ...overrides });

function withAuth(value: AuthContextProps, ui: ReactNode, path = '/') {
  return (
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </AuthContext.Provider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

describe('AuthControls', () => {
  test('未ログイン時はログインボタンを表示し、現在の画面を戻り先として渡す', async () => {
    const value = authValue();
    renderWithClient(withAuth(value, <AuthControls />, '/scene/2?page=3'));

    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() => expect(value.signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/scene/2?page=3' } }));
  });

  test('ログイン状態の確認中は何も表示しない', () => {
    renderWithClient(withAuth(authValue({ isLoading: true }), <AuthControls />));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('ログイン中はメールアドレスとログアウトボタンを表示し、ログアウトで Cognito のログアウト画面へ移動する', async () => {
    const assign = vi.spyOn(pageNavigation, 'assign').mockImplementation(() => {});
    const value = signedIn('user-a', 'a@example.test');
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.myProgress('user-a'), [{ lesson: 1, score: 100, time_spent: 1 }]);
    client.setQueryData(queryKeys.myProgress(null), []);
    renderWithClient(withAuth(value, <AuthControls />), client);

    expect(screen.getByRole('group', { name: 'ログイン中: a@example.test' })).toBeInTheDocument();
    expect(screen.getByText('a@example.test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ログイン' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(value.removeUser).toHaveBeenCalledTimes(1);
    const url = new URL(assign.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://login.example.test/logout');
    expect(url.searchParams.get('client_id')).toBe('test-client');
    expect(url.searchParams.get('logout_uri')).toBe(`${window.location.origin}/`);
    // ユーザーのキャッシュのみ削除する
    expect(client.getQueryData(queryKeys.myProgress('user-a'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.myProgress(null))).toEqual([]);
  });
});

describe('ログイン完了後の戻り先', () => {
  function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location">{location.pathname + location.search}</div>;
  }

  function renderProvider() {
    renderWithClient(
      <MemoryRouter initialEntries={['/auth/callback?code=abc&state=xyz']}>
        <AppAuthProvider>
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </AppAuthProvider>
      </MemoryRouter>
    );
    expect(captured.props?.onSigninCallback).toBeTypeOf('function');
  }

  test.each([
    ['/progress', '/progress'],
    ['/scene/1?page=2', '/scene/1?page=2'],
    ['//evil.com', '/'],
    ['https://evil.com', '/'],
  ])('保存した戻り先 %s から %s へ移動し、URL から認可コードを取り除く', async (returnTo, expected) => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    renderProvider();

    await act(async () => {
      captured.props?.onSigninCallback?.({ state: { returnTo } } as unknown as User);
    });

    expect(screen.getByTestId('location')).toHaveTextContent(expected);
    expect(replaceState).toHaveBeenCalledWith(null, document.title, expected);
  });
});

describe('ユーザーごとの進捗キャッシュ', () => {
  function ProgressProbe() {
    const query = useMyProgressQuery();
    return <div data-testid="count">{query.data ? query.data.length : 'loading'}</div>;
  }

  test('クエリキーにユーザーを含め、別のユーザーのキャッシュを使わない', async () => {
    expect(queryKeys.myProgress('user-a')).not.toEqual(queryKeys.myProgress('user-b'));
    expect(queryKeys.myProgress(null)).toEqual(['progress', 'mine', 'anonymous']);

    mockedAxios.get.mockResolvedValue({ data: [] });
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.myProgress('user-a'), [{ lesson: 1, score: 100, time_spent: 1 }]);

    const view = renderWithClient(withAuth(signedIn('user-a', 'a@example.test'), <ProgressProbe />), client);
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    view.rerender(<QueryClientProvider client={client}>{withAuth(signedIn('user-b', 'b@example.test'), <ProgressProbe />)}</QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
    expect(client.getQueryData(queryKeys.myProgress('user-b'))).toEqual([]);
  });

  test('ログアウトするとユーザーのキャッシュを削除する', () => {
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.myProgress('user-a'), [{ lesson: 1, score: 100, time_spent: 1 }]);
    const notice = vi.fn();
    const view = renderWithClient(withAuth(signedIn('user-a', 'a@example.test'), <AuthSessionEffects onNotice={notice} />), client);

    view.rerender(<QueryClientProvider client={client}>{withAuth(authValue(), <AuthSessionEffects onNotice={notice} />)}</QueryClientProvider>);

    expect(client.getQueryData(queryKeys.myProgress('user-a'))).toBeUndefined();
  });
});

describe('ログイン直後の進捗の反映', () => {
  test('ブラウザの進捗をアカウントへ保存し、結果を通知する', async () => {
    pushLocalProgress({ lesson: 1, score: 80, time_spent: 10 });
    pushLocalProgress({ lesson: 2, score: 100, time_spent: 20 });
    mockedAxios.post.mockResolvedValue({ data: {} });
    const notice = vi.fn();

    renderWithClient(withAuth(signedIn('user-a', 'a@example.test'), <AuthSessionEffects onNotice={notice} />));

    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    expect(notice.mock.calls[0][0].message).toContain('ブラウザに保存された進捗をアカウントに反映しました（2件）');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post.mock.calls[0][1]).toEqual({ lesson_id: '1', score: 80, time_spent: 10 });
    expect(readLocalProgress()).toEqual([]);
  });

  test('429 で中断した場合は残りをブラウザに保持し、同じタブでは再実行しない', async () => {
    pushLocalProgress({ lesson: 1, score: 80, time_spent: 10 });
    pushLocalProgress({ lesson: 2, score: 100, time_spent: 20 });
    mockedAxios.post
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { response: { status: 429 } }));
    const notice = vi.fn();

    const view = renderWithClient(withAuth(signedIn('user-a', 'a@example.test'), <AuthSessionEffects onNotice={notice} />));

    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    expect(notice.mock.calls[0][0].message).toContain('（1件）');
    expect(readLocalProgress().map((e) => e.lesson)).toEqual([2]);

    view.unmount();
    renderWithClient(withAuth(signedIn('user-a', 'a@example.test'), <AuthSessionEffects onNotice={notice} />));
    await Promise.resolve();
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  test('未ログイン時は反映しない', async () => {
    pushLocalProgress({ lesson: 1, score: 80, time_spent: 10 });
    renderWithClient(withAuth(authValue(), <AuthSessionEffects onNotice={vi.fn()} />));
    await Promise.resolve();
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(readLocalProgress()).toHaveLength(1);
  });
});
