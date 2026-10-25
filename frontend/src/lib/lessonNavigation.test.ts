import { findNextTarget } from './lessonNavigation';
import type { Scene } from './queries';

const lesson = (id: number) => ({ id, title: `L${id}`, description: '' });

const scenes: Scene[] = [
  // API の並び順に関わらず ID の順で判定する
  { id: 2, title: 'Code Review', lessons: [lesson(21), lesson(20)] },
  { id: 1, title: 'Daily Standup', lessons: [lesson(12), lesson(10), lesson(11)] },
];

test('同じシーンの次のレッスン（ID の順）を返す', () => {
  expect(findNextTarget(scenes, 1, 10)).toEqual({ kind: 'lesson', id: 11, title: 'L11', path: '/lesson/11' });
  expect(findNextTarget(scenes, 1, 11)).toEqual({ kind: 'lesson', id: 12, title: 'L12', path: '/lesson/12' });
});

test('シーンの最後のレッスンでは次のシーンを返す', () => {
  expect(findNextTarget(scenes, 1, 12)).toEqual({ kind: 'scene', id: 2, title: 'Code Review', path: '/scene/2' });
});

test('最後のシーンの最後のレッスン・シーンが分からない場合は null を返す', () => {
  expect(findNextTarget(scenes, 2, 21)).toBeNull();
  expect(findNextTarget(scenes, 99, 1)).toBeNull();
  expect(findNextTarget(undefined, 1, 10)).toBeNull();
  expect(findNextTarget([], 1, 10)).toBeNull();
});
