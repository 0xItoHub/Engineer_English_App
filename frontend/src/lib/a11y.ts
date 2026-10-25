// 画面には表示せず、支援技術にだけ伝える要素のスタイル（MUI の sx に指定する）
export const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
  p: 0,
  m: -1,
} as const;
