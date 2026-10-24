import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function getInitial(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

// OS の「視差効果を減らす」設定に追従する
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(getInitial);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    onChange();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // 古い Safari 向け
    mql.addListener?.(onChange);
    return () => mql.removeListener?.(onChange);
  }, []);

  return reduced;
}
