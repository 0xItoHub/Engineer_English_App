import type { User } from 'oidc-client-ts';
import { buildLogoutUrl, readCognitoConfig, returnPathFromUser, sanitizeReturnPath } from './auth';

const ORIGIN = 'https://app.example.test';

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
