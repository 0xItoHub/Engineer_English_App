import { act, render } from '@testing-library/react';
import AnimatedCodeBackground from './AnimatedCodeBackground';

// 描画内容を記録するだけの 2D コンテキスト
function fakeContext() {
  return {
    font: '',
    globalAlpha: 1,
    fillStyle: '',
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
  };
}

function setWindowSize(width: number, height: number, dpr: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

function mockReducedMotion(reduced: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduced,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
}

let ctx: ReturnType<typeof fakeContext>;
const original = { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio };

beforeEach(() => {
  ctx = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
  setWindowSize(original.width, original.height, original.dpr);
  setHidden(false);
});

test('画面の倍率は 2 倍までに制限して描画する', () => {
  mockReducedMotion(true);
  setWindowSize(1000, 400, 3);

  const { container } = render(<AnimatedCodeBackground />);

  const canvas = container.querySelector('canvas') as HTMLCanvasElement;
  expect(canvas.width).toBe(2000);
  expect(canvas.height).toBe(800);
  expect(ctx.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
});

test('リサイズ時に画面の高さに合わせて表示する行数を決め直す', () => {
  mockReducedMotion(true);
  setWindowSize(1000, 400, 1);
  render(<AnimatedCodeBackground />);
  // 画面内（下端から 40px 上を起点に 20px 間隔）に収まる 20 行を描画する
  expect(ctx.fillText).toHaveBeenCalledTimes(20);

  ctx.fillText.mockClear();
  setWindowSize(1000, 800, 1);
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  expect(ctx.fillText).toHaveBeenCalledTimes(40);
});

test('タブが非表示の間はアニメーションを止め、表示に戻ったら再開する', () => {
  mockReducedMotion(false);
  let nextId = 1;
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => nextId++);
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

  const view = render(<AnimatedCodeBackground />);
  expect(raf).toHaveBeenCalledTimes(1);

  setHidden(true);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(cancel).toHaveBeenCalledWith(1);

  setHidden(false);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(raf).toHaveBeenCalledTimes(2);

  view.unmount();
  expect(cancel).toHaveBeenLastCalledWith(2);
});

test('アニメーションでは打鍵中の行を新しい順に描画する', () => {
  mockReducedMotion(false);
  setWindowSize(1000, 400, 1);
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(Math, 'random').mockReturnValue(0);

  render(<AnimatedCodeBackground />);
  frames[0](100);
  frames[1](200);
  frames[2](300);

  // 1 フレームにつき 1 文字ずつ進み、最新の行が最も下に描画される
  const lastFrame = ctx.fillText.mock.calls.slice(-3);
  expect(lastFrame.map(([text]) => text)).toEqual(['fun', 'fu', 'f']);
  expect(lastFrame.map(([, , y]) => y)).toEqual([360, 340, 320]);
});
