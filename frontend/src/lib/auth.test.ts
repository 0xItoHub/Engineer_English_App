import { OidcClient, type User } from 'oidc-client-ts';
import {
  buildLogoutUrl,
  createUserManager,
  LOGIN_PAGE_LANGUAGE,
  readCognitoConfig,
  returnPathFromUser,
  sanitizeReturnPath,
} from './auth';

const ORIGIN = 'https://app.example.test';

test('ログイン画面への URL に表示言語（lang=ja）を含める', async () => {
  const config = { authority: 'https://issuer.example.test/pool', clientId: 'client', domain: 'https://login.example.test' };
  const manager = createUserManager(config, ORIGIN);
  expect(LOGIN_PAGE_LANGUAGE).toBe('ja');
  expect(manager.settings.extraQueryParams).toEqual({ lang: 'ja' });

  // 同じ設定で認可リクエストを組み立て、実際の URL にパラメータが含まれることを確認する
  const client = new OidcClient({
    ...manager.settings,
    metadata: { issuer: config.authority, authorization_endpoint: `${config.domain}/oauth2/authorize` },
  });
  const request = await client.createSigninRequest({ request_type: 'si:r' });
  const url = new URL(request.url);
  expect(url.origin + url.pathname).toBe('https://login.example.test/oauth2/authorize');
  expect(url.searchParams.get('lang')).toBe('ja');
  expect(url.searchParams.get('client_id')).toBe('client');
  expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
});

describe('readCognitoConfig', () => {
  test('必要な値がそろっていない場合はログイン機能を無効にする', () => {
    expect(readCognitoConfig({})).toBeNull();
    expect(readCognitoConfig({ VITE_COGNITO_AUTHORITY: 'https://issuer.example.test/pool', VITE_COGNITO_CLIENT_ID: 'client' })).toBeNull();
    expect(readCognitoConfig({ VITE_COGNITO_AUTHORITY: ' ', VITE_COGNITO_CLIENT_ID: 'client', VITE_COGNITO_DOMAIN: 'https://login.example.test' })).toBeNull();
  });

  test('すべての値がそろっていれば設定を返す（ドメイン末尾のスラッシュは取り除く）', () => {
    expect(
      readCognitoConfig({
        VITE_COGNITO_AUTHORITY: 'https://issuer.example.test/pool',
        VITE_COGNITO_CLIENT_ID: 'client',
        VITE_COGNITO_DOMAIN: 'https://login.example.test/',
      })
    ).toEqual({ authority: 'https://issuer.example.test/pool', clientId: 'client', domain: 'https://login.example.test' });
  });
});

test('ログアウト URL にクライアント ID と戻り先を含める', () => {
  const url = new URL(buildLogoutUrl({ authority: 'a', clientId: 'client', domain: 'https://login.example.test' }, ORIGIN));
  expect(url.origin + url.pathname).toBe('https://login.example.test/logout');
  expect(url.searchParams.get('client_id')).toBe('client');
  expect(url.searchParams.get('logout_uri')).toBe(`${ORIGIN}/`);
});

describe('sanitizeReturnPath', () => {
  test.each([
    ['/progress', '/progress'],
    ['/scene/1?page=2#top', '/scene/1?page=2#top'],
    ['/', '/'],
  ])('同一オリジン内のパス %s はそのまま使う', (input, expected) => {
    expect(sanitizeReturnPath(input, ORIGIN)).toBe(expected);
  });

  test.each([
    '//evil.com',
    '//evil.com/path',
    'https://evil.com',
    'https://evil.com/progress',
    'javascript:alert(1)',
    '/\\evil.com',
    '/\tevil',
    'progress',
    '',
    '/auth/callback',
    '/auth/callback?code=x',
  ])('許可しない戻り先 %s はトップページにする', (input) => {
    expect(sanitizeReturnPath(input, ORIGIN)).toBe('/');
  });

  test('文字列以外や長すぎる値はトップページにする', () => {
    expect(sanitizeReturnPath(undefined, ORIGIN)).toBe('/');
    expect(sanitizeReturnPath({ path: '/x' }, ORIGIN)).toBe('/');
    expect(sanitizeReturnPath(`/${'a'.repeat(3000)}`, ORIGIN)).toBe('/');
  });

  test('ログイン時に保存した state から戻り先を取り出す', () => {
    expect(returnPathFromUser({ state: { returnTo: '/progress' } } as unknown as User)).toBe('/progress');
    expect(returnPathFromUser({ state: { returnTo: '//evil.com' } } as unknown as User)).toBe('/');
    expect(returnPathFromUser(undefined)).toBe('/');
  });
});
