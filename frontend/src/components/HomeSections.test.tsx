import { render, screen, within } from '@testing-library/react';
import TechStack from './TechStack';
import ContentStats from './ContentStats';
import { countContent } from '../lib/queries';

test('技術スタックを分類ごとの一覧で表示する', () => {
  render(<TechStack />);

  expect(screen.getByRole('heading', { level: 2, name: '技術スタック' })).toBeInTheDocument();

  const frontend = screen.getByRole('list', { name: 'フロントエンド' });
  for (const name of ['React 19', 'TypeScript', 'Vite', 'MUI', 'TanStack Query', 'React Router']) {
    expect(within(frontend).getByText(name)).toBeInTheDocument();
  }
  const backend = screen.getByRole('list', { name: 'バックエンド' });
  expect(within(backend).getAllByRole('listitem')).toHaveLength(2);
  expect(within(backend).getByText('Django 5.2 LTS')).toBeInTheDocument();
  expect(within(backend).getByText('Django REST framework')).toBeInTheDocument();
  const infra = screen.getByRole('list', { name: 'インフラ・CI/CD' });
  for (const name of ['AWS Lambda（コンテナ）', 'API Gateway', 'CloudFront + S3', 'Terraform', 'GitHub Actions']) {
    expect(within(infra).getByText(name)).toBeInTheDocument();
  }
  expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
});

test('リポジトリへのリンクは新しいタブで安全に開く', () => {
  render(<TechStack />);

  const link = screen.getByRole('link', { name: /ソースコード（GitHub）/ });
  expect(link).toHaveAttribute('href', 'https://github.com/0xItoHub/Engineer_English_App');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('シーン一覧から教材の総数を集計して表示する', () => {
  const stats = countContent([
    { id: 1, title: 'A', lessons: [{ id: 1, title: 'l', description: '' }], phrases: [], dialogues: [] },
    {
      id: 2,
      title: 'B',
      lessons: [
        { id: 2, title: 'l', description: '' },
        { id: 3, title: 'l', description: '' },
      ],
      phrases: [{ id: 1, text_en: 'a', text_ja: 'a', note: '' }],
      dialogues: [
        { id: 1, speaker: 'A', line_en: 'a', line_ja: 'a', order: 1 },
        { id: 2, speaker: 'B', line_en: 'b', line_ja: 'b', order: 2 },
      ],
    },
    { id: 3, title: 'C' },
  ]);
  expect(stats).toEqual({ scenes: 3, lessons: 3, phrases: 1, dialogues: 2 });

  render(<ContentStats stats={stats} />);
  expect(screen.getByRole('heading', { level: 2, name: '収録コンテンツ' })).toBeInTheDocument();
  expect(within(screen.getByTestId('stat-dialogues')).getByText('2')).toBeInTheDocument();
  expect(within(screen.getByTestId('stat-dialogues')).getByText('対話')).toBeInTheDocument();
});
