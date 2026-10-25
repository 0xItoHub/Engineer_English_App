import React from "react";
import { useLocation } from "react-router";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

const MAIN_CONTENT_ID = "main-content";

// 見出しの表示を待つ最大時間（読み込みが終わらない場合は本文へのフォーカスのままにする）
const HEADING_WAIT_MS = 10000;

// 画面遷移時の処理（画面には何も描画しない）
// - ページの先頭へスクロールする（「視差効果を減らす」設定時はアニメーションしない）
// - キーボード・スクリーンリーダーの利用者が新しいページの先頭から読めるよう、ページの見出し（h1）へフォーカスを移す
//   見出しがまだ表示されていない場合は本文へフォーカスし、見出しが表示された時点で移す
const RouteChangeEffects: React.FC = () => {
  const { pathname } = useLocation();
  const reducedMotion = usePrefersReducedMotion();
  const reducedMotionRef = React.useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const previousPath = React.useRef(pathname);

  React.useEffect(() => {
    // 初回表示ではスクロール位置やフォーカスを変えない
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;

    try {
      window.scrollTo({ top: 0, left: 0, behavior: reducedMotionRef.current ? "auto" : "smooth" });
    } catch {
      // スクロールできない環境では何もしない
    }

    const main = document.getElementById(MAIN_CONTENT_ID);
    if (!main) return;

    const focusHeading = (): boolean => {
      const heading = main.querySelector<HTMLElement>("h1");
      if (!heading) return false;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      return true;
    };
    if (focusHeading()) return;

    main.focus({ preventScroll: true });
    const observer = new MutationObserver(() => {
      // 利用者がすでに別の場所へフォーカスを移している場合はそのままにする
      const active = document.activeElement;
      if (active !== main && active !== document.body) {
        stop();
        return;
      }
      if (focusHeading()) stop();
    });
    const timer = window.setTimeout(() => stop(), HEADING_WAIT_MS);
    function stop() {
      observer.disconnect();
      window.clearTimeout(timer);
    }
    observer.observe(main, { childList: true, subtree: true });
    return stop;
  }, [pathname]);

  return null;
};

export default RouteChangeEffects;
