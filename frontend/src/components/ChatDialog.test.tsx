import { vi, type Mocked } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AuthContext, type AuthContextProps } from 'react-oidc-context';
import axios from 'axios';
import ChatDialog, { DEMO_GREETING, DEMO_TITLE, LIVE_GREETING, LIVE_TITLE, LOGIN_REQUIRED_MESSAGE } from './ChatDialog';
import { toApiMessages, type ChatMessage } from '../hooks/useChatClient';
import { renderWithClient } from '../test/renderWithClient';

// ログイン機能を有効にした状態でテストする（ダミーの値）
vi.hoisted(() => {
  vi.stubEnv('VITE_COGNITO_AUTHORITY', 'https://issuer.example.test/pool');
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'test-client');
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://login.example.test');
});

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

const LIMITS = { max_input_chars: 500, max_history: 6, user_daily_limit: 20 };

const signedOut = (overrides: Partial<AuthContextProps> = {}) =>
  ({ user: null, isLoading: false, isAuthenticated: false, signinRedirect: vi.fn(async () => undefined), ...overrides }) as unknown as AuthContextProps;

const signedIn = {
  user: { access_token: 'token', expired: false, profile: { sub: 'user-a', email: 'a@example.test' } },
  isLoading: false,
  isAuthenticated: true,
} as unknown as AuthContextProps;

function mockStatus(data: object) {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/chat/status/')) return Promise.resolve({ data });
    return Promise.reject(new Error('unexpected'));
  });
}

function apiError(status: number, detail?: string) {
  return Object.assign(new Error(`status ${status}`), {
    isAxiosError: true,
    response: { status, data: detail ? { detail } : {} },
  });
}

function renderDialog(auth: AuthContextProps) {
  return renderWithClient(
    <AuthContext.Provider value={auth}>
      <ChatDialog open onClose={() => undefined} />
    </AuthContext.Provider>
  );
}

const input = () => screen.getByRole('textbox', { name: 'メッセージを入力' });
const sendButton = () => screen.getByRole('button', { name: '送信' });

function typeAndSend(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.click(sendButton());
}

afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});

test('無効な場合はデモとして入力内容をそのまま返す（API には送信しない）', async () => {
  mockStatus({ enabled: false, requires_login: true, limits: LIMITS });
  renderDialog(signedIn);

  expect(await screen.findByRole('dialog', { name: DEMO_TITLE })).toBeInTheDocument();
  expect(screen.getByText(DEMO_GREETING)).toBeInTheDocument();
  typeAndSend('Hello');
  expect(await screen.findByText(/You said: "Hello"/)).toBeInTheDocument();
  expect(mockedAxios.post).not.toHaveBeenCalled();
});

test('状態を取得できない場合もデモとして表示する', async () => {
  mockedAxios.get.mockRejectedValue(apiError(500));
  renderDialog(signedIn);
  expect(await screen.findByRole('dialog', { name: DEMO_TITLE })).toBeInTheDocument();
  expect(screen.getByText(DEMO_GREETING)).toBeInTheDocument();
});

test('有効でログインしていない場合はログインを案内する', async () => {
  mockStatus({ enabled: true, requires_login: true, limits: LIMITS });
  const auth = signedOut();
  renderDialog(auth);

  expect(await screen.findByText(LOGIN_REQUIRED_MESSAGE)).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: LIVE_TITLE })).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'メッセージを入力' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));
  await waitFor(() => expect(auth.signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/' } }));
  expect(mockedAxios.post).not.toHaveBeenCalled();
});

test('ログイン画面を開けない場合はエラーを表示する', async () => {
  mockStatus({ enabled: true, requires_login: true, limits: LIMITS });
  renderDialog(signedOut({ signinRedirect: vi.fn(async () => Promise.reject(new Error('x'))) }));
  fireEvent.click(await screen.findByRole('button', { name: 'ログイン' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('ログイン画面を開けませんでした');
});

test('ログイン中は AI に質問し、回答と残り回数を表示する', async () => {
  mockStatus({ enabled: true, requires_login: true, limits: LIMITS, remaining_today: 20 });
  let resolve: (value: unknown) => void = () => undefined;
  mockedAxios.post.mockImplementation(() => new Promise((r) => (resolve = r)));
  renderDialog(signedIn);

  expect(await screen.findByText(LIVE_GREETING)).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: LIVE_TITLE })).toBeInTheDocument();
  expect(screen.getByText('本日の残り: 20 回')).toBeInTheDocument();
  expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');

  typeAndSend('「確認します」を英語で？');
  // 回答を待つ間は送信できない
  expect(sendButton()).toBeDisabled();
  expect(screen.getByText('回答を作成しています…')).toBeInTheDocument();
  expect(mockedAxios.post).toHaveBeenCalledWith('/api/chat/', {
    messages: [{ role: 'user', content: '「確認します」を英語で？' }],
  });

  await act(async () => resolve({ data: { reply: "I'll check it.", remaining_today: 19 } }));
  const log = screen.getByRole('log');
  expect(within(log).getByText("I'll check it.")).toBeInTheDocument();
  expect(screen.getByText('本日の残り: 19 回')).toBeInTheDocument();

  // 2 回目は会話の履歴（案内を除く）を含めて送る
  mockedAxios.post.mockResolvedValue({ data: { reply: 'Sure.', remaining_today: 18 } });
  typeAndSend('もっと丁寧に');
  expect(await screen.findByText('Sure.')).toBeInTheDocument();
  expect(mockedAxios.post).toHaveBeenLastCalledWith('/api/chat/', {
    messages: [
      { role: 'user', content: '「確認します」を英語で？' },
      { role: 'assistant', content: "I'll check it." },
      { role: 'user', content: 'もっと丁寧に' },
    ],
  });
});

