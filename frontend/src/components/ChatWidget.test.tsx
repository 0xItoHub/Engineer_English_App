import { vi, type Mocked } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import ChatWidget from './ChatWidget';
import { DEMO_GREETING } from './ChatDialog';
import { renderWithClient } from '../test/renderWithClient';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

beforeEach(() => {
  // AI チャットが無効な場合（既定）はデモとして動作する
  mockedAxios.get.mockResolvedValue({
    data: { enabled: false, requires_login: true, limits: { max_input_chars: 500, max_history: 6, user_daily_limit: 20 } },
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

test('ボタンで開き、入力欄にフォーカスし、Esc で閉じてボタンにフォーカスが戻る', async () => {
  renderWithClient(<ChatWidget />);
  const openButton = screen.getByRole('button', { name: 'AI チャットを開く' });

  openButton.focus();
  fireEvent.click(openButton);
  // チャットの画面は最初に開いたときに読み込む
  const dialog = await screen.findByRole('dialog', { name: 'AI チャット（デモ）' });
  expect(dialog).toBeInTheDocument();
  // デモであることを最初のメッセージで伝える
  expect(await screen.findByText(DEMO_GREETING)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'メッセージを入力' })).toHaveFocus();
  expect(mockedAxios.get).toHaveBeenCalledWith('/api/chat/status/', expect.anything());

  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(openButton).toHaveFocus();
});

test('「チャットを閉じる」ボタンで閉じられる', async () => {
  renderWithClient(<ChatWidget />);
  fireEvent.click(screen.getByRole('button', { name: 'AI チャットを開く' }));
  fireEvent.click(await screen.findByRole('button', { name: 'チャットを閉じる' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('画面を開くまで AI チャットの状態は取得しない', () => {
  renderWithClient(<ChatWidget />);
  expect(mockedAxios.get).not.toHaveBeenCalled();
});
