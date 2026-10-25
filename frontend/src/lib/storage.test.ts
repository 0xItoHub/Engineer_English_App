import {
  LOCAL_PROGRESS_KEY,
  getLocalProgressSnapshot,
  pushLocalProgress,
  readJSON,
  readSpeechRate,
  SPEECH_RATE_KEY,
  writeSpeechRate,
  readLocalProgress,
  removeLocalProgressEntry,
  subscribeLocalProgress,
  visibleLocalProgress,
} from './storage';

test('壊れた JSON はフォールバック値を返す', () => {
  window.localStorage.setItem('broken', '{oops');
  expect(readJSON('broken', 'fallback')).toBe('fallback');
});

test('形式の正しい進捗のみ読み込み、owner・completed_at の無いデータは未ログインの記録・日時不明として扱う', () => {
  window.localStorage.setItem(
    LOCAL_PROGRESS_KEY,
    JSON.stringify([{ lesson: 1, score: 80, time_spent: 3 }, { foo: 'bar' }, null, { lesson: 'x' }])
  );
  expect(readLocalProgress()).toEqual([{ lesson: 1, score: 80, time_spent: 3, owner: null, completed_at: null }]);
});

test('owner と completed_at を保存し、読み込める', () => {
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 3, owner: 'user-a', completed_at: '2026-01-02T03:04:05.000Z' });
  expect(readLocalProgress()).toEqual([
    { lesson: 1, score: 100, time_spent: 3, owner: 'user-a', completed_at: '2026-01-02T03:04:05.000Z' },
  ]);
});

test('completed_at を省略した場合は保存時刻を記録する', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-06T07:08:09.000Z'));
  try {
    pushLocalProgress({ lesson: 1, score: 100, time_spent: 3 });
  } finally {
    vi.useRealTimers();
  }
  expect(readLocalProgress()[0].completed_at).toBe('2026-05-06T07:08:09.000Z');
});

test('同じユーザーの同じレッスンは高いスコアを保持して上書きする', () => {
  pushLocalProgress({ lesson: 1, score: 80, time_spent: 3, completed_at: '2026-01-01T00:00:00.000Z' });
  pushLocalProgress({ lesson: 1, score: 50, time_spent: 9, completed_at: '2026-01-02T00:00:00.000Z' });
  pushLocalProgress({ lesson: 2, score: 100, time_spent: 1, completed_at: '2026-01-03T00:00:00.000Z' });
  expect(readLocalProgress()).toEqual([
    { lesson: 1, score: 80, time_spent: 9, owner: null, completed_at: '2026-01-02T00:00:00.000Z' },
    { lesson: 2, score: 100, time_spent: 1, owner: null, completed_at: '2026-01-03T00:00:00.000Z' },
  ]);
});

test('ユーザーごとに別の記録として保存し、削除も本人の記録だけを対象にする', () => {
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 1 });
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 2, owner: 'user-a' });
  expect(readLocalProgress()).toHaveLength(2);

  removeLocalProgressEntry({ lesson: 1, score: 100, time_spent: 2, owner: 'user-a' });
  expect(readLocalProgress()).toEqual([expect.objectContaining({ lesson: 1, owner: null })]);
});

test('表示するのは、未ログイン時は未ログインの記録、ログイン中は本人の記録のみ', () => {
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 1 });
  pushLocalProgress({ lesson: 2, score: 100, time_spent: 1, owner: 'user-a' });
  pushLocalProgress({ lesson: 3, score: 100, time_spent: 1, owner: 'user-b' });
  const all = readLocalProgress();
  expect(visibleLocalProgress(all, null).map((e) => e.lesson)).toEqual([1]);
  expect(visibleLocalProgress(all, 'user-a').map((e) => e.lesson)).toEqual([2]);
  expect(visibleLocalProgress(all, 'user-b').map((e) => e.lesson)).toEqual([3]);
});

test('保存内容が同じ間は同じ配列を返し、保存時と他のタブでの変更を購読者へ通知する', () => {
  const first = getLocalProgressSnapshot();
  expect(getLocalProgressSnapshot()).toBe(first);

  const onChange = vi.fn();
  const unsubscribe = subscribeLocalProgress(onChange);
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 1 });
  expect(onChange).toHaveBeenCalledTimes(1);
  const second = getLocalProgressSnapshot();
  expect(second).not.toBe(first);
  expect(second).toHaveLength(1);
  expect(getLocalProgressSnapshot()).toBe(second);

  window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_PROGRESS_KEY }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'other-key' }));
  expect(onChange).toHaveBeenCalledTimes(2);

  unsubscribe();
  pushLocalProgress({ lesson: 2, score: 100, time_spent: 1 });
  expect(onChange).toHaveBeenCalledTimes(2);
});

test('読み上げ速度は選択肢に含まれる値だけを読み込み、それ以外は既定値を返す', () => {
  const rates = [0.75, 1, 1.25, 1.5];
  expect(readSpeechRate(rates, 1)).toBe(1);
  expect(writeSpeechRate(1.25)).toBe(true);
  expect(readSpeechRate(rates, 1)).toBe(1.25);
  window.localStorage.setItem(SPEECH_RATE_KEY, '3');
  expect(readSpeechRate(rates, 1)).toBe(1);
  window.localStorage.setItem(SPEECH_RATE_KEY, '"fast"');
  expect(readSpeechRate(rates, 1)).toBe(1);
  window.localStorage.setItem(SPEECH_RATE_KEY, '{oops');
  expect(readSpeechRate(rates, 1)).toBe(1);
});
