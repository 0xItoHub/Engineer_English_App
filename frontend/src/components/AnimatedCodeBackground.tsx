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

// 描画に使う画面の倍率の上限
const MAX_DPR = 2;

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
    // 高解像度の画面でも描画の負荷が大きくなりすぎないよう、倍率は 2 倍までにする
    const devicePixelRatio = () => Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));

    // state
    const lineHeight = 20; // px
    const linesFor = (height: number) => Math.ceil(height / lineHeight) + 5;
    // 表示中の行（新しい行から順に参照するリングバッファ。フレームごとに配列を作り直さない）
    let capacity = linesFor(window.innerHeight);
    let ring: string[] = new Array<string>(capacity).fill("");
    let head = 0; // 最新の行の位置
    let count = 0; // 保持している行数
    const lineAt = (i: number) => ring[(head - i + capacity) % capacity];
    const pushLine = (line: string) => {
      head = (head + 1) % capacity;
      ring[head] = line;
      if (count < capacity) count += 1;
    };
    // 画面の高さが変わった場合は、新しい行から順に保持できる分だけ引き継ぐ
    const resizeRing = (next: number) => {
      if (next === capacity) return;
      const kept = Math.min(count, next);
      const nextRing = new Array<string>(next).fill("");
      for (let i = 0; i < kept; i++) nextRing[kept - 1 - i] = lineAt(i);
      ring = nextRing;
      capacity = next;
      count = kept;
      head = kept > 0 ? kept - 1 : 0;
    };

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

      for (let i = 0; i < count; i++) {
        const y = window.innerHeight - i * lineHeight - 40;
        if (y < -20) break;
        c.fillText(lineAt(i), 24, y);
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
      count = 0;
      for (let i = capacity - 1; i >= 0; i--) pushLine(CODE_LINES[i % CODE_LINES.length]);
      draw(lineAt(0), true);
    };

    const resize = () => {
      const dpr = devicePixelRatio();
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      // リサイズのたびに倍率を設定し直す（scale の累積を防ぐ）
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 画面の高さに合わせて表示する行数を決め直す
      resizeRing(linesFor(window.innerHeight));
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
      pushLine(typing);
      if (cursor >= current.length) {
        cursor = 0;
        current = pick(CODE_LINES);
      }

      // 描画（カーソルの点滅も少しゆっくり）
      draw(typing, Math.floor(t / 600) % 2 === 0);
    };

    const start = () => {
      if (raf) return;
      lastTime = 0;
      raf = requestAnimationFrame(step);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    // タブが非表示の間はアニメーションを止め、表示に戻ったら再開する
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (!document.hidden) start();

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
