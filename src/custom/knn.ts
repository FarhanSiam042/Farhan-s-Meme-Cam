// k-nearest-neighbours classifier over pose features. Small, fast, trains
// instantly (it just remembers the samples), and works with a few seconds of
// recording per gesture.
import { GROUPS } from "./features";

export interface Sample {
  label: string;
  features: ArrayLike<number>;
}

export interface Prediction {
  label: string;
  /** Share of the weighted vote the winner got, 0..1. */
  confidence: number;
}

/** Per-dimension multipliers so every feature group counts equally, whatever its size. */
const DIM_WEIGHTS = (() => {
  const len = GROUPS.reduce((n, [s, l]) => Math.max(n, s + l), 0);
  const w = new Float32Array(len);
  for (const [start, l, weight] of GROUPS) {
    for (let i = start; i < start + l; i++) w[i] = weight / l;
  }
  return w;
})();

export function distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < DIM_WEIGHTS.length; i++) {
    const d = a[i] - b[i];
    s += DIM_WEIGHTS[i] * d * d;
  }
  return Math.sqrt(s);
}

export class Knn {
  private samples: Sample[] = [];

  constructor(private k = 7) {}

  train(samples: Sample[]): void {
    this.samples = samples;
  }

  get size(): number {
    return this.samples.length;
  }

  labels(): Set<string> {
    return new Set(this.samples.map((s) => s.label));
  }

  predict(features: ArrayLike<number>): Prediction | null {
    if (!this.samples.length) return null;
    // keep the k closest without sorting everything
    const best: { d: number; label: string }[] = [];
    for (const s of this.samples) {
      const d = distance(features, s.features);
      if (best.length < this.k) {
        best.push({ d, label: s.label });
        best.sort((x, y) => x.d - y.d);
      } else if (d < best[best.length - 1].d) {
        best[best.length - 1] = { d, label: s.label };
        best.sort((x, y) => x.d - y.d);
      }
    }
    const votes = new Map<string, number>();
    let total = 0;
    for (const { d, label } of best) {
      const w = 1 / (d + 1e-3);
      votes.set(label, (votes.get(label) ?? 0) + w);
      total += w;
    }
    let label = best[0].label;
    let top = 0;
    for (const [l, v] of votes) {
      if (v > top) [label, top] = [l, v];
    }
    return { label, confidence: top / total };
  }
}
