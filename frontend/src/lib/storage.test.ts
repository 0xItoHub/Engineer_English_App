import { LOCAL_PROGRESS_KEY, pushLocalProgress, readJSON, readLocalProgress } from './storage';

test('壊れた JSON はフォールバック値を返す', () => {
  window.localStorage.setItem('broken', '{oops');
  expect(readJSON('broken', 'fallback')).toBe('fallback');
});

test('形式の正しい進捗のみ読み込む', () => {
  window.localStorage.setItem(
    LOCAL_PROGRESS_KEY,
    JSON.stringify([{ lesson: 1, score: 80, time_spent: 3 }, { foo: 'bar' }, null, { lesson: 'x' }])
  );
  expect(readLocalProgress()).toEqual([{ lesson: 1, score: 80, time_spent: 3 }]);
});

test('同じレッスンは高いスコアを保持して上書きする', () => {
  pushLocalProgress({ lesson: 1, score: 80, time_spent: 3 });
  pushLocalProgress({ lesson: 1, score: 50, time_spent: 9 });
  pushLocalProgress({ lesson: 2, score: 100, time_spent: 1 });
  expect(readLocalProgress()).toEqual([
    { lesson: 1, score: 80, time_spent: 9 },
    { lesson: 2, score: 100, time_spent: 1 },
  ]);
});
