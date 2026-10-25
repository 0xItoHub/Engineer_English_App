import { vi, type Mocked } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
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
  // ヘッダーから学習履歴へ移動できる
  expect(screen.getByRole('link', { name: '学習履歴' })).toHaveAttribute('href', '/progress');
});

test('ホームの h1 はアプリの目的を表し、キャッチコピーは見出しにしない', async () => {
  renderWithClient(<App />);

  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('エンジニアのための、実務に効く英語学習');
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByText('コードは世界を跨ぐ', { exact: false }).tagName).toBe('P');
});

test('存在しない URL では「ページが見つかりませんでした」とホームへのボタンを表示する', async () => {
  window.history.pushState(null, '', '/no-such-page');
  try {
    renderWithClient(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: 'ページが見つかりませんでした' })).toBeInTheDocument();
    expect(document.title).toBe('ページが見つかりませんでした | Engineer English App');
    fireEvent.click(screen.getByRole('link', { name: 'ホームへ' }));
    expect(await screen.findByText('Daily Standup')).toBeInTheDocument();
    expect(document.title).toBe('Engineer English App');
    // 画面遷移後はページの見出しへフォーカスを移す
    expect(await screen.findByRole('heading', { level: 1, name: 'エンジニアのための、実務に効く英語学習' })).toHaveFocus();
  } finally {
    window.history.pushState(null, '', '/');
  }
});

test.each([
  ['/privacy', 'プライバシーポリシー'],
  ['/terms', '利用規約'],
  ['/contact', 'お問い合わせ'],
])('%s では「%s」のページを表示する', async (path, title) => {
  window.history.pushState(null, '', path);
  try {
    renderWithClient(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(document.title).toBe(`${title} | Engineer English App`);
    // フッターには個人開発のサービスであることを表示する
    expect(screen.getByText('Engineer English App（個人開発）')).toBeInTheDocument();
  } finally {
    window.history.pushState(null, '', '/');
  }
});

test('プライバシーポリシーには取得する情報・保存先・削除の依頼先・最終更新日を記載する', async () => {
  window.history.pushState(null, '', '/privacy');
  try {
    renderWithClient(<App />);

    await screen.findByRole('heading', { level: 1, name: 'プライバシーポリシー' });
    expect(screen.getByText(/Amazon Cognito/)).toBeInTheDocument();
    expect(screen.getByText(/東京リージョン/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /GitHub リポジトリの Issues/ })).toHaveAttribute(
      'href',
      'https://github.com/0xItoHub/Engineer_English_App/issues'
    );
    expect(screen.getByText('最終更新日: 2026年10月25日')).toBeInTheDocument();
  } finally {
    window.history.pushState(null, '', '/');
  }
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
