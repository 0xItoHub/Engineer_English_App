// jest-dom のマッチャー（toBeInTheDocument など）を Vitest の expect に追加する
// https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/vitest';

// jsdom には canvas が無いため、背景アニメーションは描画しない
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null,
});

// jsdom には matchMedia が無いため、既定値（設定なし）を返すモックを用意
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  window.localStorage.clear();
});
