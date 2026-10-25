import { markSyncStarted, syncLocalProgress, type PostEntry } from './progressSync';
import { pushLocalProgress, readLocalProgress, removeLocalProgressEntry } from './storage';

const httpError = (status: number) => Object.assign(new Error(`status ${status}`), { response: { status } });

beforeEach(() => {
  window.sessionStorage.clear();
});

test('すべて保存できた場合はブラウザの進捗を削除する', async () => {
  pushLocalProgress({ lesson: 1, score: 80, time_spent: 10 });
  pushLocalProgress({ lesson: 2, score: 100, time_spent: 20 });
  const post = vi.fn<PostEntry>(async () => ({}));

  const result = await syncLocalProgress(post);

  expect(post.mock.calls.map(([e]) => e.lesson)).toEqual([1, 2]);
  expect(result).toEqual({ uploaded: 2, remaining: 0, rateLimited: false });
  expect(readLocalProgress()).toEqual([]);
});

test('429 を受け取ったら中断し、未送信の進捗は残す', async () => {
  pushLocalProgress({ lesson: 1, score: 80, time_spent: 10 });
  pushLocalProgress({ lesson: 2, score: 90, time_spent: 20 });
  pushLocalProgress({ lesson: 3, score: 100, time_spent: 30 });
  const post = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(httpError(429));

  const result = await syncLocalProgress(post);

  expect(post).toHaveBeenCalledTimes(2);
  expect(result).toEqual({ uploaded: 1, remaining: 2, rateLimited: true });
  expect(readLocalProgress().map((e) => e.lesson)).toEqual([2, 3]);
});

test('その他のエラーの進捗は残して、次の進捗の送信を続ける', async () => {
  pushLocalProgress({ lesson: 1, score: 80, time_spent: 10 });
  pushLocalProgress({ lesson: 2, score: 90, time_spent: 20 });
  const post = vi.fn().mockRejectedValueOnce(httpError(400)).mockResolvedValueOnce({});

  const result = await syncLocalProgress(post);

  expect(result).toEqual({ uploaded: 1, remaining: 1, rateLimited: false });
  expect(readLocalProgress().map((e) => e.lesson)).toEqual([1]);
});

test('1 回の反映で送信するのは最大 30 件まで', async () => {
  for (let i = 1; i <= 35; i++) pushLocalProgress({ lesson: i, score: 50, time_spent: 1 });
  const post = vi.fn<PostEntry>(async () => ({}));

  const result = await syncLocalProgress(post);

  expect(post).toHaveBeenCalledTimes(30);
  expect(result).toEqual({ uploaded: 30, remaining: 5, rateLimited: false });
});

test('保存後に高いスコアが記録されていた場合はブラウザの進捗を残す', () => {
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 10 });
  removeLocalProgressEntry({ lesson: 1, score: 60, time_spent: 5 });
  expect(readLocalProgress()).toHaveLength(1);
  removeLocalProgressEntry({ lesson: 1, score: 100, time_spent: 10 });
  expect(readLocalProgress()).toHaveLength(0);
});

test('反映はユーザーごとにタブ内で 1 回だけ行う', () => {
  expect(markSyncStarted('user-a')).toBe(true);
  expect(markSyncStarted('user-a')).toBe(false);
  expect(markSyncStarted('user-b')).toBe(true);
});
