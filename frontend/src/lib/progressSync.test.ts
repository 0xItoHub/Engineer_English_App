import { clearSynced, hasSynced, runInitialSync, syncLocalProgress, type PostEntry } from './progressSync';
import { pushLocalProgress, readLocalProgress, removeLocalProgressEntry } from './storage';

const httpError = (status: number) => Object.assign(new Error(`status ${status}`), { response: { status } });

beforeEach(() => {
  window.sessionStorage.clear();
});

test('すべて保存できた場合はブラウザの進捗を削除する', async () => {
  pushLocalProgress({ lesson: 1, score: 80, time_spent: 10 });
  pushLocalProgress({ lesson: 2, score: 100, time_spent: 20 });
  const post = vi.fn<PostEntry>(async () => ({}));

  const result = await syncLocalProgress('user-a', post);

  expect(post.mock.calls.map(([e]) => e.lesson)).toEqual([1, 2]);
  expect(result).toEqual({ uploaded: 2, remaining: 0, rateLimited: false, interrupted: false });
  expect(readLocalProgress()).toEqual([]);
});

test('反映するのは未ログインの記録と本人の記録のみで、他のユーザーの記録は送信せずに残す', async () => {
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 10 });
  pushLocalProgress({ lesson: 2, score: 100, time_spent: 20, owner: 'user-a' });
  pushLocalProgress({ lesson: 3, score: 100, time_spent: 30, owner: 'user-b' });
  const post = vi.fn<PostEntry>(async () => ({}));

  const result = await syncLocalProgress('user-a', post);

  expect(post.mock.calls.map(([e]) => e.lesson)).toEqual([1, 2]);
  expect(result).toMatchObject({ uploaded: 2, remaining: 0 });
  expect(readLocalProgress()).toEqual([expect.objectContaining({ lesson: 3, owner: 'user-b' })]);
});

test('429 を受け取ったら中断し、未送信の進捗は残す', async () => {
  pushLocalProgress({ lesson: 1, score: 80, time_spent: 10 });
  pushLocalProgress({ lesson: 2, score: 90, time_spent: 20 });
  pushLocalProgress({ lesson: 3, score: 100, time_spent: 30 });
  const post = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(httpError(429));

  const result = await syncLocalProgress('user-a', post);

  expect(post).toHaveBeenCalledTimes(2);
  expect(result).toEqual({ uploaded: 1, remaining: 2, rateLimited: true, interrupted: false });
  expect(readLocalProgress().map((e) => e.lesson)).toEqual([2, 3]);
});

test('その他のエラーの進捗は残して、次の進捗の送信を続ける', async () => {
  pushLocalProgress({ lesson: 1, score: 80, time_spent: 10 });
  pushLocalProgress({ lesson: 2, score: 90, time_spent: 20 });
  const post = vi.fn().mockRejectedValueOnce(httpError(400)).mockResolvedValueOnce({});

  const result = await syncLocalProgress('user-a', post);

  expect(result).toEqual({ uploaded: 1, remaining: 1, rateLimited: false, interrupted: false });
  expect(readLocalProgress().map((e) => e.lesson)).toEqual([1]);
});

test('1 回の反映で送信するのは最大 30 件まで', async () => {
  for (let i = 1; i <= 35; i++) pushLocalProgress({ lesson: i, score: 50, time_spent: 1 });
  const post = vi.fn<PostEntry>(async () => ({}));

  const result = await syncLocalProgress('user-a', post);

  expect(post).toHaveBeenCalledTimes(30);
  expect(result).toMatchObject({ uploaded: 30, remaining: 5 });
});

test('保存後に高いスコアが記録されていた場合はブラウザの進捗を残す', () => {
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 10 });
  removeLocalProgressEntry({ lesson: 1, score: 60, time_spent: 5 });
  expect(readLocalProgress()).toHaveLength(1);
  removeLocalProgressEntry({ lesson: 1, score: 100, time_spent: 10 });
  expect(readLocalProgress()).toHaveLength(0);
});

test('反映を最後まで実行できた場合のみ完了として記録し、同じタブでは再実行しない', async () => {
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 10 });
  const post = vi.fn<PostEntry>(async () => ({}));

  expect(await runInitialSync('user-a', post)).toMatchObject({ uploaded: 1 });
  expect(hasSynced('user-a')).toBe(true);

  pushLocalProgress({ lesson: 2, score: 100, time_spent: 10 });
  expect(await runInitialSync('user-a', post)).toBeNull();
  expect(post).toHaveBeenCalledTimes(1);
  // ユーザーごとに記録する
  expect(hasSynced('user-b')).toBe(false);
});

test('ログイン切れや通信エラーで中断した場合は完了として記録せず、次の機会に再実行する', async () => {
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 10 });
  const post = vi.fn<PostEntry>().mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({});

  expect(await runInitialSync('user-a', post)).toMatchObject({ uploaded: 0, interrupted: true });
  expect(hasSynced('user-a')).toBe(false);

  expect(await runInitialSync('user-a', post)).toMatchObject({ uploaded: 1, interrupted: false });
  expect(readLocalProgress()).toEqual([]);
});

test('実行中の反映と重ねて実行しない', async () => {
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 10 });
  let resolve: () => void = () => {};
  const post = vi.fn<PostEntry>(() => new Promise<void>((r) => { resolve = r; }));

  const first = runInitialSync('user-a', post);
  expect(await runInitialSync('user-a', post)).toBeNull();
  resolve();
  await first;
  expect(post).toHaveBeenCalledTimes(1);
});

test('ログアウト時に記録を消すと、次回のログイン時に改めて反映する', async () => {
  pushLocalProgress({ lesson: 1, score: 100, time_spent: 10, owner: 'user-a' });
  const post = vi.fn<PostEntry>().mockRejectedValueOnce(httpError(400)).mockResolvedValueOnce({});

  await runInitialSync('user-a', post);
  expect(hasSynced('user-a')).toBe(true);
  clearSynced('user-a');

  expect(await runInitialSync('user-a', post)).toMatchObject({ uploaded: 1 });
});