test('入力できる文字数を表示し、上限を超える入力はできない', async () => {
  mockStatus({ enabled: true, requires_login: true, limits: { ...LIMITS, max_input_chars: 10 }, remaining_today: 5 });
  renderDialog(signedIn);
  await screen.findByText(LIVE_GREETING);

  expect(screen.getByText('0 / 10 文字')).toBeInTheDocument();
  expect(input()).toHaveAttribute('maxLength', '10');
  expect(sendButton()).toBeDisabled();
  fireEvent.change(input(), { target: { value: 'abc' } });
  expect(screen.getByText('3 / 10 文字')).toBeInTheDocument();
  expect(sendButton()).toBeEnabled();
});

test('日本語入力の変換確定中の Enter では送信しない', async () => {
  mockStatus({ enabled: true, requires_login: true, limits: LIMITS, remaining_today: 5 });
  mockedAxios.post.mockResolvedValue({ data: { reply: 'ok', remaining_today: 4 } });
  renderDialog(signedIn);
  await screen.findByText(LIVE_GREETING);

  fireEvent.change(input(), { target: { value: 'てすと' } });
  fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
  expect(mockedAxios.post).not.toHaveBeenCalled();
  fireEvent.keyDown(input(), { key: 'Enter' });
  await waitFor(() => expect(mockedAxios.post).toHaveBeenCalledTimes(1));
});

test('残り回数が 0 の場合は送信できない', async () => {
  mockStatus({ enabled: true, requires_login: true, limits: LIMITS, remaining_today: 0 });
  renderDialog(signedIn);
  await screen.findByText('本日の残り: 0 回');
  fireEvent.change(input(), { target: { value: 'hello' } });
  expect(sendButton()).toBeDisabled();
});

test.each([
  [429, '本日の AI チャットの利用回数の上限に達しました。明日また利用できます。'],
  [503, 'AI チャットは現在利用できません。'],
  [502, 'AI の回答を取得できませんでした。しばらくしてから再度お試しください。'],
  [504, 'AI の回答に時間がかかっています。しばらくしてから再度お試しください。'],
])('エラー（%i）の場合は API の説明をチャット内に表示する', async (status, detail) => {
  mockStatus({ enabled: true, requires_login: true, limits: LIMITS, remaining_today: 3 });
  mockedAxios.post.mockRejectedValue(apiError(status, detail));
  renderDialog(signedIn);
  await screen.findByText(LIVE_GREETING);

  typeAndSend('hello');
  expect(await screen.findByText(detail)).toBeInTheDocument();
  expect(sendButton()).toBeDisabled(); // 入力欄が空のため
  fireEvent.change(input(), { target: { value: 'again' } });
  expect(sendButton()).toBeEnabled();
  if (status === 429 || status === 503) {
    // 残り回数・利用可否を取得し直す
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(2));
  }
});

test('説明が無いエラーは状態に応じたメッセージを表示する', async () => {
  mockStatus({ enabled: true, requires_login: true, limits: LIMITS, remaining_today: 3 });
  mockedAxios.post.mockRejectedValue(apiError(429));
  renderDialog(signedIn);
  await screen.findByText(LIVE_GREETING);
  typeAndSend('hello');
  expect(await screen.findByText('アクセスが集中しています。しばらく待ってから再度お試しください。')).toBeInTheDocument();
});

test('会話の履歴は案内を除いた直近の件数にそろえ、質問から始める', () => {
  const messages: ChatMessage[] = [
    { id: '0', role: 'assistant', content: 'hello', notice: true },
    { id: '1', role: 'user', content: 'q1' },
    { id: '2', role: 'assistant', content: 'a1' },
    { id: '3', role: 'assistant', content: 'error', notice: true },
    { id: '4', role: 'user', content: 'q2' },
    { id: '5', role: 'assistant', content: 'a2' },
    { id: '6', role: 'user', content: 'q3' },
  ];
  expect(toApiMessages(messages, 4)).toEqual([
    { role: 'user', content: 'q2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'q3' },
  ]);
  expect(toApiMessages(messages, 10)[0]).toEqual({ role: 'user', content: 'q1' });
});
