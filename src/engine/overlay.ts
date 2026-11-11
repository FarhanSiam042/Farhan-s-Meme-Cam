// Draws the hand skeleton and face dots over the camera picture.
import type { Frame } from "../packs/types";
import { settings } from "../store";

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export const HAND_STYLES: Record<string, { label: string; line: string; joint: string }> = {
  classic: { label: "Classic green", line: "#78dc50", joint: "#ff8c3c" },
  white: { label: "White", line: "#ffffff", joint: "#1b1a17" },
  pink: { label: "Pink", line: "#ff6ec7", joint: "#ffffff" },
  cyan: { label: "Cyan", line: "#4fe3ff", joint: "#ffffff" },
  yellow: { label: "Yellow", line: "#ffe14f", joint: "#1b1a17" },
};

function style() {
  const key = settings.handColor;
  if (HAND_STYLES[key]) return HAND_STYLES[key];
  if (/^#[0-9a-f]{6}$/i.test(key)) return { line: key, joint: "#ffffff" };
  return HAND_STYLES.classic;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { width: w, height: h } = f;
  const s = Math.max(1, w / 640);
  const st = style();

  if (f.face && settings.faceDots) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = st.line;
    for (const p of f.face.landmarks) ctx.fillRect(p.x * w - 0.75 * s, p.y * h - 0.75 * s, 1.5 * s, 1.5 * s);
    ctx.globalAlpha = 1;
  }
  if (!settings.handLines) return;
  for (const lm of f.hands) {
    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = st.line;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
    }
    ctx.stroke();
    ctx.fillStyle = st.joint;
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 2.4 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
