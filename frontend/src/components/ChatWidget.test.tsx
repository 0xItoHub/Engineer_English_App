import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatWidget from './ChatWidget';

test('ボタンで開き、入力欄にフォーカスし、Esc で閉じてボタンにフォーカスが戻る', async () => {
  render(<ChatWidget />);
  const openButton = screen.getByRole('button', { name: 'AIチャットを開く' });

  openButton.focus();
  fireEvent.click(openButton);
  const dialog = screen.getByRole('dialog', { name: 'AI Chat' });
  expect(dialog).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'メッセージを入力' })).toHaveFocus();

  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(openButton).toHaveFocus();
});

test('「チャットを閉じる」ボタンで閉じられる', async () => {
  render(<ChatWidget />);
  fireEvent.click(screen.getByRole('button', { name: 'AIチャットを開く' }));
  fireEvent.click(screen.getByRole('button', { name: 'チャットを閉じる' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
