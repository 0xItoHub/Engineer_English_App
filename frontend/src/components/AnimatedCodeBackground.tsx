import React, { useEffect, useRef } from "react";

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

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    // state
    const lineHeight = 20; // px
    const maxLines = Math.ceil(window.innerHeight / lineHeight) + 5;
    let buffer: string[] = [];
    let current = pick(CODE_LINES);
    let cursor = 0;
    let lastTime = 0;

    const fontStack = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    ctx.font = fontStack;

    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      const dt = t - lastTime;
      if (dt < 60) return; // 更新間隔を広げて全体をゆっくりに（約16fps）
      lastTime = t;

      // クリア（薄くフェード）
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // タイプ進行（1フレームあたりの打鍵数を控えめに）
      const speed = 1 + Math.floor(Math.random() * 2); // 1〜2文字
      cursor = Math.min(current.length, cursor + speed);
      const typing = current.slice(0, cursor);
      buffer = [typing, ...buffer].slice(0, maxLines);
      if (cursor >= current.length) {
        cursor = 0;
        current = pick(CODE_LINES);
      }

      // 描画
      ctx.save();
      ctx.scale(1 / dpr, 1 / dpr);
      ctx.restore();

      ctx.globalAlpha = 0.09;
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#58a6ff";
      ctx.font = fontStack;

      for (let i = 0; i < buffer.length; i++) {
        const y = window.innerHeight - i * lineHeight - 40;
        if (y < -20) break;
        ctx.fillText(buffer[i], 24, y);
      }

      // カーソル
      ctx.globalAlpha = 0.18;
      const cursorX = 24 + ctx.measureText(typing).width;
      const cursorY = window.innerHeight - 40;
      if (Math.floor(t / 600) % 2 === 0) { // 点滅も少しゆっくり
        ctx.fillRect(cursorX, cursorY - 12, 8, 14);
      }
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
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