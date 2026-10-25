import axios, { AxiosError, type AxiosAdapter } from 'axios';
import type { User } from 'oidc-client-ts';
import { isApiRequestUrl, setupAuthInterceptors, type TokenSource } from './authHttp';

const ORIGIN = 'https://app.example.test';
const API_BASE = 'https://api.example.test';

const userWith = (token: string) => ({ access_token: token, expired: false }) as unknown as User;

// 送信されたリクエストを記録し、指定したステータスを返すアダプター
function createAdapter(statuses: number[]) {
  // 再送時は同じ設定オブジェクトが使われるため、送信時点のヘッダーを記録する
  const seen: { authorization: string | undefined }[] = [];
  const adapter: AxiosAdapter = async (config) => {
    seen.push({ authorization: (config.headers.get('Authorization') as string | undefined) ?? undefined });
    const status = statuses.shift() ?? 200;
    const response = { data: {}, status, statusText: '', headers: {}, config };
    if (status >= 400) throw new AxiosError('error', undefined, config, null, response);
    return response;
  };
  return { adapter, seen };
}

function createSource(user: User | null, renewed: User | null = null): TokenSource & { [K in keyof TokenSource]: ReturnType<typeof vi.fn> } {
  return {
    getUser: vi.fn(async () => user),
    signinSilent: vi.fn(async () => renewed),
    removeUser: vi.fn(async () => undefined),
  };
}

function setup(statuses: number[], source: TokenSource | null, onSessionExpired = vi.fn()) {
  const { adapter, seen } = createAdapter(statuses);
  const instance = axios.create({ adapter });
  setupAuthInterceptors(instance, () => source, { apiBaseUrl: API_BASE, origin: ORIGIN, onSessionExpired });
  return { instance, seen, onSessionExpired };
}

describe('isApiRequestUrl', () => {
  test('同一オリジンの /api/ 配下と API のオリジンのみを対象にする', () => {
    expect(isApiRequestUrl('/api/progress/my_progress/', undefined, '', ORIGIN)).toBe(true);
    expect(isApiRequestUrl(`${ORIGIN}/api/scenes/`, undefined, '', ORIGIN)).toBe(true);
    expect(isApiRequestUrl(`${API_BASE}/api/scenes/`, undefined, API_BASE, ORIGIN)).toBe(true);

    expect(isApiRequestUrl('/assets/app.js', undefined, '', ORIGIN)).toBe(false);
    expect(isApiRequestUrl('https://evil.example.com/api/scenes/', undefined, API_BASE, ORIGIN)).toBe(false);
    expect(isApiRequestUrl('//evil.example.com/api/scenes/', undefined, API_BASE, ORIGIN)).toBe(false);
    expect(isApiRequestUrl(`${API_BASE}/api/scenes/`, undefined, '', ORIGIN)).toBe(false);
    expect(isApiRequestUrl('/api/scenes/', 'https://evil.example.com', '', ORIGIN)).toBe(false);
    expect(isApiRequestUrl(undefined, undefined, API_BASE, ORIGIN)).toBe(false);
  });
});

describe('setupAuthInterceptors', () => {
  test('ログイン中は API 宛てのリクエストにのみアクセストークンを付与する', async () => {
    const { instance, seen } = setup([], createSource(userWith('token-1')));

    await instance.get('/api/progress/my_progress/');
    await instance.get(`${API_BASE}/api/scenes/`);
    await instance.get('https://other.example.com/api/scenes/');
    await instance.get('/static/data.json');

    expect(seen.map((c) => c.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-1',
      undefined,
      undefined,
    ]);
  });

  test('未ログイン時や期限切れのトークンは付与しない', async () => {
    const expired = { access_token: 'old', expired: true } as unknown as User;
    const anon = setup([], createSource(null));
    const stale = setup([], createSource(expired));
    const disabled = setup([], null);

    await anon.instance.get('/api/scenes/');
    await stale.instance.get('/api/scenes/');
    await disabled.instance.get('/api/scenes/');

    expect(anon.seen[0].authorization).toBeUndefined();
    expect(stale.seen[0].authorization).toBeUndefined();
    expect(disabled.seen[0].authorization).toBeUndefined();
  });

  test('401 の場合はトークンを更新して 1 回だけ再送する', async () => {
    const source = createSource(userWith('token-1'), userWith('token-2'));
    const { instance, seen, onSessionExpired } = setup([401, 200], source);

    const res = await instance.get('/api/progress/my_progress/');

    expect(res.status).toBe(200);
    expect(source.signinSilent).toHaveBeenCalledTimes(1);
    expect(seen.map((c) => c.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(source.removeUser).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  test('再送しても 401 の場合はローカルのログイン情報を削除して通知する', async () => {
    const source = createSource(userWith('token-1'), userWith('token-2'));
    const { instance, seen, onSessionExpired } = setup([401, 401], source);

    await expect(instance.get('/api/progress/my_progress/')).rejects.toMatchObject({ response: { status: 401 } });

    expect(seen).toHaveLength(2);
    expect(source.signinSilent).toHaveBeenCalledTimes(1);
    expect(source.removeUser).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test('トークンを更新できない場合は再送せずにログアウト状態へ戻す', async () => {
    const source = createSource(userWith('token-1'), null);
    source.signinSilent.mockRejectedValue(new Error('renew failed'));
    const { instance, seen, onSessionExpired } = setup([401], source);

    await expect(instance.get('/api/scenes/')).rejects.toMatchObject({ response: { status: 401 } });

    expect(seen).toHaveLength(1);
    expect(source.removeUser).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test('未ログインで受け取った 401 は通常のエラーとして扱う（更新・ログアウト処理は行わない）', async () => {
    const source = createSource(null, userWith('token-2'));
    const { instance, seen, onSessionExpired } = setup([401], source);

    await expect(instance.get('/api/progress/')).rejects.toMatchObject({ response: { status: 401 } });

    expect(seen).toHaveLength(1);
    expect(source.signinSilent).not.toHaveBeenCalled();
    expect(source.removeUser).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  test('401 以外のエラーではトークンを更新しない', async () => {
    const source = createSource(userWith('token-1'), userWith('token-2'));
    const { instance } = setup([403], source);

    await expect(instance.get('/api/scenes/')).rejects.toMatchObject({ response: { status: 403 } });
    expect(source.signinSilent).not.toHaveBeenCalled();
    expect(source.removeUser).not.toHaveBeenCalled();
  });
});
