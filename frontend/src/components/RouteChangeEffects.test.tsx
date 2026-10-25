import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import RouteChangeEffects from './RouteChangeEffects';
import { formatPageTitle, usePageTitle } from '../hooks/usePageTitle';

function Page({ title }: { title: string }) {
  usePageTitle(title);
  return (
    <>
      <h1>{title}</h1>
      <Link to="/a">to a</Link>
      <Link to="/later">to later</Link>
    </>
  );
}

// 見出しが後から表示されるページ（データの読み込み中を想定）
function LaterPage() {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setReady(true), 20);
    return () => clearTimeout(timer);
  }, []);
  return ready ? <h1>Later</h1> : <p>読み込み中</p>;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <RouteChangeEffects />
      <main id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Page title="Home" />} />
          <Route path="/a" element={<Page title="要件定義" />} />
          <Route path="/later" element={<LaterPage />} />
        </Routes>
      </main>
    </MemoryRouter>
  );
}

function mockReducedMotion(reduced: boolean) {
  return vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduced,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  );
}

let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
  scrollTo = vi.fn();
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: scrollTo });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('初回表示ではスクロール・フォーカスを変えず、ページのタイトルを設定する', () => {
  renderApp();
  expect(scrollTo).not.toHaveBeenCalled();
  expect(document.title).toBe('Home | Engineer English App');
  expect(formatPageTitle(null)).toBe('Engineer English App');
});

test('画面遷移時は先頭へスクロールし、ページの見出しへフォーカスを移してタイトルを変更する', () => {
  renderApp();

  fireEvent.click(screen.getByRole('link', { name: 'to a' }));

  expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'smooth' });
  expect(screen.getByRole('heading', { level: 1, name: '要件定義' })).toHaveFocus();
  expect(document.title).toBe('要件定義 | Engineer English App');
});

test('「視差効果を減らす」設定時はスクロールのアニメーションを使わない', () => {
  mockReducedMotion(true);
  renderApp();

  fireEvent.click(screen.getByRole('link', { name: 'to a' }));

  expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
});

test('見出しが後から表示される場合は、本文へフォーカスしてから見出しへ移す', async () => {
  renderApp();

  fireEvent.click(screen.getByRole('link', { name: 'to later' }));
  expect(document.getElementById('main-content')).toHaveFocus();

  expect(await screen.findByRole('heading', { level: 1, name: 'Later' })).toHaveFocus();
});
