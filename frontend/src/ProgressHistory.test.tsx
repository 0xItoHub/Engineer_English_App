import { vi, type Mocked } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import axios from 'axios';
import ProgressHistory from './ProgressHistory';
import { LOCAL_PROGRESS_KEY } from './lib/storage';
import { renderWithClient } from './test/renderWithClient';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

const scenes = [
  { id: 1, title: 'Daily Standup', lessons: [{ id: 10, title: 'Yesterday' }, { id: 11, title: 'Blockers' }] },
  { id: 2, title: 'Code Review', lessons: [{ id: 20, title: 'LGTM' }] },
];

const SERVER_DATE = '2026-03-04T05:06:00.000Z';
const LOCAL_DATE = '2026-04-05T06:07:00.000Z';

const formatted = (iso: string) =>
  new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function mockApi(progress: unknown[] = []) {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/scenes/')) return Promise.resolve({ data: scenes });
    if (url.endsWith('/api/progress/my_progress/')) return Promise.resolve({ data: progress });
    return Promise.reject(new Error('unexpected'));
  });
}

function renderHistory() {
  return renderWithClient(
    <MemoryRouter initialEntries={['/progress']}>
      <Routes>
        <Route path="/progress" element={<ProgressHistory />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

test('完了したレッスンを「完了」として表示し、記録された完了日時を表示する', async () => {
  mockApi([{ id: 1, lesson: 10, lesson_title: 'Yesterday', scene_title: 'Daily Standup', completed_at: SERVER_DATE, score: 100, time_spent: 90 }]);
  window.localStorage.setItem(
    LOCAL_PROGRESS_KEY,
    JSON.stringify([
      { lesson: 20, score: 100, time_spent: 30, owner: null, completed_at: LOCAL_DATE },
      // 完了日時を記録していないデータ
      { lesson: 11, score: 100, time_spent: 5 },
    ])
  );

  renderHistory();

  const table = await screen.findByRole('table', { name: '学習履歴一覧' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(3);
  expect(within(rows[0]).getByText('Yesterday')).toBeInTheDocument();
  expect(within(rows[0]).getByText(formatted(SERVER_DATE))).toBeInTheDocument();
  expect(within(rows[1]).getByText('LGTM')).toBeInTheDocument();
  expect(within(rows[1]).getByText('Code Review')).toBeInTheDocument();
  expect(within(rows[1]).getByText(formatted(LOCAL_DATE))).toBeInTheDocument();
  expect(within(rows[2]).getByText('Blockers')).toBeInTheDocument();
  expect(within(rows[2]).getByText('—')).toBeInTheDocument();
  for (const row of rows) expect(within(row).getByText('完了')).toBeInTheDocument();

  // スコア（％）は表示しない
  expect(screen.getByRole('columnheader', { name: '状態' })).toBeInTheDocument();
  expect(screen.queryByText('スコア')).not.toBeInTheDocument();
  expect(screen.queryByText('平均スコア')).not.toBeInTheDocument();
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
});

test('サマリーに完了レッスン数・学習したシーン数・総学習時間を表示する', async () => {
  mockApi([
    { id: 1, lesson: 10, lesson_title: 'Yesterday', scene_title: 'Daily Standup', completed_at: SERVER_DATE, score: 100, time_spent: 60 },
    { id: 2, lesson: 11, lesson_title: 'Blockers', scene_title: 'Daily Standup', completed_at: SERVER_DATE, score: 100, time_spent: 30 },
  ]);
  window.localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify([{ lesson: 20, score: 100, time_spent: 30, completed_at: LOCAL_DATE }]));

  renderHistory();

  const summary = await screen.findByRole('region', { name: '学習サマリー' });
  expect(within(summary).getByText('完了レッスン数').previousSibling).toHaveTextContent('3');
  expect(within(summary).getByText('学習したシーン数').previousSibling).toHaveTextContent('2');
  expect(within(summary).getByText('総学習時間').previousSibling).toHaveTextContent('2分0秒');
});

test('同じレッスンはサーバの記録を優先し、1 件にまとめて表示する', async () => {
  mockApi([{ id: 1, lesson: 10, lesson_title: 'Yesterday', scene_title: 'Daily Standup', completed_at: SERVER_DATE, score: 100, time_spent: 60 }]);
  window.localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify([{ lesson: 10, score: 100, time_spent: 5, completed_at: LOCAL_DATE }]));

  renderHistory();

  const table = await screen.findByRole('table', { name: '学習履歴一覧' });
  expect(within(table).getAllByRole('row')).toHaveLength(2);
  expect(within(table).getByText(formatted(SERVER_DATE))).toBeInTheDocument();
});

test('学習履歴を取得できない場合はエラーと「再試行」を表示する', async () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.endsWith('/api/scenes/')) return Promise.resolve({ data: scenes });
    return Promise.reject({ isAxiosError: true, response: { status: 429 } });
  });

  renderHistory();

  expect(await screen.findByText('アクセスが集中しています。しばらく待ってから再度お試しください。')).toBeInTheDocument();
  expect(screen.queryByText('まだ学習履歴がありません')).not.toBeInTheDocument();

  mockApi([]);
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(await screen.findByText('まだ学習履歴がありません')).toBeInTheDocument();
});

test('スマートフォンの幅では学習履歴を表ではなくカードの一覧で表示する', async () => {
  const original = window.matchMedia;
  // 幅の上限を指定したメディアクエリ（スマートフォン向け）に一致させる
  window.matchMedia = ((query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  try {
    mockApi([{ id: 1, lesson: 10, lesson_title: 'Yesterday', scene_title: 'Daily Standup', completed_at: SERVER_DATE, score: 100, time_spent: 90 }]);

    renderHistory();

    const list = await screen.findByRole('list', { name: '学習履歴一覧' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText('Yesterday')).toBeInTheDocument();
    expect(within(items[0]).getByText('Daily Standup')).toBeInTheDocument();
    expect(within(items[0]).getByText(formatted(SERVER_DATE))).toBeInTheDocument();
    expect(within(items[0]).getByText('1分30秒')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  } finally {
    window.matchMedia = original;
  }
});
