// Sideways-motion signal for "spinning in your chair".
//
// Estimates per-block horizontal motion between two small grayscale frames
// (160x90) by block matching with sub-pixel refinement, then reduces it to
// magnitude = mean |motion| across the frame and
// coherence = share of moving blocks that agree on one direction.
// Tuned to match OpenCV's Farneback optical flow on the same frames.
//
// Pure functions only, so tests can run it under Node.

import type { FlowSample } from "../packs/types";

export const FLOW_W = 160;
export const FLOW_H = 90;
const NOISE_FLOOR_PX = 0.4;
const MIN_MOVING_FRACTION = 0.15;
const BLOCK = 8;
const SEARCH_X = 10;
const SEARCH_Y = 2;
/** A block needs this much sideways detail before its own match is trusted. */
const MIN_BLOCK_GRAD = 2;
/** Flat blocks borrow the scaled-down average of measured blocks within this radius. */
const FILL_RADIUS = 2;
const FILL_WEIGHT = 0.3;

/** RGBA pixels -> grayscale with OpenCV's weights. */
export function toGray(rgba: Uint8ClampedArray, n = FLOW_W * FLOW_H): Float32Array {
  const g = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return g;
}

/** Sum of absolute differences between a block in prev and the shifted block in cur. */
function sad(prev: Float32Array, cur: Float32Array, bx: number, by: number, dx: number, dy: number, w: number): number {
  let s = 0;
  for (let y = 0; y < BLOCK; y++) {
    const rp = (by + y) * w + bx;
    const rc = (by + y + dy) * w + bx + dx;
    for (let x = 0; x < BLOCK; x++) s += Math.abs(cur[rc + x] - prev[rp + x]);
  }
  return s;
}

/** Horizontal motion per block, in pixels per frame. */
export function blockFlowX(prev: Float32Array, cur: Float32Array, w = FLOW_W, h = FLOW_H): number[] {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let by = SEARCH_Y; by + BLOCK + SEARCH_Y <= h; by += BLOCK) rows.push(by);
  for (let bx = SEARCH_X; bx + BLOCK + SEARCH_X <= w; bx += BLOCK) cols.push(bx);
  const nC = cols.length;
  const fx = new Float32Array(rows.length * nC);
  const known = new Uint8Array(fx.length);

  rows.forEach((by, ri) => {
    cols.forEach((bx, ci) => {
      // without sideways detail a block can't show sideways motion
      let grad = 0;
      for (let y = 0; y < BLOCK; y++) {
        const r = (by + y) * w + bx;
        for (let x = 0; x < BLOCK; x++) grad += Math.abs(prev[r + x + 1] - prev[r + x]);
      }
      if (grad / (BLOCK * BLOCK) < MIN_BLOCK_GRAD) return;

      let best = Infinity;
      let bestDx = 0;
      let bestDy = 0;
      for (let dy = -SEARCH_Y; dy <= SEARCH_Y; dy++) {
        for (let dx = -SEARCH_X; dx <= SEARCH_X; dx++) {
          // tiny bias toward zero motion so ambiguous matches don't wander
          const s = sad(prev, cur, bx, by, dx, dy, w) * (1 + 0.002 * (Math.abs(dx) + Math.abs(dy)));
          if (s < best) {
            best = s;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }
      let v = bestDx;
      if (bestDx > -SEARCH_X && bestDx < SEARCH_X) {
        // parabola through the neighbouring matches for sub-pixel accuracy
        const l = sad(prev, cur, bx, by, bestDx - 1, bestDy, w);
        const c = sad(prev, cur, bx, by, bestDx, bestDy, w);
        const r = sad(prev, cur, bx, by, bestDx + 1, bestDy, w);
        const denom = l - 2 * c + r;
        if (denom > 1e-6) v += Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / denom));
      }
      const k = ri * nC + ci;
      fx[k] = v;
      known[k] = 1;
    });
  });

  const inGrid = (r: number, c: number) => r >= 0 && c >= 0 && r < rows.length && c < nC;

  const filled = Float32Array.from(fx);
  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < nC; ci++) {
      const k = ri * nC + ci;
      if (known[k]) continue;
      let sum = 0;
      let n = 0;
      for (let rr = ri - FILL_RADIUS; rr <= ri + FILL_RADIUS; rr++) {
        for (let cc = ci - FILL_RADIUS; cc <= ci + FILL_RADIUS; cc++) {
          if (inGrid(rr, cc) && known[rr * nC + cc]) {
            sum += fx[rr * nC + cc];
            n++;
          }
        }
      }
      filled[k] = n ? (FILL_WEIGHT * sum) / n : 0;
    }
  }

  // 3x3 median removes isolated false matches on repetitive edges
  const out: number[] = new Array(filled.length);
  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < nC; ci++) {
      const win: number[] = [];
      for (let rr = ri - 1; rr <= ri + 1; rr++) {
        for (let cc = ci - 1; cc <= ci + 1; cc++) if (inGrid(rr, cc)) win.push(filled[rr * nC + cc]);
      }
      win.sort((a, b) => a - b);
      out[ri * nC + ci] = win[win.length >> 1];
    }
  }
  return out;
}

export function flowSignal(prev: Float32Array, cur: Float32Array, w = FLOW_W, h = FLOW_H): FlowSample {
  const fx = blockFlowX(prev, cur, w, h);
  if (!fx.length) return { magnitude: 0, coherence: 0 };
  const magnitude = fx.reduce((s, v) => s + Math.abs(v), 0) / fx.length;
  const moving = fx.filter((v) => Math.abs(v) > NOISE_FLOOR_PX);
  let coherence = 0;
  if (moving.length / fx.length >= MIN_MOVING_FRACTION) {
    const sign = Math.sign(moving.reduce((a, b) => a + b, 0));
    if (sign !== 0) coherence = moving.filter((v) => Math.sign(v) === sign).length / moving.length;
  }
  return { magnitude, coherence };
}
