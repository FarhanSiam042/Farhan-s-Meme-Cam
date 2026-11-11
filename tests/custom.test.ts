import { describe, expect, it } from "vitest";
import { extractFeatures, FEATURE_LENGTH } from "../src/custom/features";
import { Knn } from "../src/custom/knn";
import type { Frame } from "../src/packs/types";

const frame = (hands: Frame["hands"]): Frame => ({ now: 0, hands, face: null, pose: null, flow: null, width: 640, height: 480, readPixels: null });

/** A hand at (cx, cy) with fingers spread up (open) or folded (fist). */
function hand(cx: number, cy: number, open: boolean) {
  return Array.from({ length: 21 }, (_, i) => {
    if (i === 0) return { x: cx, y: cy, z: 0 };
    const finger = Math.floor((i - 1) / 4);
    const joint = ((i - 1) % 4) + 1;
    const reach = open ? joint * 0.03 : Math.min(joint, 2) * 0.02;
    return { x: cx + (finger - 2) * 0.02, y: cy - reach, z: 0 };
  });
}

const jitter = (h: ReturnType<typeof hand>, k: number) => h.map((p, i) => ({ ...p, x: p.x + Math.sin(i * 7 + k) * 0.003, y: p.y + Math.cos(i * 5 + k) * 0.003 }));

describe("custom gestures", () => {
  it("makes fixed-length features, with zeros when nothing is seen", () => {
    const f = extractFeatures(frame([]));
    expect(f.length).toBe(FEATURE_LENGTH);
    expect(Array.from(f).every((v) => v === 0)).toBe(true);
  });

  it("learns open hand vs fist vs nothing", () => {
    const knn = new Knn();
    const samples = [];
    for (let k = 0; k < 20; k++) {
      samples.push({ label: "open", features: extractFeatures(frame([jitter(hand(0.5, 0.6, true), k)])) });
      samples.push({ label: "fist", features: extractFeatures(frame([jitter(hand(0.5, 0.6, false), k)])) });
      samples.push({ label: "rest", features: extractFeatures(frame([])) });
    }
    knn.train(samples);
    expect(knn.predict(extractFeatures(frame([jitter(hand(0.52, 0.58, true), 99)])))?.label).toBe("open");
    expect(knn.predict(extractFeatures(frame([jitter(hand(0.48, 0.62, false), 42)])))?.label).toBe("fist");
    expect(knn.predict(extractFeatures(frame([])))?.label).toBe("rest");
  });

  it("returns nothing before training", () => {
    expect(new Knn().predict(new Float32Array(FEATURE_LENGTH))).toBeNull();
  });
});
