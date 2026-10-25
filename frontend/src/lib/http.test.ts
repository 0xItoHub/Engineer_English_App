import axios, { AxiosError, type AxiosAdapter } from 'axios';
import { getErrorMessage, messageForStatus, safeDetail, setupHttpInterceptors, type ApiError } from './http';

function instanceReturning(status: number, data: unknown) {
  const adapter: AxiosAdapter = async (config) => {
    const response = { data, status, statusText: '', headers: {}, config };
    throw new AxiosError('error', undefined, config, null, response);
  };
  const instance = axios.create({ adapter });
  setupHttpInterceptors(instance);
  return instance;
}

async function userMessageOf(status: number, data: unknown): Promise<string | undefined> {
  try {
    await instanceReturning(status, data).get('/api/scenes/');
  } catch (err) {
    return (err as ApiError).userMessage;
  }
  return undefined;
}

test.each([
  [401, 'ログインの有効期限が切れました。もう一度ログインしてください。'],
  [403, 'この操作を行う権限がありません。'],
  [404, 'お探しのデータが見つかりませんでした。'],
  [429, 'アクセスが集中しています。しばらく待ってから再度お試しください。'],
  [503, '一時的に利用できません。しばらくしてから再度お試しください。'],
  [500, 'サーバーでエラーが発生しました。しばらくしてから再度お試しください。'],
])('ステータス %i に応じたメッセージを返す', (status, message) => {
  expect(messageForStatus(status)).toBe(message);
});

test('API の説明文（detail）があれば優先して表示する', async () => {
  expect(await userMessageOf(503, { detail: 'ただいまメンテナンス中です。' })).toBe('ただいまメンテナンス中です。');
  expect(await userMessageOf(400, { detail: '入力内容を確認してください。', errors: {} })).toBe('入力内容を確認してください。');
});

test('401 はログインし直す案内を表示する', async () => {
  expect(await userMessageOf(401, { detail: 'トークンが無効です。' })).toBe('ログインの有効期限が切れました。もう一度ログインしてください。');
});

test('プレーンテキストでない説明文はステータスに応じたメッセージに置き換える', async () => {
  expect(await userMessageOf(503, { detail: '<b>down</b>' })).toBe('一時的に利用できません。しばらくしてから再度お試しください。');
  expect(await userMessageOf(503, '<html>Service Unavailable</html>')).toBe('一時的に利用できません。しばらくしてから再度お試しください。');
  expect(safeDetail({ detail: 'x'.repeat(201) })).toBeNull();
  expect(safeDetail({ detail: 123 })).toBeNull();
});

test('インターセプターを通っていないエラーでも説明文を表示できる', () => {
  expect(getErrorMessage({ isAxiosError: true, response: { status: 429, data: { detail: '少し待ってください。' } } })).toBe('少し待ってください。');
  expect(getErrorMessage({ isAxiosError: true, response: { status: 429 } })).toBe('アクセスが集中しています。しばらく待ってから再度お試しください。');
  expect(getErrorMessage(new Error('x'))).toBe('予期しないエラーが発生しました。');
});
