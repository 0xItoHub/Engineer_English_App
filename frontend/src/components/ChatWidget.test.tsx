import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatWidget from './ChatWidget';
import { DEMO_GREETING } from './ChatDialog';

test('ボタンで開き、入力欄にフォーカスし、Esc で閉じてボタンにフォーカスが戻る', async () => {
  render(<ChatWidget />);
  const openButton = screen.getByRole('button', { name: 'AI チャット（デモ）を開く' });

  openButton.focus();
  fireEvent.click(openButton);
  // チャットの画面は最初に開いたときに読み込む
  const dialog = await screen.findByRole('dialog', { name: 'AI チャット（デモ）' });
  expect(dialog).toBeInTheDocument();
  // デモであることを最初のメッセージで伝える
  expect(screen.getByText(DEMO_GREETING)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'メッセージを入力' })).toHaveFocus();

  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(openButton).toHaveFocus();
});

test('「チャットを閉じる」ボタンで閉じられる', async () => {
  render(<ChatWidget />);
  fireEvent.click(screen.getByRole('button', { name: 'AI チャット（デモ）を開く' }));
  fireEvent.click(await screen.findByRole('button', { name: 'チャットを閉じる' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
