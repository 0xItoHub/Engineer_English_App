import React, { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

// 背景に表示するコード片（`${...}` は表示用の文字列としてそのまま描画する）
const CODE_LINES = [
  "function hello(name) { return `Hello, ${name}`; }",
  "const sum = (a, b) => a + b;",
  "for (let i = 0; i < 10; i++) console.log(i);",
  "async function fetchJSON(url) { const r = await fetch(url); return r.json(); }",
  "def greet(name):\n    return f\"Hello, {name}\"",
  "const user = { id: 1, name: 'Alice', role: 'engineer' };",
  "if (status === 200) { handleOk(); } else { handleFail(); }",
  "interface Scene { id: number; title: string }",
  "try { doWork(); } catch (e) { console.error(e) }",
  "// TODO: refactor later",
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

const AnimatedCodeBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 「視差効果を減らす」設定時はアニメーションせず静止画として描画する
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    const c = ctx;

    let raf = 0;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    // state
    const lineHeight = 20; // px
    const maxLines = Math.ceil(window.innerHeight / lineHeight) + 5;
    let buffer: string[] = [];
    let current = pick(CODE_LINES);
    let cursor = 0;
    let lastTime = 0;

    const fontStack = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    c.font = fontStack;

    // 1 フレーム分の描画
    const draw = (typing: string, showCursor: boolean) => {
      // クリア（薄くフェード）
      c.clearRect(0, 0, canvas.width, canvas.height);

      c.globalAlpha = 0.09;
      c.fillStyle = "#0d1117";
      c.fillRect(0, 0, window.innerWidth, window.innerHeight);

      c.globalAlpha = 0.12;
      c.fillStyle = "#58a6ff";
      c.font = fontStack;

      for (let i = 0; i < buffer.length; i++) {
        const y = window.innerHeight - i * lineHeight - 40;
        if (y < -20) break;
        c.fillText(buffer[i], 24, y);
      }

      // カーソル
      if (showCursor) {
        c.globalAlpha = 0.18;
        const cursorX = 24 + c.measureText(typing).width;
        const cursorY = window.innerHeight - 40;
        c.fillRect(cursorX, cursorY - 12, 8, 14);
      }
    };

    // 静止画用：画面を埋める分のコード片を一度だけ描画
    const drawStatic = () => {
      buffer = Array.from({ length: maxLines }, (_, i) => CODE_LINES[i % CODE_LINES.length]);
      draw(buffer[0], true);
    };

    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      // リサイズのたびに倍率を設定し直す（scale の累積を防ぐ）
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reducedMotion) drawStatic();
    };
    resize();
    window.addEventListener("resize", resize);

    if (reducedMotion) {
      return () => {
        window.removeEventListener("resize", resize);
      };
    }

    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      const dt = t - lastTime;
      if (dt < 60) return; // 更新間隔を広げて全体をゆっくりに（約16fps）
      lastTime = t;

      // タイプ進行（1フレームあたりの打鍵数を控えめに）
      const speed = 1 + Math.floor(Math.random() * 2); // 1〜2文字
      cursor = Math.min(current.length, cursor + speed);
      const typing = current.slice(0, cursor);
      buffer = [typing, ...buffer].slice(0, maxLines);
      if (cursor >= current.length) {
        cursor = 0;
        current = pick(CODE_LINES);
      }

      // 描画（カーソルの点滅も少しゆっくり）
      draw(typing, Math.floor(t / 600) % 2 === 0);
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
};

export default AnimatedCodeBackground;
