import { lessonDescription, phraseNote, speakerLabel } from './labels';

test('話者の略称に日本語の説明を添え、対応表に無い話者はそのまま表示する', () => {
  expect(speakerLabel('PM')).toBe('PM（プロダクトマネージャー）');
  expect(speakerLabel(' QA ')).toBe('QA（品質保証）');
  expect(speakerLabel('Alice')).toBe('Alice');
});

test('タイトルを繰り返すだけのレッスンの説明は表示しない', () => {
  expect(lessonDescription('Daily Standup / Yesterday', 'Yesterday')).toBeNull();
  expect(lessonDescription('Yesterday', 'Yesterday')).toBeNull();
  expect(lessonDescription('', 'Yesterday')).toBeNull();
  expect(lessonDescription(undefined, 'Yesterday')).toBeNull();
  expect(lessonDescription('昨日やったことを伝える', 'Yesterday')).toBe('昨日やったことを伝える');
});

test('管理用の印はフレーズのメモとして表示しない', () => {
  expect(phraseNote('seed')).toBeNull();
  expect(phraseNote('')).toBeNull();
  expect(phraseNote('丁寧な言い方')).toBe('丁寧な言い方');
});
